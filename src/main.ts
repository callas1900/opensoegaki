/**
 * Frontend entry point: wires the toolbar, paste/capture input, keyboard
 * shortcuts and share bar to the Editor. OS-level work (capture, tray,
 * drag-out) lives in src-tauri/.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeImage, readImage } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Editor } from "./editor/canvas";
import { exportPng } from "./editor/exporter";
import { PALETTE, type SizeName, type Tool } from "./editor/model";
import { registerPopover, closeOpenPopover } from "./ui/popover";

/** Extensions accepted for image insertion (dialog filter, drag-drop, IPC allowlist). Keep in sync with src-tauri's IMAGE_EXTENSIONS. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

function hasImageExtension(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

/** Decode raw bytes (as returned by an IPC `Response`) into an `ImageBitmap`. */
async function bytesToBitmap(buf: ArrayBuffer): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([buf]));
}

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const emptyHint = document.querySelector<HTMLParagraphElement>("#empty-hint")!;
const editor = new Editor(canvas);
editor.setTool(editor.tool); // apply initial cursor feedback for the default tool

const captureBtn = document.querySelector<HTMLButtonElement>("#capture")!;

const colorBtn = document.querySelector<HTMLButtonElement>("#color-btn")!;
const colorPopover = document.querySelector<HTMLDivElement>("#color-popover")!;
const colorChip = document.querySelector<HTMLSpanElement>("#color-chip")!;
const sizeBtn = document.querySelector<HTMLButtonElement>("#size-btn")!;
const sizePopover = document.querySelector<HTMLDivElement>("#size-popover")!;

registerPopover(colorBtn, colorPopover);
registerPopover(sizeBtn, sizePopover);
colorChip.style.background = editor.color;

// macOS-only: shown when capture_fullscreen rejects with the
// SCREEN_RECORDING_PERMISSION sentinel (no Screen Recording access granted).
// Harmless dead UI on Windows/Linux, where that rejection never occurs.
const permissionModal = document.querySelector<HTMLDivElement>("#permission-modal")!;
const permissionOpenSettingsBtn = document.querySelector<HTMLButtonElement>(
  "#permission-open-settings",
)!;

function showPermissionModal(): void {
  permissionModal.hidden = false;
  permissionOpenSettingsBtn.focus(); // first focusable action, per standard dialog convention
}

function hidePermissionModal(): void {
  permissionModal.hidden = true;
  captureBtn.focus(); // return focus to the control that opened the dialog
}

permissionOpenSettingsBtn.addEventListener("click", () => void invoke("open_screen_recording_settings"));
document.querySelector<HTMLButtonElement>("#permission-dismiss")!.addEventListener("click", hidePermissionModal);
permissionModal.addEventListener("click", (e) => {
  if (e.target === permissionModal) hidePermissionModal(); // click landed on the backdrop, not .modal
});

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
  // The permission modal takes precedence over every other shortcut while
  // open, including the typing-target guard below: Escape must always
  // dismiss it, even if focus somehow ended up in a text input.
  if (e.key === "Escape" && !permissionModal.hidden) {
    e.preventDefault();
    hidePermissionModal();
    return;
  }

  // While the inline text editor (or any other text input) is focused, all
  // global shortcuts are suppressed so native undo/copy/edit keys reach it
  // instead; Escape is handled by the editor's own keydown listener.
  if (isTypingTarget(e.target)) return;

  if (e.key === "Escape" && closeOpenPopover()) {
    e.preventDefault();
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
    // Ctrl+Shift+V: insert the clipboard image as an annotation, distinct
    // from plain Ctrl+V's background-replace semantics (handled only by the
    // `paste` event listener below, left untouched).
    e.preventDefault();
    suppressNextPaste = true;
    setTimeout(() => {
      suppressNextPaste = false;
    }, 0);
    void pasteImageAsAnnotation();
  } else if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? editor.redo() : editor.undo();
  } else if (mod && e.key.toLowerCase() === "c") {
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

// ---- input: paste and full-screen capture -----------------------------------

/** Hide the empty-state hint once the editor has a background image. */
function showLoadedState(): void {
  emptyHint.style.display = "none";
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
    const img = await readImage();
    const { width, height } = await img.size();
    const rgba = await img.rgba();
    const data = new ImageData(new Uint8ClampedArray(rgba), width, height);
    const bitmap = await createImageBitmap(data);
    editor.insertImage(bitmap);
  } catch (err) {
    console.error("clipboard image paste failed:", err);
  }
}

