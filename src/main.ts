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

// ---- toolbar ---------------------------------------------------------------

for (const btn of document.querySelectorAll<HTMLButtonElement>("button.tool")) {
  btn.addEventListener("click", () => {
    editor.setTool(btn.dataset.tool as Tool);
    document.querySelector("button.tool.active")?.classList.remove("active");
    btn.classList.add("active");
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
    editor.clearSelection();
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

const captureBtn = document.querySelector<HTMLButtonElement>("#capture")!;
captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  try {
    const b64 = await invoke<string>("capture_fullscreen");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await editor.loadImage(bytes);
    showLoadedState();
  } catch (err) {
    console.error("capture failed:", err);
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
      defaultName: `scrawl-${timestamp()}.png`,
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
