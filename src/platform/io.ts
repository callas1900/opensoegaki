/**
 * Platform seam: every OS-integration operation `src/app.ts` needs, behind
 * one interface. Desktop (Tauri) and web implementations each construct a
 * `PlatformIO`; `bootstrapEditor` never talks to `@tauri-apps/*` (or any web
 * API replacing it) directly. See docs/WEB.md, "PlatformIO contract".
 */

/** Which platform operations are available; gates both wiring and `[data-cap]` UI visibility. */
export interface Capabilities {
  /** OS full-screen capture (desktop only): replaces the Rust `capture_fullscreen` command. */
  capture: boolean;
  /** Choose an image from disk/photos: replaces the desktop `pick_image` dialog. */
  pickImage: boolean;
  /** Persist/share a PNG: replaces the desktop `save_png` file dialog. */
  savePng: boolean;
  /** Put a PNG on the clipboard: replaces the desktop clipboard-manager `writeImage`. */
  copyPng: boolean;
  /** Read an image from the clipboard (Ctrl+Shift+V insert): replaces the desktop clipboard-manager `readImage`. */
  readClipboardImage: boolean;
  /** Native drag-out of the rendered PNG (desktop only): replaces `prepare_drag_file` + `startDrag`. */
  dragOut: boolean;
}

export interface PlatformIO {
  readonly capabilities: Capabilities;
  /**
   * Longest side, in px, an imported image (background or inserted
   * annotation) is downscaled to before it enters the editor. `null` means
   * no limit — desktop has no canvas size ceiling and is intentionally
   * unbounded. Web sets this to `MAX_IMPORT_DIMENSION` (see
   * `editor/downscale.ts`): iOS Safari's canvas has a hard pixel-count
   * limit that blanks out very large (e.g. 12 MP) images rather than
   * erroring.
   */
  readonly maxImportDimension: number | null;
  /**
   * Baseline long-side px an annotation's stroke/radius/font presets were
   * tuned for; `null` means desktop's fixed sizes are used unchanged. Web
   * sets this to `ANNOTATION_SCALE_BASELINE` (see `editor/model.ts`'s
   * `computeAnnotationScale`) so annotations keep roughly the same visual
   * fraction of a large imported photo instead of reading as hairline-thin.
   */
  readonly annotationScaleBaseline: number | null;
  /** Desktop: `capture_fullscreen` invoke. */
  captureBackground?(): Promise<Uint8Array>;
  /** Desktop: `pick_image` invoke; web: `<input type=file>`. */
  pickImage(): Promise<Uint8Array | null>;
  /** Desktop: `save_png` invoke; web: share/download. */
  savePng(png: Uint8Array, defaultName: string): Promise<void>;
  /**
   * Desktop: clipboard-manager `writeImage`; web: `ClipboardItem`. Takes a
   * lazy producer rather than pre-computed bytes: Safari requires
   * `navigator.clipboard.write()` to be called synchronously within the
   * triggering user gesture's call stack, so the PNG export must happen
   * *inside* `copyPng` (behind the `ClipboardItem` Promise value on web),
   * never awaited by the caller before `copyPng` is invoked.
   */
  copyPng(getPng: () => Promise<Uint8Array>): Promise<void>;
  /** Desktop only: clipboard-manager `readImage`. */
  readClipboardImage?(): Promise<ImageBitmap | null>;
  /** Desktop only: `prepare_drag_file` invoke + `startDrag`. */
  beginDragOut?(png: Uint8Array, name: string): Promise<void>;
  /**
   * Desktop only: webview `onDragDropEvent` + `read_image_file` invoke.
   * Deviates from the docs/WEB.md draft signature, which passed an
   * `insert: boolean` decided by the platform layer: only the caller knows
   * whether the editor currently holds a background image, so the
   * insert-vs-background decision stays in `bootstrapEditor` and the handler
   * here only carries the decoded bytes. See docs/WEB.md for the note.
   */
  onExternalImageDrop?(handler: (bytes: Uint8Array) => void): void;
  /** macOS only: `open_screen_recording_settings` invoke. */
  openCapturePermissionSettings?(): Promise<void>;
}
