/**
 * Frontend entry point: wires the toolbar, paste/capture input, keyboard
 * shortcuts and share bar to the Editor. OS-level work (capture, tray,
 * drag-out) lives in src-tauri/.
 */
import { invoke } from "@tauri-apps/api/core";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Editor } from "./editor/canvas";
import { exportPng } from "./editor/exporter";
import { PALETTE, type SizeName, type Tool } from "./editor/model";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const emptyHint = document.querySelector<HTMLParagraphElement>("#empty-hint")!;
const editor = new Editor(canvas);
editor.setTool(editor.tool); // apply initial cursor feedback for the default tool

const captureBtn = document.querySelector<HTMLButtonElement>("#capture")!;

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
  });
  palette.appendChild(swatch);
}

const sizes = document.querySelector<HTMLDivElement>("#sizes")!;
for (const btn of sizes.querySelectorAll<HTMLButtonElement>("button[data-size]")) {
  btn.addEventListener("click", () => {
    editor.setSize(btn.dataset.size as SizeName);
    sizes.querySelector(".active")?.classList.remove("active");
    btn.classList.add("active");
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

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") {
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
