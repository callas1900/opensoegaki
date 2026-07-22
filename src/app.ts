/**
 * Platform-neutral wiring shared by every entry point: toolbar, palette/size
 * popovers, undo/redo, keyboard shortcuts, paste, insert-image, copy/save,
 * drag-out and external-drop. All OS integration goes through `PlatformIO`;
 * this module never imports `@tauri-apps/*` (see docs/WEB.md, "Code structure").
 */
import { Editor } from "./editor/canvas";
import { exportPng } from "./editor/exporter";
import { PALETTE, type SizeName, type Tool } from "./editor/model";
import { decodeClampedBitmap } from "./editor/downscale";
import { registerPopover, closeOpenPopover } from "./ui/popover";
import type { Capabilities, PlatformIO } from "./platform/io";

/** Handle returned to entry points for the platform-specific wiring they keep (desktop capture button, etc.). */
export interface EditorHandle {
  editor: Editor;
  /** Reveal the canvas and hide the welcome empty state; call after any background load. */
  showLoadedState(): void;
}

/**
 * Decode raw bytes into an `ImageBitmap`, downscaled per `decodeClampedBitmap`
 * (TASK-35.14) — `maxImportDimension` comes from the `Editor` instance doing
 * the inserting (null on desktop, unlimited; a px count on web).
 */
async function bytesToBitmap(bytes: Uint8Array, maxImportDimension: number | null): Promise<ImageBitmap> {
  // Re-wrap via Uint8Array.from(): it always allocates a fresh, concrete
  // ArrayBuffer, which satisfies Blob's BlobPart typing regardless of the
  // (possibly SharedArrayBuffer-backed) buffer type of the input.
  return decodeClampedBitmap(new Blob([Uint8Array.from(bytes)]), maxImportDimension);
}

