/**
 * Web `PlatformIO` implementation: a hidden file input for image picking,
 * Web Share with an `<a download>` fallback for saving, and a best-effort
 * clipboard write. No dependency on any desktop/Tauri API; see docs/WEB.md,
 * "Code structure" and "Build".
 */
import type { Capabilities, PlatformIO } from "./io";
import { MAX_IMPORT_DIMENSION } from "../editor/downscale";
import { ANNOTATION_SCALE_BASELINE } from "../editor/model";

/** Lazily-created, reused hidden file input backing pickImage(). */
let fileInput: HTMLInputElement | null = null;

function getFileInput(): HTMLInputElement {
  if (!fileInput) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
  }
  return fileInput;
}

/** Resolves (with null) and detaches listeners for whichever pickImage() call is currently in flight, if any. */
let cancelActivePick: (() => void) | null = null;

async function pickImage(): Promise<Uint8Array | null> {
  const input = getFileInput();
  // A previous pick can still be pending here: "cancel" is not universally
  // supported (notably iOS Safari <16.4), so a dialog dismissed without a
  // file selected never fires either listener and its promise is left
  // hanging. Without this, this pick's own "change" listener would join the
  // stale one still attached, and a single file selection would resolve
  // BOTH promises with the same bytes — e.g. double-loading it as both the
  // background and an annotation via #welcome-pick. Force the stale pick to
  // resolve null and detach its listeners before wiring this one's.
  cancelActivePick?.();
  input.value = ""; // fresh read each invocation; lets the same file be re-picked

  return new Promise<Uint8Array | null>((resolve) => {
    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      cancelActivePick = null;
    };
    const onChange = () => {
      cleanup();
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    cancelActivePick = () => {
      cleanup();
      resolve(null);
    };
    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    input.click();
  });
}

/** Trigger a browser download of `blob` named `name` via a throwaway <a>. */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  // Revoking immediately after click() can cancel the download in Safari/
  // Firefox if it hasn't started reading the blob yet; defer well past that
  // window instead of revoking synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function savePng(png: Uint8Array, defaultName: string): Promise<void> {
  const blob = new Blob([Uint8Array.from(png)], { type: "image/png" });
  const file = new File([blob], defaultName, { type: "image/png" });
  // Share the file alone: iOS Safari shares the title/text INSTEAD of the file
  // when both are present, so the payload must contain nothing but `files`.
  // The filename still travels with the File object itself.
  const shareData = { files: [file] };
  if (navigator.canShare?.(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      // User-cancelled share sheet: silent no-op, no download fallback.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Any other failure (e.g. no share target available): fall through.
    }
  }
  downloadBlob(blob, defaultName);
}

async function copyPng(getPng: () => Promise<Uint8Array>): Promise<void> {
  // navigator.clipboard.write() must be reached with no preceding await, or
  // Safari silently drops the pending user-gesture activation — so the PNG
  // export runs *after* write() is called, threaded through as the
  // ClipboardItem's pending Blob value instead of being awaited up front.
  const blob = getPng().then((bytes) => new Blob([Uint8Array.from(bytes)], { type: "image/png" }));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function detectCopyPng(): boolean {
  return typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;
}

export function createWebIO(): PlatformIO {
  const capabilities: Capabilities = {
    capture: false,
    pickImage: true,
    savePng: true,
    copyPng: detectCopyPng(),
    readClipboardImage: false,
    dragOut: false,
  };

  return {
    capabilities,
    // iOS Safari's canvas has a hard pixel-count limit; see editor/downscale.ts.
    maxImportDimension: MAX_IMPORT_DIMENSION,
    // Keep annotations a legible fraction of large imported photos; see
    // editor/model.ts's computeAnnotationScale.
    annotationScaleBaseline: ANNOTATION_SCALE_BASELINE,
    pickImage,
    savePng,
    copyPng,
  };
}
