/**
 * Desktop `PlatformIO` implementation: every `@tauri-apps/*` /
 * `@crabnebula/tauri-plugin-drag` call in the app lives here, moved
 * behavior-identical out of `main.ts`. No Tauri import may appear outside
 * this file (see docs/WEB.md, "Code structure").
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { writeImage, readImage } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { decodeClampedBitmap } from "../editor/downscale";
import type { Capabilities, PlatformIO } from "./io";

/** Extensions accepted for image insertion (dialog filter, drag-drop, IPC allowlist). Keep in sync with src-tauri's IMAGE_EXTENSIONS. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

function hasImageExtension(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.includes(ext);
}

const DESKTOP_CAPABILITIES: Capabilities = {
  capture: true,
  pickImage: true,
  savePng: true,
  copyPng: true,
  readClipboardImage: true,
  dragOut: true,
};

export function createTauriIO(): PlatformIO {
  return {
    capabilities: DESKTOP_CAPABILITIES,
    // Desktop has no canvas size ceiling; intentionally unbounded (round 6
    // user decision + architect ruling — restores exact pre-clamp
    // full-resolution behavior).
    maxImportDimension: null,
    // Desktop annotation sizes are unchanged: fixed stroke/radius/font
    // presets, no adaptive scaling (TASK-35.16, web-only).
    annotationScaleBaseline: null,

    async captureBackground(): Promise<Uint8Array> {
      const buf = await invoke<ArrayBuffer>("capture_fullscreen");
      return new Uint8Array(buf);
    },

    async pickImage(): Promise<Uint8Array | null> {
      try {
        const buf = await invoke<ArrayBuffer>("pick_image");
        return new Uint8Array(buf);
      } catch (err) {
        if (String(err) === "CANCELLED") return null;
        throw err;
      }
    },

    async savePng(png: Uint8Array, defaultName: string): Promise<void> {
      await invoke<string | null>("save_png", {
        png: Array.from(png),
        defaultName,
      });
    },

    async copyPng(getPng: () => Promise<Uint8Array>): Promise<void> {
      await writeImage(await getPng());
    },

    async readClipboardImage(): Promise<ImageBitmap | null> {
      const img = await readImage();
      const { width, height } = await img.size();
      const rgba = await img.rgba();
      const data = new ImageData(new Uint8ClampedArray(rgba), width, height);
      // ImageData is a valid ImageBitmapSource, so this routes through the
      // same decode path as every other bytes/Blob -> ImageBitmap path (see
      // downscale.ts) with no adapter needed; max=null (desktop) means this
      // is exactly createImageBitmap(data), unchanged.
      return decodeClampedBitmap(data, null);
    },

    async beginDragOut(png: Uint8Array): Promise<void> {
      // The Rust side names the temp file itself (soegaki-<ts>.png), so the
      // caller-supplied name is not forwarded to prepare_drag_file.
      const path = await invoke<string>("prepare_drag_file", { png: Array.from(png) });
      await startDrag({ item: [path], icon: path });
    },

    onExternalImageDrop(handler: (bytes: Uint8Array) => void): void {
      // Tauri's dragDropEnabled defaults to true, which intercepts the drag
      // before it reaches the DOM as HTML5 drag/drop events — so this is
      // wired through the webview-level onDragDropEvent API instead of DOM
      // listeners.
      void getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type !== "drop") return;
        const path = event.payload.paths.find(hasImageExtension);
        if (!path) return;
        void (async () => {
          try {
            const buf = await invoke<ArrayBuffer>("read_image_file", { path });
            handler(new Uint8Array(buf));
          } catch (err) {
            console.error("drag-drop image insert failed:", err);
          }
        })();
      });
    },

    async openCapturePermissionSettings(): Promise<void> {
      await invoke("open_screen_recording_settings");
    },
  };
}
