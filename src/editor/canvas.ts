/**
 * Editor: owns the document, the <canvas>, pointer interaction and undo/redo.
 * Rendering of annotation shapes is delegated to render.ts (shared with export).
 */
import {
  type Annotation,
  type Doc,
  type Point,
  type SizeName,
  type Tool,
  BADGE_RADIUS_PRESETS,
  DEFAULTS,
  FONT_PRESETS,
  PALETTE,
  STROKE_PRESETS,
  computeAnnotationScale,
  nextBadgeNumber,
  nextId,
  renumberBadges,
  translateAnnotation,
} from "./model";
import { fontString, renderAnnotations } from "./render";
import { History, type DocSnapshot } from "./history";
import { boundsOf, hitTest, type Bounds } from "./hittest";
import { decodeClampedBitmap } from "./downscale";
import { computeCrop, fullImageRect, handleAt, applyHandleDrag, MIN_CROP_PX, type CropRect, type CropHandle } from "./crop";
import {
  resizeHandlesFor,
  handleAt as resizeHandleAt,
  applyResize,
  type ResizeHandle,
} from "./resize";

/** Selection hit-test tolerance in CSS px; scale-compensated to bitmap px at the call site. */
const BASE_TOL_PX = 6;
/** Touch double-tap re-edit window (TASK-35.10), mirroring desktop dblclick (TASK-23). */
const DOUBLE_TAP_MS = 300;
/** Touch double-tap position tolerance in CSS px; scale-compensated to bitmap px at the call site, same pattern as BASE_TOL_PX. */
const DOUBLE_TAP_SLOP_PX = 24;
/** Gap kept between the selection's marquee and the floating delete control, in CSS px (TASK-35.11). */
const SELECTION_CONTROLS_MARGIN_PX = 8;
/** Crop corner handle draw size and grab radius, in CSS px; scale-compensated at the call site. */
const HANDLE_DRAW_PX = 10;
const HANDLE_HIT_PX = 12;
/**
 * Multiplier applied to handle grab radii for touch pointers only (round
 * 10, real-iPhone feedback: crop/resize handles visible but hard to grab
 * with a finger). HANDLE_HIT_PX is a mouse-precision default; Apple's HIG
 * recommends ~44pt touch targets, well above that. Mouse/pen pointers are
 * unaffected — this only ever multiplies when `pointerType === "touch"`.
 */
const TOUCH_HIT_MULTIPLIER = 2;
/** Gap kept between the crop corner handle and the floating ✓/✗ controls, in CSS px. */
const HANDLE_MARGIN_PX = HANDLE_DRAW_PX / 2 + 8;
/** Minimum distance (in bitmap px) between consecutive freehand highlighter points, to keep the point list light. */
const HIGHLIGHTER_MIN_POINT_DIST_PX = 2;

export class Editor {
  // doc.images is a monotonic session cache (see model.ts's Doc.images doc
  // comment); it is never cleared by setBackground/restore, only appended to
  // by insertImage.
  readonly doc: Doc = { imageBitmap: null, annotations: [], images: new Map() };
  // Set by bootstrapEditor from the active PlatformIO's maxImportDimension
  // (TASK-35.14, made web-only in round 6): null means unlimited (desktop);
  // a number clamps loadImage/loadImageBlob's decode to that longest side.
  maxImportDimension: number | null = null;
  // Set by bootstrapEditor from the active PlatformIO's annotationScaleBaseline
  // (TASK-35.16, web-only): null means desktop's fixed sizes (docScale stays 1).
  annotationScaleBaseline: number | null = null;
  // Recomputed only by loadImage/loadImageBlob, right after the new
  // background bitmap is assigned (crop deliberately does not recompute —
  // a crop only trims the already-loaded image, it doesn't change what
  // "large" means). Multiplies stroke/radius/font at the three annotation
  // creation sites below; always 1 when annotationScaleBaseline is null.
  private docScale = 1;
  tool: Tool = "arrow";
  // Notified at the end of every setTool() call (TASK-40), including calls
  // made internally by cancelCrop()/applyCrop() when they exit crop mode to
  // "select". Lets bootstrapEditor keep the toolbar's `.active` highlight in
  // sync with editor-initiated tool changes, not just direct button clicks.
  onToolChanged: ((t: Tool) => void) | null = null;
  color: string = DEFAULTS.color;
  strokeWidth: number = DEFAULTS.strokeWidth;
  fontSize: number = DEFAULTS.fontSize;
  size: SizeName = "M";
  selectedId: string | null = null;
  // Badge fixed-number mode (TASK-38): null means auto-sequence (unchanged
  // default behavior); 0..9999 pins every subsequently placed badge to that
  // number instead of drawing from nextBadgeNumber(). Set via the toolbar's
  // digit-palette popover.
  private badgeFixedNumber: number | null = null;