const insertImageBtn = document.querySelector<HTMLButtonElement>("#insert-image")!;
insertImageBtn.addEventListener("click", async () => {
  try {
    const buf = await invoke<ArrayBuffer>("pick_image");
    const bitmap = await bytesToBitmap(buf);
    editor.insertImage(bitmap);
  } catch (err) {
    if (String(err) !== "CANCELLED") console.error("insert image failed:", err);
  }
});

// Drag-and-drop of an image file onto the editor: if a background is already
// loaded, the dropped image is inserted as an annotation; if the editor is
// empty, the dropped image becomes the background instead.
// Tauri's dragDropEnabled defaults to true, which intercepts the drag before
// it reaches the DOM as HTML5 drag/drop events — so this is wired through
// the webview-level onDragDropEvent API instead of DOM listeners.
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const path = event.payload.paths.find(hasImageExtension);
  if (!path) return;
  void (async () => {
    try {
      const buf = await invoke<ArrayBuffer>("read_image_file", { path });
      if (editor.hasImage()) {
        const bitmap = await bytesToBitmap(buf);
        editor.insertImage(bitmap);
      } else {
        await editor.loadImage(new Uint8Array(buf));
        showLoadedState();
      }
    } catch (err) {
      console.error("drag-drop image insert failed:", err);
    }
  })();
});

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  try {
    const invokeStart = performance.now();
    const buf = await invoke<ArrayBuffer>("capture_fullscreen");
    const invokeMs = performance.now() - invokeStart;

    const loadImageStart = performance.now();
    await editor.loadImage(new Uint8Array(buf));
    const loadImageMs = performance.now() - loadImageStart;

    // Perf instrumentation only: dev builds log the client-side legs of the
    // capture round-trip (IPC, bitmap decode) so they can be compared against
    // the `[perf] capture ...` lines OpenSoegaki's Rust side prints for the
    // same capture. The IPC response is raw bytes (no base64), so there is no
    // separate decode leg here.
    if (import.meta.env.DEV) {
      console.log(
        `[perf] capture invoke=${invokeMs.toFixed(0)}ms loadImage=${loadImageMs.toFixed(0)}ms ` +
          `bytes=${buf.byteLength}`,
      );
    }

    showLoadedState();
  } catch (err) {
    // The invoke rejection may arrive as the raw string rather than an Error,
    // so normalize with String() before comparing against the IPC sentinel.
    if (String(err) === "SCREEN_RECORDING_PERMISSION") {
      showPermissionModal();
    } else {
      console.error("capture failed:", err);
    }
  } finally {
    captureBtn.disabled = false;
  }
});

// ---- share bar ---------------------------------------------------------------

async function copyToClipboard(): Promise<void> {
  if (!editor.hasImage()) return;
  const png = await exportPng(editor.doc);
  await writeImage(png);
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
    await invoke<string | null>("save_png", {
      png: Array.from(png),
      defaultName: `soegaki-${timestamp()}.png`,
    });
  } catch (err) {
    console.error("save failed:", err);
  }
}
document.querySelector("#save")!.addEventListener("click", () => void savePng());

// Skitch-style drag-out: write a temp PNG in Rust, then hand the OS a file drag.
const dragTab = document.querySelector<HTMLDivElement>("#drag-tab")!;
dragTab.addEventListener("mousedown", async () => {
  editor.commitPendingText(); // export runs before native blur-commit would land
  if (!editor.hasImage()) return;
  try {
    const png = await exportPng(editor.doc);
    const path = await invoke<string>("prepare_drag_file", { png: Array.from(png) });
    await startDrag({ item: [path], icon: path });
  } catch (err) {
    console.error("drag-out failed:", err);
  }
});