export function bootstrapEditor(io: PlatformIO): EditorHandle {
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
  const stage = document.querySelector<HTMLElement>("#stage")!;
  const editor = new Editor(canvas);
  editor.maxImportDimension = io.maxImportDimension;
  editor.annotationScaleBaseline = io.annotationScaleBaseline;
  editor.setTool(editor.tool); // apply initial cursor feedback for the default tool

  const colorBtn = document.querySelector<HTMLButtonElement>("#color-btn")!;
  const colorPopover = document.querySelector<HTMLDivElement>("#color-popover")!;
  const colorChip = document.querySelector<HTMLSpanElement>("#color-chip")!;
  const sizeBtn = document.querySelector<HTMLButtonElement>("#size-btn")!;
  const sizePopover = document.querySelector<HTMLDivElement>("#size-popover")!;

  registerPopover(colorBtn, colorPopover);
  registerPopover(sizeBtn, sizePopover);
  colorChip.style.background = editor.color;

  // ---- toolbar ---------------------------------------------------------------

  for (const btn of document.querySelectorAll<HTMLButtonElement>("button.tool")) {
    btn.addEventListener("click", () => {
      editor.setTool(btn.dataset.tool as Tool);
      document.querySelector("button.tool.active")?.classList.remove("active");
      btn.classList.add("active");
      btn.blur(); // so pressing Enter next doesn't re-activate this button
      closeOpenPopover();
    });
  }

  const palette = document.querySelector<HTMLDivElement>("#palette")!;
  for (const color of PALETTE) {
    const swatch = document.createElement("button");
    swatch.className = "swatch" + (color === editor.color ? " active" : "");
    swatch.style.background = color;
    swatch.addEventListener("click", () => {
      editor.color = color;
      palette.querySelector(".swatch.active")?.classList.remove("active");
      swatch.classList.add("active");
      colorChip.style.background = color;
      closeOpenPopover();
    });
    palette.appendChild(swatch);
  }

  const sizes = document.querySelector<HTMLDivElement>("#sizes")!;
  for (const btn of sizes.querySelectorAll<HTMLButtonElement>("button[data-size]")) {
    btn.addEventListener("click", () => {
      editor.setSize(btn.dataset.size as SizeName);
      sizes.querySelector(".active")?.classList.remove("active");
      btn.classList.add("active");
      sizeBtn.textContent = btn.dataset.size!;
      closeOpenPopover();
    });
  }

  document.querySelector("#undo")!.addEventListener("click", () => editor.undo());
  document.querySelector("#redo")!.addEventListener("click", () => editor.redo());

  // ---- keyboard --------------------------------------------------------------

  /** True when a key event's target is a text-input control that should keep its own keys. */
  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  }

  // Set right before the Ctrl+Shift+V keydown branch below triggers its own
  // clipboard-image read, and auto-cleared on the next microtask: suppresses
  // the `paste` event handler further down so a single keypress doesn't both
  // insert-as-annotation (via keydown) AND replace-the-background (via the
  // browser's paste event that keydown does not preventDefault-block).
  let suppressNextPaste = false;

  window.addEventListener("keydown", (e) => {
    // While the inline text editor (or any other text input) is focused, all
    // global shortcuts are suppressed so native undo/copy/edit keys reach it
    // instead; Escape is handled by the editor's own keydown listener.
    if (isTypingTarget(e.target)) return;

    if (e.key === "Escape" && closeOpenPopover()) {
      e.preventDefault();
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === "v" && io.capabilities.readClipboardImage) {
      // Ctrl+Shift+V: insert the clipboard image as an annotation, distinct
      // from plain Ctrl+V's background-replace semantics (handled only by the
      // `paste` event listener below, left untouched). Desktop only.
      e.preventDefault();
      suppressNextPaste = true;
      setTimeout(() => {
        suppressNextPaste = false;
      }, 0);
      void pasteImageAsAnnotation();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? editor.redo() : editor.undo();
    } else if (mod && e.key.toLowerCase() === "c" && io.capabilities.copyPng) {
      e.preventDefault();
      void copyToClipboard();
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void savePng();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault(); // stray Backspace must never trigger browser history-back
      editor.deleteSelected();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (!editor.cancelCrop()) editor.clearSelection();
    } else if (e.key === "Enter") {
      if (editor.hasPendingCrop()) {
        e.preventDefault();
        void editor.applyCrop();
      }
    }
  });

  // ---- input: paste and insert -------------------------------------------------

  /** Reveal the canvas and hide the welcome empty state once the editor has a background image. */
  function showLoadedState(): void {
    stage.classList.remove("empty");
  }

  // Paste is the primary capture path: the user shoots with the OS tool
  // (Win+Shift+S / Cmd+Shift+4) and pastes the result with Ctrl/Cmd+V. Scan for
  // an image item before deciding: only an image paste is intercepted (and
  // replaces the background, discarding any pending inline text edit); a paste
  // with no image is left alone so a focused input's native text paste works.
  window.addEventListener("paste", (e) => {
    if (suppressNextPaste) {
      suppressNextPaste = false;
      e.preventDefault();
      return;
    }
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          void editor
            .loadImageBlob(blob)
            .then(showLoadedState)
            .catch((err) => console.error("paste failed:", err));
        }
        return;
      }
    }
  });

  /** Ctrl+Shift+V handler: read a clipboard image (if any) and insert it as an annotation. */
  async function pasteImageAsAnnotation(): Promise<void> {
    try {
      const bitmap = await io.readClipboardImage!();
      if (bitmap) editor.insertImage(bitmap);
    } catch (err) {
      console.error("clipboard image paste failed:", err);
    }
  }

  const insertImageBtn = document.querySelector<HTMLButtonElement>("#insert-image")!;
  insertImageBtn.addEventListener("click", async () => {
    try {
      const bytes = await io.pickImage();
      if (!bytes) return;
      const bitmap = await bytesToBitmap(bytes, editor.maxImportDimension);
      editor.insertImage(bitmap);
    } catch (err) {
      console.error("insert image failed:", err);
    }
  });

  // Web-only welcome-state affordance (no #capture on iPhone): picking a
  // photo here becomes the background if the editor is still empty, or is
  // inserted as an annotation otherwise. Distinct from #insert-image above,
  // which always inserts-as-annotation and no-ops on an empty editor
  // (TASK-20 AC2) — this button is absent from the desktop shell, so
  // `querySelector` is optional-chained rather than asserted.
  document.querySelector<HTMLButtonElement>("#welcome-pick")?.addEventListener("click", async () => {
    try {
      const bytes = await io.pickImage();
      if (!bytes) return;
      if (editor.hasImage()) {
        const bitmap = await bytesToBitmap(bytes, editor.maxImportDimension);
        editor.insertImage(bitmap);
      } else {
        await editor.loadImage(bytes);
        showLoadedState();
      }
    } catch (err) {
      console.error("choose photo failed:", err);
    }
  });

  // Drag-and-drop of an image file onto the editor (desktop only): if a
  // background is already loaded, the dropped image is inserted as an
  // annotation; if the editor is empty, the dropped image becomes the
  // background instead. The platform layer only decodes the bytes; the
  // insert-vs-background decision depends on editor state, so it stays here.
  io.onExternalImageDrop?.((bytes) => {
    void (async () => {
      try {
        if (editor.hasImage()) {
          const bitmap = await bytesToBitmap(bytes, editor.maxImportDimension);
          editor.insertImage(bitmap);
        } else {
          await editor.loadImage(bytes);
          showLoadedState();
        }
      } catch (err) {
        console.error("drag-drop image insert failed:", err);
      }
    })();
  });

  // ---- share bar ---------------------------------------------------------------

  async function copyToClipboard(): Promise<void> {
    if (!editor.hasImage()) return;
    // The export must not be awaited here: io.copyPng needs to reach
    // navigator.clipboard.write() (web) with no preceding await so Safari's
    // user-gesture window is still open, so it takes a lazy producer and
    // runs the export itself. See src/platform/io.ts's copyPng doc comment.
    await io.copyPng(() => exportPng(editor.doc));
  }
  document.querySelector("#copy")!.addEventListener("click", () => void copyToClipboard());

  /** `YYYYMMDD-HHMMSS` from the local time, used to build a default save filename. */
  function timestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
  }

  async function savePng(): Promise<void> {
    if (!editor.hasImage()) return;
    try {
      const png = await exportPng(editor.doc);
      await io.savePng(png, `soegaki-${timestamp()}.png`);
    } catch (err) {
      console.error("save failed:", err);
    }
  }
  document.querySelector("#save")!.addEventListener("click", () => void savePng());

  // Skitch-style drag-out (desktop only): write a temp PNG, then hand the OS
  // a file drag.
  const dragTab = document.querySelector<HTMLDivElement>("#drag-tab")!;
  dragTab.addEventListener("mousedown", async () => {
    editor.commitPendingText(); // export runs before native blur-commit would land
    if (!editor.hasImage() || !io.capabilities.dragOut) return;
    try {
      const png = await exportPng(editor.doc);
      await io.beginDragOut!(png, `soegaki-${timestamp()}.png`);
    } catch (err) {
      console.error("drag-out failed:", err);
    }
  });

  // ---- capability-gated UI -----------------------------------------------------

  // Hide every capability-specific control whose capability is false. On
  // desktop all capabilities are true, so this is a no-op.
  for (const el of document.querySelectorAll<HTMLElement>("[data-cap]")) {
    const cap = el.dataset.cap as keyof Capabilities;
    if (!io.capabilities[cap]) el.hidden = true;
  }

  return { editor, showLoadedState };
}
