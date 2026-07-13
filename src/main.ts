/**
 * Frontend entry point: wires the toolbar, hotkeys, Tauri events and share bar
 * to the Editor. OS-level work (capture, tray, drag-out) lives in src-tauri/.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { Editor } from "./editor/canvas";
import { exportPng } from "./editor/exporter";
import { PALETTE, type ToolKind } from "./editor/model";

const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!;
const emptyHint = document.querySelector<HTMLParagraphElement>("#empty-hint")!;
const editor = new Editor(canvas);

// ---- toolbar ---------------------------------------------------------------

for (const btn of document.querySelectorAll<HTMLButtonElement>("button.tool")) {
  btn.addEventListener("click", () => {
    editor.tool = btn.dataset.tool as ToolKind;
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

document.querySelector("#undo")!.addEventListener("click", () => editor.undo());
document.querySelector("#redo")!.addEventListener("click", () => editor.redo());

// ---- keyboard --------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    e.shiftKey ? editor.redo() : editor.undo();
  } else if (mod && e.key.toLowerCase() === "c") {
    e.preventDefault();
    void copyToClipboard();
  }
});

// ---- capture events from the Rust core --------------------------------------

// Payload: base64-encoded PNG of the captured region/screen.
void listen<string>("openscrawl://captured", async (event) => {
  const bytes = Uint8Array.from(atob(event.payload), (c) => c.charCodeAt(0));
  await editor.loadImage(bytes);
  emptyHint.style.display = "none";
});

// ---- share bar ---------------------------------------------------------------

async function copyToClipboard(): Promise<void> {
  if (!editor.hasImage()) return;
  const png = await exportPng(editor.doc);
  await writeImage(png);
}
document.querySelector("#copy")!.addEventListener("click", () => void copyToClipboard());

// Skitch-style drag-out: write a temp PNG in Rust, then hand the OS a file drag.
const dragTab = document.querySelector<HTMLDivElement>("#drag-tab")!;
dragTab.addEventListener("mousedown", async () => {
  if (!editor.hasImage()) return;
  try {
    const png = await exportPng(editor.doc);
    const path = await invoke<string>("prepare_drag_file", { png: Array.from(png) });
    await startDrag({ item: [path], icon: path });
  } catch (err) {
    console.error("drag-out failed:", err);
  }
});