  private readonly history = new History();
  private draft: Annotation | null = null;
  // Armed while a select-tool drag is in progress; `original` is the pre-drag
  // clone so each move frame recomputes the translation from a fixed base
  // (never incrementally), avoiding drift.
  private move: { original: Annotation; anchor: Point; moved: boolean } | null = null;
  // Armed while a select-tool resize handle drag is in progress; mirrors
  // `move` above — `original`/`bounds` are the pre-drag clone and its
  // `boundsOf`, fixed for the whole gesture so each move frame recomputes the
  // resize from the same base (never incrementally, avoiding drift).
  private resize: { handle: ResizeHandle; original: Annotation; bounds: Bounds; changed: boolean } | null = null;
  // Crop tool state: the current region (starts as the full image), the
  // corner handle actively being dragged (if any), and the owned floating
  // ✓/✗ controls overlay + its resize-reposition handler. Never part of doc,
  // history, or renderAnnotations.
  private crop: {
    rect: CropRect;
    drag: CropHandle | null;
    controls: HTMLDivElement;
    reposition: () => void;
  } | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  // Transient DOM overlay for the text tool; never part of doc, history, or renderAnnotations.
  // `editId` is set when re-editing an existing TextAnnotation (TASK-23,
  // double-click) and null for a brand-new text annotation (TASK-7);
  // `render()` skips drawing the `editId` annotation while its editor is open
  // so it isn't double-drawn underneath the input.
  private textEdit: {
    input: HTMLInputElement;
    at: Point;
    color: string;
    fontSize: number;
    editId: string | null;
    reposition: () => void;
    /** Removes the visualViewport listeners set up for this edit session, if any (TASK-35.10); safe to call unconditionally. */
    clearViewportGuard: () => void;
  } | null = null;
  // Last pointerup's time+position for a select-tool "stationary tap on a
  // text annotation" (TASK-35.10 touch double-tap detector); unrelated to
  // `move`/`resize` drag state. Never part of doc/history.
  private lastTapUp: { time: number; p: Point } | null = null;
  // Floating delete-button overlay shown only while an annotation is
  // selected (TASK-35.11), mirroring the crop tool's `controls` overlay
  // above. Owned entirely here: created/positioned in drawSelectionOverlay,
  // torn down in render() once nothing is selected. Never part of doc,
  // history, or renderAnnotations.
  private selectionControls: HTMLButtonElement | null = null;
  // Explicit-sizing fix for a real-iPhone bug (TASK-38 follow-up): when the
  // badge bar opens, #stage (a flex child) shrinks in-flow, but iOS Safari
  // does not re-resolve the canvas's `max-width/max-height: 100%` CSS
  // percentages against the new, smaller stage box — the canvas stays large
  // and its bottom becomes unreachable (#stage has touch-action:none, so it
  // can't even be scrolled to). Observing the stage and writing explicit
  // inline width/height keeps the canvas's on-screen box in sync with the
  // stage on every layout change, independent of whether the browser
  // decides to re-resolve percentage sizing. The CSS max-width/max-height
  // percentages have been removed entirely (see src/styles.css #canvas) —
  // a stale one-axis clamp from a "backstop" percentage would distort the
  // aspect ratio, so this JS sizing is now the sole authority. Editor is the
  // SOLE display-sizing authority for the canvas: no other module may set
  // its inline size or max-size. A legacy pixel-max routine in main-web.ts
  // once did (fitCanvasToStage, "round 9") and caused one-axis clamps —
  // aspect distortion — when the stage resized without a window resize (the
  // legacy routine only listened for window/orientation/visualViewport
  // resize events, so it never re-ran).
  private readonly stageResizeObserver: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
    this.bindPointerEvents();
    this.stageResizeObserver = new ResizeObserver(() => this.fitCanvasToStage());
    if (this.canvas.parentElement) this.stageResizeObserver.observe(this.canvas.parentElement);
  }

  /**
   * Explicitly size the canvas's on-screen (CSS) box to fit inside its
   * parent stage element, applying the same shrink-to-fit-never-upscale
   * behavior that `max-width/max-height: 100%` CSS would give — but done
   * entirely in JS (see the `stageResizeObserver` doc comment above for why
   * CSS percentages can't be used here). Called after every point where the
   * canvas's width/height
   * *attributes* change or the image is replaced/cleared, and on every
   * observed stage resize (e.g. the badge bar opening/closing).
   */
  private fitCanvasToStage(): void {
    const stage = this.canvas.parentElement;
    if (!stage) return;
    if (!this.hasImage()) {
      // Canvas is display:none on the welcome screen; clear any inline size
      // left over from a previous document so a fresh load starts clean.
      this.canvas.style.width = "";
      this.canvas.style.height = "";
      return;
    }
    const cs = getComputedStyle(stage);
    const cw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ch = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const scale = Math.min(1, cw / this.canvas.width, ch / this.canvas.height);
    if (!Number.isFinite(scale) || scale <= 0) {
      this.canvas.style.width = "";
      this.canvas.style.height = "";
      return;
    }
    const w = `${this.canvas.width * scale}px`;
    const h = `${this.canvas.height * scale}px`;
    // Guard against ResizeObserver feedback loops: only write when the
    // computed box actually differs from what's already applied.
    if (this.canvas.style.width !== w) this.canvas.style.width = w;
    if (this.canvas.style.height !== h) this.canvas.style.height = h;
  }

  /** Load a captured PNG (raw bytes) as the new background. */
  async loadImage(png: Uint8Array): Promise<void> {
    const blob = new Blob([png as BlobPart], { type: "image/png" });
    const bmp = await decodeClampedBitmap(blob, this.maxImportDimension);
    this.setBackground(bmp);
  }

  /** Load an arbitrary image blob (e.g. from a clipboard paste) as the new background. */
  async loadImageBlob(blob: Blob): Promise<void> {
    const bmp = await decodeClampedBitmap(blob, this.maxImportDimension);
    this.setBackground(bmp);
  }

  /**
   * Insert `bitmap` as a new image annotation, scaled to fit within 90% of
   * the canvas (never upscaled) and centered. No-op if there is no
   * background image loaded yet. The bitmap is cached in `doc.images` keyed
   * by the new annotation's id, then committed through the normal
   * history-push+append path so the insertion is undoable.
   */
  insertImage(bitmap: ImageBitmap): void {
    if (!this.hasImage()) return;
    const canvasW = this.doc.imageBitmap!.width;
    const canvasH = this.doc.imageBitmap!.height;
    const scale = Math.min(1, (0.9 * canvasW) / bitmap.width, (0.9 * canvasH) / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    const at: Point = { x: (canvasW - width) / 2, y: (canvasH - height) / 2 };

    const id = nextId();
    this.doc.images.set(id, bitmap);
    this.commit({
      id,
      kind: "image",
      color: DEFAULTS.color,
      strokeWidth: DEFAULTS.strokeWidth,
      at,
      width,
      height,
    });
    this.render();
  }

  /**
   * Shared tail of loadImage/loadImageBlob: replace the background and resize
   * the canvas. If a document is already loaded, the previous {background,
   * annotations} snapshot is pushed onto history first so the replacement is
   * undoable; on the very first load there is nothing to undo back to, so
   * history is cleared instead.
   */
  private setBackground(bitmap: ImageBitmap): void {
    // The pending text belongs to the old image; discard rather than commit onto the new one.
    this.cancelTextEditor();
    // doc.images is intentionally NOT cleared here: it's a monotonic session
    // cache keyed by annotation id (see model.ts), so undo/redo across a
    // background replacement can still find bitmaps for image annotations
    // that predate it.
    if (this.doc.imageBitmap !== null) {
      this.history.push(this.snapshot());
    } else {
      this.history.clear();
    }
    this.doc.imageBitmap = bitmap;
    this.doc.annotations = [];
    this.selectedId = null;
    this.move = null;
    this.resize = null;
    this.teardownCrop();
    this.canvas.width = bitmap.width;
    this.canvas.height = bitmap.height;
    this.fitCanvasToStage();
    this.recomputeDocScale();
    // If the crop tool is active (including when it was selected before any
    // image existed, leaving initCrop() a no-op at the time), the new image
    // now has a bitmap to crop: re-initialize a fresh full-image region
    // instead of leaving a dead toolbar state. initCrop() renders internally,
    // so only one of these two paths renders.
    if (this.tool === "crop") this.initCrop();
    else this.render();
  }

  undo(): void {
    const prev = this.history.undo(this.snapshot());
    if (prev) this.restore(prev);
  }

  redo(): void {
    const next = this.history.redo(this.snapshot());
    if (next) this.restore(next);
  }

  // Returns a live reference to doc.annotations; safe only because every caller
  // that stores this snapshot routes it through History's cloneSnapshot first.
  private snapshot(): DocSnapshot {
    return { imageBitmap: this.doc.imageBitmap, annotations: this.doc.annotations };
  }

  /** Apply a restored snapshot, resizing the canvas to match its background before rendering. */
  private restore(snapshot: DocSnapshot): void {
    this.cancelTextEditor();
    this.doc.imageBitmap = snapshot.imageBitmap;
    this.doc.annotations = snapshot.annotations;
    // doc.images is not touched here either — same monotonic-cache rationale
    // as setBackground(): a redo that brings back an ImageAnnotation must
    // still find its bitmap.
    // The restored array may not contain the previously selected id, and even
    // if it does by coincidence, the highlight would be misleading.
    this.selectedId = null;
    this.move = null;
    this.resize = null;
    this.teardownCrop();
    if (snapshot.imageBitmap) {
      this.canvas.width = snapshot.imageBitmap.width;
      this.canvas.height = snapshot.imageBitmap.height;
    }
    this.fitCanvasToStage();
    // TASK-36: recompute here too — undoing/redoing a background replacement
    // previously left docScale stale on web (a pre-existing latent bug: the
    // restored document's annotations are already-baked and unaffected, but
    // any *new* annotation drawn afterward would have used the wrong scale).
    this.recomputeDocScale();
    // Mirrors setBackground: if the crop tool is active, re-initialize a
    // fresh full-image region on the restored image instead of leaving a
    // dead crop-tool state after undo/redo. initCrop() renders internally,
    // so only one of these two paths renders. The hasImage() guard keeps the
    // null-bitmap case (redo of a clear) on the render() path — initCrop()
    // would no-op without rendering, leaving stale canvas pixels.
    if (this.tool === "crop" && this.hasImage()) this.initCrop();
    else this.render();
  }

  /**
   * Recompute `docScale` from the current background (TASK-35.16's
   * adaptive sizing). Single choke point called from every place the
   * background can change: `setBackground` (new load), `restore`
   * (undo/redo), and `clearDocument` (below). An absent bitmap (0) is
   * treated as "below baseline" by `computeAnnotationScale`, i.e. `1`.
   */
  private recomputeDocScale(): void {
    const bitmap = this.doc.imageBitmap;
    this.docScale = computeAnnotationScale(
      bitmap ? Math.max(bitmap.width, bitmap.height) : 0,
      this.annotationScaleBaseline,
    );
  }

  render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.doc.imageBitmap) ctx.drawImage(this.doc.imageBitmap, 0, 0);
    // While re-editing an existing text annotation, skip drawing it here —
    // the DOM input overlay is its live stand-in (see `textEdit` doc comment).
    const editId = this.textEdit?.editId ?? null;
    const list = editId ? this.doc.annotations.filter((a) => a.id !== editId) : this.doc.annotations;
    renderAnnotations(ctx, list, this.doc.images);
    if (this.draft) renderAnnotations(ctx, [this.draft], this.doc.images);
    // Selection chrome is drawn last, directly on the live canvas context only —
    // never through renderAnnotations, so it can never reach exportPng().
    const selected = this.selectedAnnotation();
    if (selected) this.drawSelectionOverlay(selected);
    else this.teardownSelectionControls();
    this.drawCropOverlay();
  }

  hasImage(): boolean {
    return this.doc.imageBitmap !== null;
  }

  /** Switch the active tool, clearing any selection and updating cursor feedback. */
  setTool(t: Tool): void {
    this.tool = t;
    // Activating the crop tool (re)initializes a fresh full-image region with
    // handles; every other tool tears it down. Do this before clearSelection()'s
    // render so that render reflects the final state.
    if (t === "crop") this.initCrop();
    else this.teardownCrop();
    this.clearSelection();
    this.canvas.style.cursor = t === "select" ? "default" : "crosshair";
    this.onToolChanged?.(t);
  }

  clearSelection(): void {
    this.selectedId = null;
    this.move = null;
    this.resize = null;
    this.render();
  }

  /** Set the stroke width / font size used by newly drawn annotations. */
  setSize(name: SizeName): void {
    this.size = name;
    this.strokeWidth = STROKE_PRESETS[name];
    this.fontSize = FONT_PRESETS[name];
  }

  /** Current badge fixed-number mode: null (auto-sequence) or the pinned 0..9999 number. Read by the toolbar popover to highlight its active state. */
  getBadgeFixedNumber(): number | null {
    return this.badgeFixedNumber;
  }

  /** Pin every subsequently placed badge to `n` (clamped to an integer 0..9999); null returns to auto-sequencing. */
  setBadgeFixedNumber(n: number | null): void {
    this.badgeFixedNumber = n === null ? null : Math.min(9999, Math.max(0, Math.round(n)));
  }

  /** Export sinks call this to materialize any in-flight inline text before reading `doc`. */
  commitPendingText(): void {
    this.commitTextEditor();
  }

  deleteSelected(): void {
    if (this.selectedId === null) return;
    this.history.push(this.snapshot());
    this.doc.annotations = this.doc.annotations.filter((a) => a.id !== this.selectedId);
    this.doc.annotations = renumberBadges(this.doc.annotations);
    this.selectedId = null;
    this.render();
  }

  /**
   * Discard the document back to the welcome/empty state (TASK-36).
   * Undoable: the current doc is pushed to history first, so one undo
   * restores it (until the next image load clears history — see
   * `setBackground`).
   */
  clearDocument(): void {
    if (!this.hasImage()) return;
    this.history.push(this.snapshot()); // same push mechanism setBackground/TASK-19 uses
    this.cancelTextEditor();
    this.teardownCrop();
    this.doc.imageBitmap = null;
    this.doc.annotations = [];
    this.selectedId = null;
    this.move = null;
    this.resize = null;
    // history and doc.images deliberately preserved: the pushed snapshot references them.
    this.recomputeDocScale();
    this.fitCanvasToStage();
    this.render();
  }

  /**
   * True while the crop tool has an active region awaiting Enter/✓ (apply,
   * exits to select) or Esc/✗ (cancel, exits to select).
   */
  hasPendingCrop(): boolean {
    return this.crop !== null;
  }

  /**
   * Initialize crop state: the region starts as the full loaded image with
   * corner handles, plus a floating ✓/✗ controls overlay (owned like
   * `textEdit.input`). No-op if there is no image or crop is already active.
   */
  private initCrop(): void {
    if (!this.hasImage() || this.crop) return;
    const bitmap = this.doc.imageBitmap!;

    const controls = document.createElement("div");
    controls.className = "crop-controls";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "crop-apply";
    apply.title = "Apply crop (Enter)";
    apply.textContent = "✓";
    apply.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.applyCrop();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "crop-cancel";
    cancel.title = "Cancel crop (Esc)";
    cancel.textContent = "✗";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cancelCrop();
    });
    controls.appendChild(apply);
    controls.appendChild(cancel);
    this.canvas.parentElement!.appendChild(controls);

    const reposition = () => this.positionCropControls();
    window.addEventListener("resize", reposition);

    this.crop = { rect: fullImageRect(bitmap.width, bitmap.height), drag: null, controls, reposition };
    this.render();
  }

  /** Tear down crop state and its DOM overlay. Does not render (callers render). */
  private teardownCrop(): void {
    if (!this.crop) return;
    this.crop.controls.remove();
    window.removeEventListener("resize", this.crop.reposition);
    this.crop = null;
  }

  /**
   * Discard the pending crop region and exit crop mode to the select tool
   * (TASK-40; amends TASK-4 AC#5, which kept crop mode active on cancel).
   * The document is never touched — only the in-flight region is dropped.
   * Routed entirely through `setTool("select")`, which tears crop down,
   * clears selection and renders. Re-cropping means re-activating the crop
   * tool, which re-initializes a fresh full-image region. Returns false if
   * there was no active crop.
   */
  cancelCrop(): boolean {
    if (!this.crop) return false;
    this.setTool("select");
    return true;
  }

  /**
   * Apply the pending crop and exit crop mode to the select tool (TASK-40;
   * amends TASK-4 AC#5). If the region is edited (not the untouched
   * full-image rect, and not below the minimum size), re-rasterizes the
   * background to it and translates every annotation by the crop origin, as
   * a single undoable step (the same `{ imageBitmap, annotations }` snapshot
   * mechanism as background replacement). If the region is untouched or
   * degenerate, nothing is applied and no history step is pushed — either
   * way, crop mode exits to select. Re-cropping means re-activating the crop
   * tool, which re-initializes a fresh full-image region.
   */
  async applyCrop(): Promise<void> {
    if (!this.crop || !this.hasImage()) return;
    const src = this.doc.imageBitmap!;
    const r = this.crop.rect;
    const rect = computeCrop({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, src.width, src.height, MIN_CROP_PX);
    if (!rect) {
      // Region is already full-image or below the minimum size: nothing to
      // apply, but ✓ still exits crop mode (no history push).
      this.setTool("select");
      return;
    }
    const cropped = await createImageBitmap(src, rect.x, rect.y, rect.w, rect.h);
    // The document may have changed (new paste/capture, undo/redo) while awaiting.
    // Note: setBackground/restore may have already torn down and, if the crop
    // tool was still active, re-initialized `this.crop` for the *new* image
    // during this await — this stale abort path never touches `this.crop`, so
    // it is safe to just discard the outdated bitmap and return regardless.
    if (this.doc.imageBitmap !== src) {
      cropped.close();
      return;
    }
    this.history.push(this.snapshot());
    this.doc.imageBitmap = cropped;
    this.doc.annotations = this.doc.annotations.map((a) => translateAnnotation(a, -rect.x, -rect.y));
    this.canvas.width = rect.w;
    this.canvas.height = rect.h;
    this.fitCanvasToStage();
    this.selectedId = null;
    this.move = null;
    this.resize = null;
    // Exit crop mode to select on the newly-cropped image (setTool renders).
    // Guarded: switching tools during the await already tore crop down (and,
    // if the crop tool was re-armed for a *different* image meanwhile, that
    // state must not be clobbered here) — in that case just render directly.
    if (this.crop) this.setTool("select");
    else this.render();
  }

  private selectedAnnotation(): Annotation | undefined {
    return this.selectedId === null
      ? undefined
      : this.doc.annotations.find((a) => a.id === this.selectedId);
  }

  /**
   * Dashed marquee around the selected annotation's bounds, plus its resize
   * handles (TASK-29). Not exported (see render()). Handles are square
   * grabbers at screen-constant size (same styling/scale compensation as the
   * crop tool's corner handles), positioned from the same unpadded `boundsOf`
   * used for resize hit-testing in onDown/onMove/hover, so drawn position and
   * hit region always agree. `resizeHandlesFor` returns `[]` for highlight
   * annotations, so they draw no handles here.
   */
  private drawSelectionOverlay(a: Annotation): void {
    const { ctx } = this;
    const b = boundsOf(a, ctx);
    const pad = 6;
    const x = b.x - pad;
    const y = b.y - pad;
    const w = b.w + pad * 2;
    const h = b.h + pad * 2;

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE[0];
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    const side = HANDLE_DRAW_PX * this.cropScale();
    const half = side / 2;
    ctx.lineWidth = 1.5;
    for (const handle of resizeHandlesFor(a, b)) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(handle.pos.x - half, handle.pos.y - half, side, side);
      ctx.strokeStyle = PALETTE[0];
      ctx.strokeRect(handle.pos.x - half, handle.pos.y - half, side, side);
    }

    this.positionSelectionControls({ x, y, w, h });
  }

  /**
   * Lazily create the floating delete-button overlay (TASK-35.11): a touch
   * affordance for the keyboard-only Delete/Backspace shortcut, mirroring
   * the crop tool's own floating ✓/✗ overlay. Deletes through the exact same
   * `deleteSelected()` path as the keyboard shortcut — no separate logic.
   */
  private ensureSelectionControls(): HTMLButtonElement {
    if (this.selectionControls) return this.selectionControls;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "selection-delete";
    btn.title = "Delete (Delete/Backspace)";
    btn.textContent = "🗑";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteSelected();
    });
    this.canvas.parentElement!.appendChild(btn);
    this.selectionControls = btn;
    return btn;
  }

  /** Tear down the floating delete-button overlay, if present. */
  private teardownSelectionControls(): void {
    if (!this.selectionControls) return;
    this.selectionControls.remove();
    this.selectionControls = null;
  }

  /**
   * Position the floating delete button just outside the selection
   * marquee's NE corner, using the same bitmap-px -> CSS-px mapping as
   * `positionCropControls`/`positionTextEditor`, clamped to stay fully
   * inside the stage viewport.
   */
  private positionSelectionControls(paddedBounds: { x: number; y: number; w: number; h: number }): void {
    const btn = this.ensureSelectionControls();
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageRect = this.canvas.parentElement!.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;
    const originX = canvasRect.left - stageRect.left;
    const originY = canvasRect.top - stageRect.top;

    const neX = originX + (paddedBounds.x + paddedBounds.w) * scale;
    const neY = originY + paddedBounds.y * scale;

    const bw = btn.offsetWidth || 30;
    const bh = btn.offsetHeight || 30;

    const idealLeft = neX + SELECTION_CONTROLS_MARGIN_PX;
    const idealTop = neY - SELECTION_CONTROLS_MARGIN_PX - bh;
    let left = Math.min(Math.max(idealLeft, 0), stageRect.width - bw);
    let top = Math.min(Math.max(idealTop, 0), stageRect.height - bh);

    if (top !== idealTop) {
      // The default above-the-corner placement got pulled down by the
      // viewport clamp (selection near the top stage edge, where there's
      // no room above the corner): that clamped spot can land on top of the
      // NE resize handle (TASK-29) and steal its pointer events. Drop the
      // button below the NE corner instead, clear of the handle's CSS-px
      // hit radius plus the usual margin — `left` is unaffected since a
      // purely horizontal clamp never brings the button into the handle's
      // row (the unclamped placement always sits entirely above it).
      top = Math.min(Math.max(neY + HANDLE_HIT_PX + SELECTION_CONTROLS_MARGIN_PX, 0), stageRect.height - bh);
    }

    btn.style.left = `${left}px`;
    btn.style.top = `${top}px`;
  }

  /**
   * Dimmed exterior + dashed border + corner handles for the active crop
   * region. Not exported (see render()). Also repositions the floating
   * ✓/✗ controls so they track the rect every frame.
   */
  private drawCropOverlay(): void {
    if (!this.crop) return;
    const { ctx, canvas } = this;
    const { x, y, w, h } = this.crop.rect;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, y); // top
    ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h)); // bottom
    ctx.fillRect(0, y, x, h); // left
    ctx.fillRect(x + w, y, canvas.width - (x + w), h); // right

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE[0];
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    const side = HANDLE_DRAW_PX * this.cropScale();
    const half = side / 2;
    const corners: Point[] = [
      { x, y },
      { x: x + w, y },
      { x, y: y + h },
      { x: x + w, y: y + h },
    ];
    ctx.lineWidth = 1.5;
    for (const c of corners) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(c.x - half, c.y - half, side, side);
      ctx.strokeStyle = PALETTE[0];
      ctx.strokeRect(c.x - half, c.y - half, side, side);
    }

    this.positionCropControls();
  }

  /**
   * Position the floating ✓/✗ controls in stage-local CSS px, near the crop
   * rect's bottom-right corner, using the same bitmap-px -> CSS-px mapping as
   * `positionTextEditor`. The default placement is outside the region,
   * offset down-right of the SE handle by `HANDLE_MARGIN_PX` so the group
   * never sits on top of (and steals clicks from) the handle. When that
   * placement would be clamped back onto the handle — the crop rect touching
   * the stage's bottom/right edge — the group instead goes inside the
   * region, offset up-left of the SE handle by the same margin, keeping the
   * handle clear from the other side. A final clamp keeps the group fully
   * inside the stage viewport regardless of which placement was chosen.
   */
  private positionCropControls(): void {
    if (!this.crop) return;
    const { controls, rect } = this.crop;
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageEl = this.canvas.parentElement!;
    const stageRect = stageEl.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;
    const originX = canvasRect.left - stageRect.left;
    const originY = canvasRect.top - stageRect.top;

    const seX = originX + (rect.x + rect.w) * scale;
    const seY = originY + (rect.y + rect.h) * scale;

    const cw = controls.offsetWidth || 72;
    const ch = controls.offsetHeight || 32;

    let left = seX + HANDLE_MARGIN_PX;
    let top = seY + HANDLE_MARGIN_PX;

    const clampedLeft = Math.min(Math.max(left, 0), stageRect.width - cw);
    const clampedTop = Math.min(Math.max(top, 0), stageRect.height - ch);
    if (clampedLeft !== left || clampedTop !== top) {
      // Outward placement got clamped back onto the handle: flip to inside
      // the region, offset up-left of the SE corner by the same margin.
      left = seX - HANDLE_MARGIN_PX - cw;
      top = seY - HANDLE_MARGIN_PX - ch;
    }

    // Final clamp so the control group stays fully inside the stage viewport
    // regardless of which placement branch ran above.
    left = Math.min(Math.max(left, 0), stageRect.width - cw);
    top = Math.min(Math.max(top, 0), stageRect.height - ch);

    controls.style.left = `${left}px`;
    controls.style.top = `${top}px`;
  }

  // ---- pointer interaction -------------------------------------------------

  private bindPointerEvents(): void {
    this.canvas.addEventListener("pointerdown", (e) => this.onDown(this.toCanvas(e), e));
    this.canvas.addEventListener("pointermove", (e) => this.onMove(this.toCanvas(e), e.shiftKey, e.pointerType));
    this.canvas.addEventListener("pointerup", (e) => this.onUp(this.toCanvas(e)));
  }

  /** Map client coords to canvas bitmap coords (canvas may be CSS-scaled). */
  private toCanvas(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  /** Hit-test tolerance in bitmap px, compensating for CSS scaling of the canvas. */
  private tolerance(): number {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / rect.width;
    return BASE_TOL_PX * scale;
  }

  /** Bitmap-px-per-CSS-px scale factor for the (possibly CSS-scaled) canvas. */
  private cropScale(): number {
    const rect = this.canvas.getBoundingClientRect();
    return this.canvas.width / rect.width;
  }

  /**
   * Crop/resize-handle grab radius in bitmap px, compensating for CSS
   * scaling. `pointerType` is the triggering PointerEvent's own field
   * (`"touch"`, `"mouse"`, `"pen"`, or `""` if unknown) — only `"touch"`
   * enlarges the radius (TOUCH_HIT_MULTIPLIER); mouse/pen get exactly the
   * pre-round-10 radius, unchanged.
   */
  private handleHitRadius(pointerType: string): number {
    const touchMultiplier = pointerType === "touch" ? TOUCH_HIT_MULTIPLIER : 1;
    return HANDLE_HIT_PX * touchMultiplier * this.cropScale();
  }

  /** Resize cursor for a given corner handle. */
  private cursorForHandle(h: CropHandle): string {
    return h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize";
  }

  /**
   * Resize cursor for a select-tool resize handle (TASK-29). Box handles map
   * to the matching cardinal/diagonal cursor; arrow endpoints use "move" —
   * dragging either endpoint repositions a point, not a directional resize.
   */
  private cursorForResizeHandle(h: ResizeHandle): string {
    switch (h) {
      case "nw":
      case "se":
        return "nwse-resize";
      case "ne":
      case "sw":
        return "nesw-resize";
      case "n":
      case "s":
        return "ns-resize";
      case "e":
      case "w":
        return "ew-resize";
      case "from":
      case "to":
        return "move";
    }
  }

  /** Resize handles for the currently selected annotation, or [] if nothing is selected. */
  private selectedHandles(): ReturnType<typeof resizeHandlesFor> {
    const selected = this.selectedAnnotation();
    return selected ? resizeHandlesFor(selected, boundsOf(selected, this.ctx)) : [];
  }

  private onDown(p: Point, e: PointerEvent): void {
    if (!this.hasImage()) return;
    const tool = this.tool;

    if (tool === "text") {
      // No pointer capture: text editing hands input focus to the DOM overlay.
      // preventDefault() is load-bearing: canceling pointerdown suppresses the
      // compatibility mousedown's default action, which would otherwise move
      // focus to the (non-focusable) canvas -> body right after we focus the
      // input, firing blur -> commitTextEditor() -> the editor self-destructs
      // with an empty value before the user can type anything.
      e.preventDefault();
      this.openTextEditor(p);
      return;
    }

    if (tool === "crop") {
      // Manages its own pointer capture: only a handle grab takes capture.
      // A press elsewhere in the region (or if crop state is somehow absent)
      // is inert — no capture, no draft.
      if (!this.crop) return;
      const h = handleAt(p, this.crop.rect, this.handleHitRadius(e.pointerType));
      if (h) {
        this.canvas.setPointerCapture(e.pointerId);
        this.crop.drag = h;
        this.canvas.style.cursor = this.cursorForHandle(h);
        this.render();
      }
      return;
    }

    // A pointerdown elsewhere on the canvas while the text editor is still
    // open (e.g. a resize-handle click, which lands on the canvas rather
    // than the <input>) must see already-committed state: otherwise a
    // hitTest/structuredClone taken here could arm resize/move against the
    // pre-edit annotation, and the input's blur -> commitTextEditor() (whose
    // ordering relative to this handler is not guaranteed) could then apply
    // *after*, so the subsequent resize/move would silently overwrite the
    // just-typed edit. Commit synchronously, before any hit-testing.
    if (tool === "select" && this.textEdit) {
      this.commitTextEditor();
    }

    // TASK-23: a double-click on a text annotation re-opens the inline editor
    // pre-filled with its current text. Detected here, before
    // setPointerCapture, because a captured pointer would otherwise arm a
    // select/move drag underneath the reopened editor. preventDefault() is
    // the same focus guard as the text-tool branch above.
    if (tool === "select" && e.detail >= 2) {
      const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance());
      if (hit && hit.kind === "text") {
        e.preventDefault();
        this.openTextEditor(hit.at, { editId: hit.id, value: hit.text, color: hit.color, fontSize: hit.fontSize });
        return;
      }
    }

    this.canvas.setPointerCapture(e.pointerId);

    if (tool === "select") {
      // A resize handle hit wins over reselecting an overlapping annotation:
      // check the currently selected annotation's handles first.
      const selected = this.selectedAnnotation();
      if (selected) {
        const bounds = boundsOf(selected, this.ctx);
        const h = resizeHandleAt(resizeHandlesFor(selected, bounds), p, this.handleHitRadius(e.pointerType));
        if (h) {
          this.resize = { handle: h, original: structuredClone(selected), bounds, changed: false };
          this.render();
          return;
        }
      }

      this.resize = null;
      const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance());
      if (hit) {
        this.selectedId = hit.id;
        // Do not push history yet: a pure click that never moves is not undoable.
        this.move = { original: structuredClone(hit), anchor: p, moved: false };
      } else {
        this.selectedId = null;
        this.move = null;
      }
      this.render();
      return;
    }

    // docScale (TASK-35.16, web-only, always 1 on desktop) scales
    // creation-time stroke/radius/font so annotations keep roughly the same
    // visual fraction of a large imported photo; covers arrow/rect/highlight
    // via `base.strokeWidth` here (highlight already multiplies again at
    // render, unaffected by this) and badge's radius just below.
    const base = { id: nextId(), color: this.color, strokeWidth: this.strokeWidth * this.docScale };

    if (tool === "badge") {
      // Fixed-number mode (TASK-38): every click stamps the pinned number as
      // a manual badge, exempt from auto-sequencing; unset (null) is the
      // unchanged auto-sequence behavior.
      const fixed = this.badgeFixedNumber;
      this.commit({
        ...base,
        kind: "badge",
        at: p,
        number: fixed !== null ? fixed : nextBadgeNumber(this.doc.annotations),
        radius: BADGE_RADIUS_PRESETS[this.size] * this.docScale,
        ...(fixed !== null ? { manual: true } : {}),
      });
      this.render();
      return;
    }

    if (tool === "arrow") {
      this.draft = { ...base, kind: "arrow", from: p, to: p };
    } else if (tool === "rect") {
      this.draft = { ...base, kind: "rect", a: p, b: p };
    } else if (tool === "highlight") {
      this.draft = { ...base, kind: "highlight", points: [p] };
    }
    this.render();
  }

  private onMove(p: Point, shiftKey = false, pointerType = ""): void {
    const tool = this.tool;

    // Priority: resize > move > crop drag > draft > hover.
    if (this.resize) {
      const { handle, original, bounds } = this.resize;
      const updated = applyResize(original, bounds, handle, p, shiftKey);
      if (!this.resize.changed && !this.annotationsEqual(updated, original)) {
        // Push before mutate: capture the pre-resize array on the first frame
        // that actually changes geometry (same lazy pattern as `move` above).
        this.resize.changed = true;
        this.history.push(this.snapshot());
      }
      if (this.resize.changed) {
        // Keyed off the armed gesture's own id, not `selectedId` — the two
        // should always agree, but this is the more robust source of truth
        // for "which annotation is this drag replacing" (hardens TASK-23's
        // interaction with TASK-29: selectedId can change or clear out from
        // under an in-flight gesture in ways this drag state should not
        // follow).
        this.doc.annotations = this.doc.annotations.map((a) => (a.id === original.id ? updated : a));
      }
      this.canvas.style.cursor = this.cursorForResizeHandle(handle);
      this.render();
      return;
    }

    if (this.move) {
      const dx = p.x - this.move.anchor.x;
      const dy = p.y - this.move.anchor.y;
      if (!this.move.moved && (dx !== 0 || dy !== 0)) {
        // Push before mutate: capture the pre-move array on the first real frame.
        this.move.moved = true;
        this.history.push(this.snapshot());
      }
      if (this.move.moved) {
        const original = this.move.original;
        this.doc.annotations = this.doc.annotations.map((a) =>
          a.id === this.selectedId ? translateAnnotation(original, dx, dy) : a,
        );
      }
      this.canvas.style.cursor = "grabbing";
      this.render();
      return;
    }

    if (this.crop?.drag) {
      const bitmap = this.doc.imageBitmap!;
      this.crop.rect = applyHandleDrag(this.crop.rect, this.crop.drag, p, bitmap.width, bitmap.height, MIN_CROP_PX);
      this.render();
      return;
    }

    if (this.draft) {
      if (this.draft.kind === "arrow") this.draft.to = p;
      else if (this.draft.kind === "rect") this.draft.b = p;
      else if (this.draft.kind === "highlight") {
        if (shiftKey) {
          // Straight-line mode: y locked to the stroke's starting point (horizontal marking).
          const first = this.draft.points[0];
          this.draft.points = [first, { x: p.x, y: first.y }];
        } else {
          const last = this.draft.points[this.draft.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= HIGHLIGHTER_MIN_POINT_DIST_PX) {
            this.draft.points.push(p);
          }
        }
      }
      this.render();
      return;
    }

    if (tool === "select") {
      const resizeHover = resizeHandleAt(this.selectedHandles(), p, this.handleHitRadius(pointerType));
      if (resizeHover) {
        this.canvas.style.cursor = this.cursorForResizeHandle(resizeHover);
      } else {
        const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance());
        this.canvas.style.cursor = hit ? "move" : "default";
      }
    } else if (tool === "crop" && this.crop) {
      const h = handleAt(p, this.crop.rect, this.handleHitRadius(pointerType));
      this.canvas.style.cursor = h ? this.cursorForHandle(h) : "default";
    }
  }

  /** Cheap deep-equality for plain annotation data (no functions/Maps/bitmaps in the model itself), used to detect the first resize frame that actually changes geometry. */
  private annotationsEqual(a: Annotation, b: Annotation): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private onUp(p: Point): void {
    // Touch double-tap re-edit (TASK-35.10): touch pointer events don't carry
    // a native double-click `detail` counter the way mouse events do (see
    // onDown's `e.detail >= 2` branch, TASK-23), so a second stationary
    // release on the same text annotation within DOUBLE_TAP_MS/-SLOP is
    // treated the same way, reusing the exact same re-edit call. Only a
    // "moved" false select-tool release on a text hit is a candidate; any
    // other release (drag, non-text hit, other tool) resets the sequence.
    // Falls through unchanged to the existing branch dispatch below either
    // way, so a non-double-tap release still gets its normal cleanup.
    if (this.tool === "select" && this.move && !this.move.moved && this.move.original.kind === "text") {
      const hit = this.move.original;
      const prevTap = this.lastTapUp;
      const isDoubleTap =
        !!prevTap &&
        performance.now() - prevTap.time <= DOUBLE_TAP_MS &&
        Math.hypot(p.x - prevTap.p.x, p.y - prevTap.p.y) <= DOUBLE_TAP_SLOP_PX * this.cropScale();
      if (isDoubleTap) {
        this.lastTapUp = null;
        this.move = null;
        this.canvas.style.cursor = "default";
        this.openTextEditor(hit.at, { editId: hit.id, value: hit.text, color: hit.color, fontSize: hit.fontSize });
        return;
      }
      this.lastTapUp = { time: performance.now(), p };
    } else {
      this.lastTapUp = null;
    }

    if (this.resize) {
      this.resize = null;
      this.canvas.style.cursor = this.tool === "select" ? "default" : "crosshair";
      return;
    }

    if (this.move) {
      this.move = null;
      // The pointer hasn't necessarily moved since the last hover check, so
      // fall back to the tool's resting cursor rather than leaving "grabbing".
      this.canvas.style.cursor = this.tool === "select" ? "default" : "crosshair";
      return;
    }

    if (this.crop?.drag) {
      // Handle release commits nothing to history; the crop only becomes
      // undoable state on applyCrop().
      this.crop.drag = null;
      this.canvas.style.cursor = "crosshair";
      this.render();
      return;
    }

    if (!this.draft) return;
    const d = this.draft;
    this.draft = null;
    // Ignore accidental clicks that produced a zero-size shape.
    const degenerate =
      (d.kind === "arrow" && d.from.x === d.to.x && d.from.y === d.to.y) ||
      (d.kind === "rect" && d.a.x === d.b.x && d.a.y === d.b.y) ||
      (d.kind === "highlight" && (d.points.length < 2 || d.points.every((pt) => pt.x === d.points[0].x && pt.y === d.points[0].y)));
    if (!degenerate) this.commit(d);
    this.render();
  }

  private commit(a: Annotation): void {
    this.history.push(this.snapshot());
    this.doc.annotations = [...this.doc.annotations, a];
  }

  // ---- inline text editing --------------------------------------------------
  // A single DOM <input> overlay is the live preview for the text tool. It is
  // transient DOM only: never part of doc, never in history, never rendered
  // through renderAnnotations (so it can never be rasterized into an export).

  /**
   * Open the inline text editor at `at`. With no `opts`, this is the TASK-7
   * new-text flow: color/fontSize come from the toolbar's current settings.
   * With `opts` (TASK-23 double-click re-edit), the editor is pre-filled from
   * an existing `TextAnnotation` — `editId` routes `commitTextEditor` into
   * edit-mode semantics (see there) instead of creating a new annotation.
   */
  private openTextEditor(at: Point, opts?: { editId: string; value: string; color: string; fontSize: number }): void {
    this.commitTextEditor(); // idempotent: commit any already-open editor first

    const input = document.createElement("input");
    input.className = "text-editor";
    const color = opts?.color ?? this.color;
    // opts.fontSize (TASK-23 re-edit path) is already-baked from the
    // existing annotation and must stay untouched; only the brand-new-text
    // path applies docScale (TASK-35.16, web-only, always 1 on desktop).
    const fontSize = opts?.fontSize ?? this.fontSize * this.docScale;
    const editId = opts?.editId ?? null;
    const reposition = () => this.positionTextEditor();
    // Reassigned below, once the visualViewport listeners (if any) actually
    // exist; the object stored on `this.textEdit` shares this same closure
    // variable, so the later reassignment is visible through it too.
    let clearViewportGuard = () => {};
    this.textEdit = { input, at, color, fontSize, editId, reposition, clearViewportGuard: () => clearViewportGuard() };

    if (opts) {
      // Edit mode (TASK-23): drop the selection/resize/move gesture state so
      // no marquee or resize handles are drawn over the annotation while its
      // editor is open — a handle click during edit would otherwise arm a
      // resize against a structuredClone taken *before* this edit commits
      // (see onDown's textEdit-commit guard below for the other half of this).
      this.selectedId = null;
      this.move = null;
      this.resize = null;
    }

    this.positionTextEditor();
    input.style.color = color;
    if (opts) input.value = opts.value;
    this.canvas.parentElement!.appendChild(input);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitTextEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelTextEditor();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        // Defensive: prevent WebView2's native save-page accelerator from
        // firing mid-edit. Ctrl+S stays inert while the text editor is open.
        e.preventDefault();
      }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => this.commitTextEditor());
    window.addEventListener("resize", reposition);
    input.focus();
    // Keep the input visible above the iOS soft keyboard (TASK-35.10): an
    // initial scroll-into-view, then re-applied on every visualViewport
    // resize/scroll (keyboard opening/closing, or the page nudging to keep
    // the focused field on-screen). Feature-detected and removed on
    // commit/cancel below; a soft keyboard never triggers these events on
    // desktop, so this is a no-op there in practice.
    input.scrollIntoView({ block: "center" });
    const vv = window.visualViewport;
    if (vv) {
      const onViewportChange = () => input.scrollIntoView({ block: "center" });
      vv.addEventListener("resize", onViewportChange);
      vv.addEventListener("scroll", onViewportChange);
      clearViewportGuard = () => {
        vv.removeEventListener("resize", onViewportChange);
        vv.removeEventListener("scroll", onViewportChange);
      };
    }
    // Repaint now: without this, the pre-edit annotation (or, for a brand-new
    // text, nothing) stays whatever render() last drew, and in edit mode that
    // pre-edit text would still be painted as an offset ghost underneath the
    // now-transparent live position (render() skips `editId` while textEdit
    // is set — see render()'s doc comment).
    this.render();
  }

  /** Recompute the input's CSS-px position/font from the stored bitmap-px `at`. */
  private positionTextEditor(): void {
    if (!this.textEdit) return;
    const { input, at, fontSize } = this.textEdit;
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageRect = this.canvas.parentElement!.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;

    input.style.left = `${canvasRect.left - stageRect.left + at.x * scale}px`;
    input.style.top = `${canvasRect.top - stageRect.top + at.y * scale}px`;
    input.style.font = fontString(fontSize * scale);
  }

  /**
   * Commit the open editor's value. Two modes, keyed by `textEdit.editId`:
   *
   * - New text (`editId === null`, TASK-7): a non-blank value creates a new
   *   `TextAnnotation` via the normal `commit()` (push + append); a blank
   *   value is silently discarded (no history push).
   * - Edit mode (`editId` set, TASK-23): a blank value **deletes** the
   *   existing annotation (push + filter, mirroring `deleteSelected()`); an
   *   unchanged value is a no-op (no history push, just re-render to
   *   un-hide it); a changed value pushes once and replaces the annotation
   *   in place — `{ ...existing, text }` keeps id/color/fontSize/at (and
   *   strokeWidth) exactly as they were, so this is a single undo step that
   *   only ever touches `text`.
   */
  private commitTextEditor(): void {
    if (!this.textEdit) return;
    const { input, at, color, fontSize, editId, reposition, clearViewportGuard } = this.textEdit;
    const text = input.value;
    this.textEdit = null;
    input.remove();
    window.removeEventListener("resize", reposition);
    clearViewportGuard();

    if (editId) {
      const existing = this.doc.annotations.find((a) => a.id === editId);
      if (existing && existing.kind === "text") {
        if (text.trim() === "") {
          this.history.push(this.snapshot());
          this.doc.annotations = this.doc.annotations.filter((a) => a.id !== editId);
          this.doc.annotations = renumberBadges(this.doc.annotations);
          if (this.selectedId === editId) this.selectedId = null;
        } else if (text !== existing.text) {
          this.history.push(this.snapshot());
          this.doc.annotations = this.doc.annotations.map((a) => (a.id === editId ? { ...existing, text } : a));
        }
        // else: unchanged — no history push, just fall through to re-render
        // (which un-hides the annotation now that textEdit is cleared).
      }
      this.render();
      return;
    }

    if (text.trim() !== "") {
      this.commit({ id: nextId(), color, strokeWidth: this.strokeWidth, kind: "text", at, text, fontSize });
    }
    this.render();
  }

  private cancelTextEditor(): void {
    if (!this.textEdit) return;
    const { input, reposition, clearViewportGuard } = this.textEdit;
    this.textEdit = null;
    input.remove();
    window.removeEventListener("resize", reposition);
    clearViewportGuard();
    this.render();
  }
}
