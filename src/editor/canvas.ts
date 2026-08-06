/**
 * Editor: owns the document, the <canvas>, pointer interaction and undo/redo.
 * Rendering of annotation shapes is delegated to render.ts (shared with export).
 */
import {
  type Annotation,
  type Doc,
  type MagnifierPart,
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
import { renderAnnotations } from "./render";
import { History, type DocSnapshot } from "./history";
import { type Bounds, boundsOf, fontString } from "./bounds";
import { hitTest, magnifierHitPart } from "./hittest";
import { decodeClampedBitmap } from "./downscale";
import { computeCrop, fullImageRect, handleAt, applyHandleDrag, MIN_CROP_PX, type CropRect, type CropHandle } from "./crop";
import {
  deriveLensSizeForSource,
  placeLens,
  magnifierSourceRadius,
  defaultSourceRadius,
  magnifierSlideUpdate,
  magnifierSizeLimits,
  MAGNIFIER_GAP_PX,
  type MagnifierSizeLimits,
} from "./magnifier";
import {
  resizeHandlesFor,
  applyResize,
  rotateHandleFor,
  anchorPointFor,
  nearestHandle,
  deleteButtonCornerFor,
  MAGNIFIER_ZOOM_HANDLE_ANGLE,
  type ResizeHandle,
  type AvoidCircle,
} from "./resize";
import {
  angleOf,
  applyRotation,
  canRotate,
  pivotOf,
  pivotOfAnnotation,
  reanchorDelta,
  rotatePoint,
  rotatedCorners,
  rotationFromDrag,
  unrotatePoint,
} from "./rotate";

/** Selection hit-test tolerance in CSS px; scale-compensated to bitmap px at the call site. */
const BASE_TOL_PX = 6;
/** Touch double-tap re-edit window (TASK-35.10), mirroring desktop dblclick (TASK-23). */
const DOUBLE_TAP_MS = 300;
/** Touch double-tap position tolerance in CSS px; scale-compensated to bitmap px at the call site, same pattern as BASE_TOL_PX. */
const DOUBLE_TAP_SLOP_PX = 24;
/** Gap kept between the selection's marquee and the floating delete control, in CSS px (TASK-35.11). */
const SELECTION_CONTROLS_MARGIN_PX = 8;
/** Gap between the magnifier's source ring and its zoom readout label, in CSS px; scale-compensated at the call site. */
const MAGNIFIER_READOUT_MARGIN_PX = 6;
/** Magnifier zoom readout font size, in CSS px; scale-compensated at the call site. */
const MAGNIFIER_READOUT_FONT_PX = 13;
/**
 * `src-zoom` grip chrome (design note "magnifier UX brush-up"), CSS px,
 * all scale-compensated (`* cropScale()`) at the draw site (`drawZoomGrip`):
 * a 16 px accent disc (vs HANDLE_DRAW_PX = 10 for the lens's square corner
 * handles) with a white casing ring and three tangential ridges (perpendicular
 * to the outward radial direction — the scrollbar-thumb / bottom-sheet grab
 * idiom), textured so it reads as draggable at a glance and is unmistakable
 * from the plain square handles: circle vs square, 16 vs 10 px, accent-fill+
 * white-casing vs white-fill+accent-border, textured vs flat.
 */
const MAGNIFIER_ZOOM_GRIP_PX = 16;
const MAGNIFIER_ZOOM_GRIP_CASING_PX = 2;
const MAGNIFIER_ZOOM_GRIP_RIDGE_LEN_PX = 8;
const MAGNIFIER_ZOOM_GRIP_RIDGE_GAP_PX = 3.5;
const MAGNIFIER_ZOOM_GRIP_RIDGE_PX = 1.5;
/**
 * Opacity of the flat accent tint filling the source disc while selected
 * (design note §5) — applied via `ctx.globalAlpha` over `PALETTE[0]`
 * (`fillStyle`) rather than as a second hardcoded copy of the accent color in
 * an rgba() literal. Chrome only, drawn in `drawSelectionOverlay`, never
 * through `renderAnnotations`, so it can never reach `exportPng()`.
 */
const MAGNIFIER_SOURCE_TINT_ALPHA = 0.12;
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
/**
 * Floor for the stage height `applyKeyboardInset` may shrink to, in CSS px.
 * A landscape phone plus an open keyboard can leave less room above the
 * keyboard than the toolbar itself occupies; the image stays small but
 * visible rather than collapsing to nothing.
 */
const KEYBOARD_INSET_MIN_STAGE_PX = 120;
/** Selection marquee padding around the raw `boundsOf` box, in bitmap px (TASK-29; not scale-compensated — a fixed pixel margin regardless of zoom). Also the box the rotate knob's `rotateHandleFor` is positioned from. */
const SELECTION_PAD_PX = 6;
/** Rotate knob offset outside the selection marquee's north edge (its natural, "north" placement — see resize.ts's rotateHandleFor for the south/clamped fallbacks), in CSS px; scale-compensated to bitmap px at the call site. */
const ROTATE_HANDLE_OFFSET_PX = 24;
/**
 * The NOMINAL size (CSS px, scale-compensated at the call site) every rotate
 * knob glyph ratio in `drawSelectionOverlay` keys off — not a literal "draw
 * diameter" of anything on its own (round 4, user-chosen design "A3": a
 * naked circular-arrow glyph with no enclosing disc, see there for the full
 * geometry). The two `ROTATE_GLYPH_*_RATIO` constants below own the glyph's
 * measured radii. Draw size and hit radius are independent:
 * `handleHitRadius`/the knob's grab/tie-break math are unaffected by this
 * constant.
 */
const ROTATE_HANDLE_DRAW_PX = 16;
/**
 * The knob glyph's two measured radii, as ratios of ROTATE_HANDLE_DRAW_PX *
 * cropScale(). They have different jobs and are NOT interchangeable:
 *
 *   SEAM  = arc casing outer radius = arc 0.53 + casing/2 0.175 = 0.705
 *           -> where the connector line stops, so the seam stays flush with
 *              the arc's white casing.
 *   OUTER = the glyph's true maximum extent from its centre, i.e. the largest
 *           of the three candidates (recompute all three on ANY ratio change):
 *             arc casing outer      0.53  + 0.175 = 0.705
 *             arrowhead tip + casing hypot(0.53, 0.29) + 0.095 = 0.699
 *             arrowhead base corner  0.53  + 0.17  + 0.095 = 0.795  <- max
 *           Rounded up to 0.80 so knobMargin()'s "+2" is a real ~2 CSS px of
 *           slack, not a rounding artefact.
 *           -> feeds knobMargin() -> rotateHandleFor's "clamped" placement,
 *              which keeps the whole glyph on-canvas. Drop shadow is
 *              deliberately excluded (cosmetic; clipping it is invisible).
 *
 * Drawn size and grab size stay independent: handleHitRadius() is unaffected.
 */
const ROTATE_GLYPH_SEAM_RATIO = 0.705;
const ROTATE_GLYPH_OUTER_RATIO = 0.80;

/**
 * Rotate cursor (round 3, real-app feedback): a custom `url()` data-SVG —
 * deferred at TASK-41's first pass, adopted now that the plain grab/grabbing
 * keywords alone didn't read as "rotate" either. Two overlaid arc+arrow
 * strokes: a wider white one underneath and a narrower black one on top, so
 * the glyph stays legible over both light and dark backgrounds (the same
 * outline-pass trick `render.ts`'s arrow/rect/text drawing already uses).
 * `#` must stay percent-encoded as `%23` — WebView2 (the desktop app's
 * webview) truncates the data URI at a literal `#`, treating it as a
 * fragment separator. The `, grab` / `, grabbing` keyword fallback covers
 * browsers that reject the custom cursor image for any reason.
 */
const ROTATE_CURSOR_SVG =
  'url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2724%27%20height=%2724%27%20viewBox=%270%200%2024%2024%27%3E%3Cg%20fill=%27none%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M18%2012a6%206%200%201%201-2.2-4.6%27%20stroke=%27%23fff%27%20stroke-width=%274%27/%3E%3Cpath%20d=%27M15.8%203.2v4.4h-4.4%27%20stroke=%27%23fff%27%20stroke-width=%274%27/%3E%3Cpath%20d=%27M18%2012a6%206%200%201%201-2.2-4.6%27%20stroke=%27%23000%27%20stroke-width=%272%27/%3E%3Cpath%20d=%27M15.8%203.2v4.4h-4.4%27%20stroke=%27%23000%27%20stroke-width=%272%27/%3E%3C/g%3E%3C/svg%3E") 12 12';
const ROTATE_CURSOR_HOVER = `${ROTATE_CURSOR_SVG}, grab`;
const ROTATE_CURSOR_ACTIVE = `${ROTATE_CURSOR_SVG}, grabbing`;

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
  // (never incrementally), avoiding drift. `part` is decided once, at grab
  // time, by the same function (`magnifierHitPart`) that decided the hit —
  // "all" for every non-magnifier drag and for a magnifier lens/source body
  // drag alike (translateAnnotation ignores `part` unless kind === "magnifier").
  private move: { original: Annotation; anchor: Point; moved: boolean; part: "all" | MagnifierPart } | null = null;
  // Armed while a select-tool resize handle drag is in progress; mirrors
  // `move` above — `original`/`bounds` are the pre-drag clone and its
  // `boundsOf`, fixed for the whole gesture so each move frame recomputes the
  // resize from the same base (never incrementally, avoiding drift).
  private resize: { handle: ResizeHandle; original: Annotation; bounds: Bounds; changed: boolean } | null = null;
  // Armed while the select tool's rotate-knob is being dragged; mirrors
  // `move`/`resize` — `original` is the pre-drag clone, `pivot` is the
  // PRE-DRAG pivot (fixed for the whole gesture, same anti-drift rationale),
  // and `startAngle`/`startPointer` make the drag relative (grabbing the
  // knob never snaps the shape to the pointer — see rotate.ts's
  // `rotationFromDrag`).
  private rotateDrag: {
    original: Annotation;
    pivot: Point;
    startAngle: number;
    startPointer: Point;
    changed: boolean;
  } | null = null;
  // Armed for the whole duration of a magnifier creation gesture (Addendum A,
  // 2026-08-01a's slide-to-aim revision) — mirrors `move`/`resize`/
  // `rotateDrag`'s "freeze a base at gesture start, recompute from it every
  // frame" anti-drift discipline. `offset` is `at - from` at pointerdown;
  // `radius`/`zoom` are captured here (not just read off the draft) so
  // "sizing cannot change mid-gesture" is structural: `magnifierSlideUpdate`
  // only ever reads them from this frozen object, never from the live draft.
  private magnifierPlace: { offset: Point; radius: number; zoom: number } | null = null;
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
    // Rotation (TASK-41): the pre-edit annotation's angle/pivot, both fixed
    // for the whole edit session (a re-edit never itself changes the angle —
    // only resize/rotate gestures do, and those are impossible while the
    // text editor owns the gesture state). Always 0/{0,0} for a brand-new
    // text (never rotated). See `positionTextEditor` for how these place the
    // CSS-rotated `<input>` at the exact world position `render.ts`'s canvas
    // transform would draw the same local `at` at.
    angle: number;
    pivot: Point;
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
    this.stageResizeObserver = new ResizeObserver(() => {
      this.fitCanvasToStage();
      // An open text editor is positioned from the canvas's on-screen box, so
      // it has to follow every refit — the soft-keyboard inset
      // (`applyKeyboardInset`) resizes the stage *while* the editor is open,
      // which is exactly when the input must not drift off the text it edits.
      // No-op when no editor is open.
      this.positionTextEditor();
    });
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
    this.rotateDrag = null;
    this.magnifierPlace = null;
    this.draft = null;
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
    this.rotateDrag = null;
    this.magnifierPlace = null;
    this.draft = null;
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
    renderAnnotations(ctx, list, this.doc.images, this.doc.imageBitmap);
    if (this.draft) renderAnnotations(ctx, [this.draft], this.doc.images, this.doc.imageBitmap);
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
    this.rotateDrag = null;
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
    this.rotateDrag = null;
    this.magnifierPlace = null;
    this.draft = null;
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
    this.rotateDrag = null;
    this.magnifierPlace = null;
    this.draft = null;
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

  /** The selection marquee's padded box (`SELECTION_PAD_PX` outside the raw `boundsOf`) — the one box both `drawSelectionOverlay`'s draw and `onDown`/`onMove`'s rotate-knob hit-test are positioned from, so drawn position and hit region never drift apart (same discipline as the resize handles below). */
  private paddedBoundsOf(b: Bounds): Bounds {
    return { x: b.x - SELECTION_PAD_PX, y: b.y - SELECTION_PAD_PX, w: b.w + SELECTION_PAD_PX * 2, h: b.h + SELECTION_PAD_PX * 2 };
  }

  /** `rotateHandleFor`'s `margin`, in bitmap px: keeps the knob glyph's own visual radius (`ROTATE_GLYPH_OUTER_RATIO`, not just its center point) clear of the canvas edge, plus a couple px of breathing room. The drop shadow is deliberately excluded. */
  private knobMargin(): number {
    return (ROTATE_HANDLE_DRAW_PX * ROTATE_GLYPH_OUTER_RATIO + 2) * this.cropScale();
  }

  /** The padded box's own edge-midpoint (N/E/S/W) nearest to `p` — the connector-line origin when the knob has been clamped away from the north/south edge (`rotateHandleFor`'s `"clamped"` placement). */
  private nearestPaddedEdgeMidpoint(b: Bounds, p: Point): Point {
    const candidates: Point[] = [
      { x: b.x + b.w / 2, y: b.y },
      { x: b.x + b.w, y: b.y + b.h / 2 },
      { x: b.x + b.w / 2, y: b.y + b.h },
      { x: b.x, y: b.y + b.h / 2 },
    ];
    let best = candidates[0];
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * Whether the pointer at `p` (world coordinates) hits the rotate knob or a
   * resize handle for `selected` — **nearest-wins, knob as tie-break**
   * (TASK-41 round 2 review fix; the original design gave the knob absolute
   * priority, which stole clicks meant for a resize handle that happened to
   * be nearer). Both `onDown`'s arm logic and `onMove`'s hover-cursor logic
   * call this so they can never disagree about which control a given pointer
   * position lands on. Resize handles are hit-tested in the shape's local
   * (unrotated) frame — the pointer is inverse-rotated about the pivot first,
   * an exact no-op at angle 0 — while the knob's `world` position is
   * compared directly, since `rotateHandleFor` already returns it in world
   * space. `r` (from `handleHitRadius(pointerType)`) is used for BOTH checks;
   * the knob's draw offset itself is never touch-enlarged.
   */
  private rotateOrResizeTarget(
    selected: Annotation,
    pointerType: string,
    p: Point,
  ):
    | { kind: "rotate"; bounds: Bounds; angle: number }
    | { kind: "resize"; handle: ResizeHandle; bounds: Bounds }
    | null {
    const bounds = boundsOf(selected, this.ctx);
    const angle = angleOf(selected);
    const r = this.handleHitRadius(pointerType);
    const localP = angle ? unrotatePoint(p, pivotOf(bounds), angle) : p;
    const nearest = nearestHandle(resizeHandlesFor(selected, bounds), localP, r);

    let knobDist: number | null = null;
    if (canRotate(selected.kind)) {
      const knob = rotateHandleFor(
        this.paddedBoundsOf(bounds),
        angle,
        ROTATE_HANDLE_OFFSET_PX * this.cropScale(),
        { w: this.canvas.width, h: this.canvas.height },
        this.knobMargin(),
      );
      knobDist = Math.hypot(p.x - knob.world.x, p.y - knob.world.y);
    }

    if (knobDist !== null && knobDist <= r && (nearest === null || knobDist <= nearest.dist)) {
      return { kind: "rotate", bounds, angle };
    }
    if (nearest !== null) {
      return { kind: "resize", handle: nearest.id, bounds };
    }
    return null;
  }

  /**
   * Dashed marquee around the selected annotation's bounds, plus its resize
   * handles (TASK-29) and, for rotatable kinds (TASK-41), a rotate knob. Not
   * exported (see render()). Handles are square grabbers at screen-constant
   * size (same styling/scale compensation as the crop tool's corner
   * handles), positioned from the same unpadded `boundsOf` used for resize
   * hit-testing in onDown/onMove/hover, so drawn position and hit region
   * always agree. `resizeHandlesFor` returns `[]` for highlight annotations,
   * so they draw no handles here.
   *
   * Everything — marquee, resize handles, rotate knob — is drawn inside a
   * `save/translate(pivot)/rotate/translate(-pivot)/restore` transform when
   * the annotation is rotated (an exact no-op at angle 0, byte-identical to
   * the pre-TASK-41 code path), so their body coordinates stay expressed in
   * the shape's own local frame — the same "one property, one owner" pattern
   * `render.ts`'s draw loop uses. `positionSelectionControls` (the floating
   * delete button) is deliberately called OUTSIDE the transform, after
   * `restore()` — it's a DOM element, not a canvas draw call, and anchors to
   * the *rotated* NE corner itself (`rotatedCorners`) rather than living
   * inside the canvas transform.
   */
  private drawSelectionOverlay(a: Annotation): void {
    const { ctx } = this;
    const b = boundsOf(a, ctx);
    const angle = angleOf(a);
    const padded = this.paddedBoundsOf(b);
    const knob = canRotate(a.kind)
      ? rotateHandleFor(
          padded,
          angle,
          ROTATE_HANDLE_OFFSET_PX * this.cropScale(),
          { w: this.canvas.width, h: this.canvas.height },
          this.knobMargin(),
        )
      : null;

    ctx.save();
    if (angle) {
      const pivot = pivotOf(b);
      ctx.translate(pivot.x, pivot.y);
      ctx.rotate(angle);
      ctx.translate(-pivot.x, -pivot.y);
    }

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeRect(padded.x, padded.y, padded.w, padded.h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE[0];
    ctx.strokeRect(padded.x, padded.y, padded.w, padded.h);
    ctx.setLineDash([]);

    if (a.kind === "magnifier") {
      // Source-disc affordance (design note §5): tint the source disc, MINUS
      // wherever the lens disc covers it, so the tinted region equals (to
      // within tolerance) the region where a press actually starts a
      // "source" drag (hittest.ts's magnifierHitPart tests the lens disc
      // FIRST — see its doc comment), including the fully-contained case,
      // where the tint correctly vanishes.
      //
      // An UN-clipped evenodd fill of a Path2D holding both full circles does
      // NOT do this on its own: evenodd only cancels out the OVERLAP between
      // two disjoint loops, so it independently fills the lens disc's own
      // EXCLUSIVE interior too (every pixel inside the lens but outside the
      // source is crossed exactly once, by the lens loop alone — odd, hence
      // filled) — the normal case, since the lens and source are usually
      // apart, connected only by the connector. (Round-1 review bug: an
      // earlier version of this code used `clip()` + `destination-out` to
      // punch the lens out instead, which is wrong on two counts —
      // `destination-out` only erases by the fill's own alpha (12%), so 88%
      // of the tint survives inside the overlap and the punch doesn't punch;
      // and because this draws on the LIVE canvas after `renderAnnotations`,
      // `destination-out` erases the actual rendered screenshot underneath,
      // not just the tint layer, visibly holing out the picture whenever the
      // lens is dragged onto its own source.)
      //
      // The CLIP is what suppresses the lens's exclusive body (nothing drawn
      // after `clip()` can land outside the source disc at all); `evenodd` is
      // what punches the overlap (within the clip, evenodd on both discs
      // yields exactly source-minus-lens). Neither alone is sufficient; both
      // together, in this order, are.
      const sourceRadius = magnifierSourceRadius(a);
      ctx.save();
      ctx.beginPath();
      ctx.arc(a.from.x, a.from.y, sourceRadius, 0, 2 * Math.PI);
      ctx.clip();
      // The two arc() calls join with an implicit straight segment (end of
      // the first circle to the start of the second), which stays harmless
      // only because it exactly coincides with the implicit closing segment,
      // so the pair cancels for evenodd parity — changing a start angle,
      // adding a third disc, or inserting closePath() between them breaks
      // the fill.
      const tint = new Path2D();
      tint.arc(a.from.x, a.from.y, sourceRadius, 0, 2 * Math.PI);
      tint.arc(a.at.x, a.at.y, a.radius, 0, 2 * Math.PI);
      ctx.globalAlpha = MAGNIFIER_SOURCE_TINT_ALPHA;
      ctx.fillStyle = PALETTE[0];
      ctx.fill(tint, "evenodd");
      ctx.restore();
    }

    const side = HANDLE_DRAW_PX * this.cropScale();
    const half = side / 2;
    ctx.lineWidth = 1.5;
    for (const handle of resizeHandlesFor(a, b)) {
      if (handle.shape === "grip") {
        this.drawZoomGrip(ctx, handle.pos);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(handle.pos.x - half, handle.pos.y - half, side, side);
        ctx.strokeStyle = PALETTE[0];
        ctx.strokeRect(handle.pos.x - half, handle.pos.y - half, side, side);
      }
    }

    if (a.kind === "magnifier") {
      // Zoom readout (design note): selection chrome only, drawn beside the
      // source ring — never through renderAnnotations, so it can never reach
      // exportPng(). Two-pass text (white halo + accent fill), the same
      // legibility trick render.ts's drawText/drawArrow use, since the ring
      // can sit over an arbitrarily light or dark part of the image.
      const sourceRadius = magnifierSourceRadius(a);
      // One decimal, trailing ".0" trimmed: "2.4×", but "3×" not "3.0×".
      const zoomDigits = a.zoom.toFixed(1);
      const label = (zoomDigits.endsWith(".0") ? zoomDigits.slice(0, -2) : zoomDigits) + "×";
      const fontPx = MAGNIFIER_READOUT_FONT_PX * this.cropScale();
      ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const offset = MAGNIFIER_READOUT_MARGIN_PX * this.cropScale() + half;

      // Natural placement: above-right (NE) of the source ring. When that
      // would leave the canvas — the source ring sitting near the top or
      // right edge — mirror to below-left (SW) instead: the same
      // problem-class fix `rotateHandleFor`/`knobMargin` use for the rotate
      // knob (try the natural spot, fall back to the opposite side). Chrome
      // only, so this never touches exported pixels — it only keeps the
      // on-screen readout legible.
      const neX = a.from.x + sourceRadius * Math.SQRT1_2 + offset;
      const neY = a.from.y - sourceRadius * Math.SQRT1_2 - offset;
      const mirror = neX + textWidth > this.canvas.width || neY - fontPx / 2 < 0;
      const labelPos = mirror
        ? { x: a.from.x - sourceRadius * Math.SQRT1_2 - offset, y: a.from.y + sourceRadius * Math.SQRT1_2 + offset }
        : { x: neX, y: neY };

      ctx.textAlign = mirror ? "right" : "left";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;
      ctx.strokeText(label, labelPos.x, labelPos.y);
      ctx.fillStyle = PALETTE[0];
      ctx.fillText(label, labelPos.x, labelPos.y);
    }

    if (knob) {
      // Connector origin follows the placement edge for "north"/"south"; for
      // "clamped" (large/heavily-rotated shape, knob pulled off both edges),
      // it runs from whichever padded-edge midpoint is nearest the actual
      // (clamped) knob position — simplest option that stays inside this one
      // rotated transform, no second canvas pass needed.
      let connectorFrom: Point;
      if (knob.placement === "north") {
        connectorFrom = { x: padded.x + padded.w / 2, y: padded.y };
      } else if (knob.placement === "south") {
        connectorFrom = { x: padded.x + padded.w / 2, y: padded.y + padded.h };
      } else {
        connectorFrom = this.nearestPaddedEdgeMidpoint(padded, knob.local);
      }

      // Naked circular-arrow glyph (round 4, user-chosen design "A3": no
      // enclosing disc — a 260° arc, a filled arrowhead, and a centre pivot
      // dot, PALETTE[0] over a white casing stroke with a soft drop shadow).
      // The knob's geometry is defined relative to the arc, not to any
      // enclosing disc. ROTATE_GLYPH_SEAM_RATIO/ROTATE_GLYPH_OUTER_RATIO
      // (declared above, see their doc comment for the two radii's separate
      // jobs) own the glyph's measured size; OUTER is what knobMargin() ->
      // rotateHandleFor's "clamped" placement uses to keep the whole glyph
      // on-canvas. Any change to the ratios below must be re-checked against
      // both.
      // Drawn size and grab size are independent: handleHitRadius() is
      // unaffected. The glyph deliberately does NOT counter-rotate — it
      // stays inside this same rotated overlay transform, so its tilt reads
      // as the current angle (one source of truth, no separate unrotated
      // draw pass). The whole knob — connector included — is drawn inside
      // one save()/restore() so shadow/lineCap/lineJoin/lineWidth/dash never
      // leak into the marquee or the square resize handles above.
      ctx.save();
      const c = knob.local;
      const D = ROTATE_HANDLE_DRAW_PX * this.cropScale();
      const glyphSeamRadius = ROTATE_GLYPH_SEAM_RATIO * D;

      // 1. Connector — ends at the glyph's seam (the arc casing's outer
      // edge), not its center, so it stays visually flush with the casing.
      const toGlyph = { x: c.x - connectorFrom.x, y: c.y - connectorFrom.y };
      const toGlyphLen = Math.hypot(toGlyph.x, toGlyph.y);
      const toGlyphUnit = toGlyphLen > 0 ? { x: toGlyph.x / toGlyphLen, y: toGlyph.y / toGlyphLen } : { x: 0, y: -1 };
      const connectorEnd = {
        x: c.x - glyphSeamRadius * toGlyphUnit.x,
        y: c.y - glyphSeamRadius * toGlyphUnit.y,
      };
      ctx.beginPath();
      ctx.moveTo(connectorFrom.x, connectorFrom.y);
      ctx.lineTo(connectorEnd.x, connectorEnd.y);
      ctx.strokeStyle = PALETTE[0];
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Arc + arrowhead geometry, every dimension a ratio of D.
      const rg = 0.53 * D;
      const startAngle = (-65 * Math.PI) / 180;
      const endAngle = (195 * Math.PI) / 180; // 260° clockwise sweep
      const u = { x: Math.cos(endAngle), y: Math.sin(endAngle) }; // radial dir at the arc's end
      const t = { x: -Math.sin(endAngle), y: Math.cos(endAngle) }; // tangent dir at the arc's end
      const E = { x: c.x + rg * u.x, y: c.y + rg * u.y }; // point on the arc at endAngle
      const tip = { x: E.x + 0.29 * D * t.x, y: E.y + 0.29 * D * t.y };
      const b1 = { x: E.x + 0.17 * D * u.x, y: E.y + 0.17 * D * u.y };
      const b2 = { x: E.x - 0.17 * D * u.x, y: E.y - 0.17 * D * u.y };

      const traceArc = () => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, rg, startAngle, endAngle, false);
      };
      const traceHead = () => {
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(b1.x, b1.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.closePath();
      };

      // 2. Shadow on — one shadow pass covers both the arc's casing stroke
      // and the arrowhead's casing stroke.
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0.075 * D;
      ctx.shadowBlur = 0.19 * D;

      ctx.lineCap = "round";
      traceArc();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 0.35 * D;
      ctx.stroke();

      ctx.lineJoin = "round";
      traceHead();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 0.19 * D;
      ctx.stroke();

      // 3. Shadow off before the PALETTE[0] passes.
      ctx.shadowColor = "transparent";

      // 4. Main arc stroke.
      traceArc();
      ctx.strokeStyle = PALETTE[0];
      ctx.lineWidth = 0.17 * D;
      ctx.lineCap = "round";
      ctx.stroke();

      // 5. Arrowhead fill (no stroke — the casing pass above is its outline).
      traceHead();
      ctx.fillStyle = PALETTE[0];
      ctx.fill();

      // 6. Centre pivot dot: fill then white stroke.
      ctx.beginPath();
      ctx.arc(c.x, c.y, 0.2 * D, 0, 2 * Math.PI);
      ctx.fillStyle = PALETTE[0];
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 0.09 * D;
      ctx.stroke();

      // 7. restore()
      ctx.restore();
    }

    ctx.restore();

    this.positionSelectionControls(
      padded,
      angle,
      knob ? knob.world : null,
      // Fail-safe for possible future group rotation (TASK-42):
      // `deleteButtonCornerFor` assumes an axis-aligned box, so only feed it
      // `avoid` when the annotation is actually unrotated. True for every
      // magnifier today (`canRotate` excludes "magnifier"), but this keeps
      // the assumption enforced at the call site rather than silently relied
      // on inside the helper.
      a.kind === "magnifier" && angle === 0 ? { center: a.from, radius: magnifierSourceRadius(a) } : null,
    );
  }

  /**
   * Draw the `src-zoom` grip at `pos` (the rim position `resizeHandlesFor`
   * computed — draw and hit-test both derive from that one function, so they
   * can never disagree about where the grip is). Wrapped in its own
   * `save()/restore()` because it sets `lineCap = "round"`, which must not
   * leak into the marquee dash or the square resize handles drawn around it.
   *
   * Geometry (design note §3): an accent-filled disc with a white casing
   * ring, plus three ridges running TANGENTIALLY (perpendicular to the
   * outward radial direction `u`) — the scrollbar-thumb / bottom-sheet grab
   * idiom. `u` is derived from `MAGNIFIER_ZOOM_HANDLE_ANGLE` (resize.ts) —
   * the same angle the handle's rim position is computed from — so this
   * never hardcodes a second copy of that constant.
   */
  private drawZoomGrip(ctx: CanvasRenderingContext2D, pos: Point): void {
    const s = this.cropScale();
    const r = (MAGNIFIER_ZOOM_GRIP_PX / 2) * s;
    const u = { x: Math.cos(MAGNIFIER_ZOOM_HANDLE_ANGLE), y: Math.sin(MAGNIFIER_ZOOM_HANDLE_ANGLE) };
    const t = { x: -u.y, y: u.x };

    ctx.save();
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = PALETTE[0];
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = MAGNIFIER_ZOOM_GRIP_CASING_PX * s;
    ctx.stroke();

    const halfRidge = (MAGNIFIER_ZOOM_GRIP_RIDGE_LEN_PX / 2) * s;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = MAGNIFIER_ZOOM_GRIP_RIDGE_PX * s;
    for (const k of [-1, 0, 1]) {
      const rc = { x: pos.x + u.x * k * MAGNIFIER_ZOOM_GRIP_RIDGE_GAP_PX * s, y: pos.y + u.y * k * MAGNIFIER_ZOOM_GRIP_RIDGE_GAP_PX * s };
      ctx.beginPath();
      ctx.moveTo(rc.x - t.x * halfRidge, rc.y - t.y * halfRidge);
      ctx.lineTo(rc.x + t.x * halfRidge, rc.y + t.y * halfRidge);
      ctx.stroke();
    }

    ctx.restore();
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
    btn.setAttribute("aria-label", "Delete");
    // Feather-style "trash-2" outline icon (stroke-based, currentColor) —
    // the emoji glyph ("🗑") it replaces rendered nearly invisible on iOS
    // (live user feedback), an inline SVG gives crisp, theme-colorable ink.
    btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
      '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
      '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';
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
   * inside the stage viewport. `angle` rotates which world point counts as
   * "NE": `rotatedCorners(paddedBounds, angle)[1]` — an exact identity at
   * angle 0, so this is byte-identical to the pre-TASK-41 corner formula
   * there. The existing viewport-clamp fallback (below) needs no rotation-
   * specific extra case: the knob (N-edge midpoint) and this button (NE
   * corner) stay separated by `paddedBounds.w / 2` independently of angle,
   * since both are rigidly carried by the same rotation — EXCEPT when the
   * knob itself has been clamped/flipped close to the NE corner (small or
   * heavily-rotated shapes), which the `knobWorld` clearance check below
   * covers as a second, independent trigger for the same fallback.
   *
   * `avoid` (magnifier only — the source disc, in WORLD/bitmap coordinates)
   * is consulted LAST, not first: the LEGACY final position (ideal NE +
   * viewport clamp + drop-below fallback, all below) is always computed
   * first, exactly as if `avoid` were null. Only if THAT final rect actually
   * collides with the (clearance-expanded) disc does this fall back to
   * `resize.ts`'s `deleteButtonCornerFor`'s NE -> NW -> SE -> SW corner
   * search; if the legacy rect already clears the disc — including the
   * clamped and drop-below cases — it's used as-is, byte-identical to the
   * pre-avoid behavior. This ordering matters: testing the IDEAL (unclamped)
   * NE rect instead would fire the corner search on lens-near-a-stage-edge
   * cases where the source disc isn't even nearby, just because NE alone
   * doesn't fit the viewport — stealing the legacy clamp/drop-below fallback
   * for a conflict that doesn't exist. `avoid` and `knobWorld` are never
   * both non-null — magnifier is excluded from `canRotate`, so a magnifier
   * selection never has a rotate knob — meaning the disc check and the
   * knob-clearance check below never have to interact.
   */
  private positionSelectionControls(
    paddedBounds: Bounds,
    angle: number,
    knobWorld: Point | null,
    avoid: AvoidCircle | null,
  ): void {
    const btn = this.ensureSelectionControls();
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageRect = this.canvas.parentElement!.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;
    const originX = canvasRect.left - stageRect.left;
    const originY = canvasRect.top - stageRect.top;

    const bw = btn.offsetWidth || 30;
    const bh = btn.offsetHeight || 30;

    const neLocal = rotatedCorners(paddedBounds, angle)[1];
    const neX = originX + neLocal.x * scale;
    const neY = originY + neLocal.y * scale;

    const idealLeft = neX + SELECTION_CONTROLS_MARGIN_PX;
    const idealTop = neY - SELECTION_CONTROLS_MARGIN_PX - bh;

    // Knob clearance (TASK-41 round 2 review fix): distance from the knob's
    // CSS-px center to the nearest point of the IDEAL (unclamped) button
    // rect — computed here, before the viewport clamp below decides where
    // the button actually lands, exactly like the top-edge check it feeds
    // into. Uses the touch-worst-case radius unconditionally: layout must
    // not depend on which pointer type happens to be active right now.
    let knobTooClose = false;
    if (knobWorld) {
      const kx = originX + knobWorld.x * scale;
      const ky = originY + knobWorld.y * scale;
      const dx = Math.max(idealLeft - kx, 0, kx - (idealLeft + bw));
      const dy = Math.max(idealTop - ky, 0, ky - (idealTop + bh));
      const d = Math.hypot(dx, dy);
      knobTooClose = d < HANDLE_HIT_PX * TOUCH_HIT_MULTIPLIER + SELECTION_CONTROLS_MARGIN_PX;
    }

    let left = Math.min(Math.max(idealLeft, 0), stageRect.width - bw);
    let top = Math.min(Math.max(idealTop, 0), stageRect.height - bh);

    // The drop-below-the-corner fallback below has TWO independent triggers:
    // (1) the top-edge viewport clamp (`top !== idealTop` — original
    // TASK-35.11 case: selection near the stage's top edge, no room above
    // the corner) and (2) the rotate knob (TASK-41) landing close enough to
    // the ideal button rect to steal its pointer events. Keep BOTH checks —
    // a future edit that "simplifies" this to just one would silently
    // reintroduce whichever bug the dropped check was guarding against.
    if (top !== idealTop || knobTooClose) {
      // Drop the button below the NE corner instead, clear of the handle's
      // CSS-px hit radius plus the usual margin — `left` is unaffected since
      // a purely horizontal clamp never brings the button into the handle's
      // row (the unclamped placement always sits entirely above it).
      top = Math.min(Math.max(neY + HANDLE_HIT_PX + SELECTION_CONTROLS_MARGIN_PX, 0), stageRect.height - bh);
    }

    // Magnifier source-disc avoidance (design note "magnifier delete button
    // must avoid the source circle"): consulted LAST, against the legacy
    // FINAL rect above — whichever of the ideal/clamped/dropped-below cases
    // produced it — not the ideal (unclamped) rect — so the corner search
    // only engages on an ACTUAL conflict with the disc, never merely because
    // NE alone didn't fit the viewport (see this method's doc comment for
    // why that ordering matters).
    if (avoid) {
      // Expand the disc by the same touch-worst-case clearance
      // `knobTooClose` above uses (`HANDLE_HIT_PX * TOUCH_HIT_MULTIPLIER +
      // SELECTION_CONTROLS_MARGIN_PX`, CSS px). That covers the disc itself
      // plus the src-zoom grip's own touch hit radius (drawn ON the source
      // rim). The zoom readout label sits beside the disc and can extend
      // slightly beyond this clearance in extreme cases (e.g. near the
      // minimum source radius) — acceptable, since the readout is
      // non-interactive chrome, not a pointer target like the grip.
      const avoidCss = {
        center: { x: originX + avoid.center.x * scale, y: originY + avoid.center.y * scale },
        radius: avoid.radius * scale + HANDLE_HIT_PX * TOUCH_HIT_MULTIPLIER + SELECTION_CONTROLS_MARGIN_PX,
      };
      const dxAvoid = Math.max(left - avoidCss.center.x, 0, avoidCss.center.x - (left + bw));
      const dyAvoid = Math.max(top - avoidCss.center.y, 0, avoidCss.center.y - (top + bh));
      const conflicts = Math.hypot(dxAvoid, dyAvoid) < avoidCss.radius;
      if (conflicts) {
        const paddedCss = {
          x: originX + paddedBounds.x * scale,
          y: originY + paddedBounds.y * scale,
          w: paddedBounds.w * scale,
          h: paddedBounds.h * scale,
        };
        const placed = deleteButtonCornerFor(
          paddedCss,
          { w: bw, h: bh },
          SELECTION_CONTROLS_MARGIN_PX,
          { w: stageRect.width, h: stageRect.height },
          avoidCss,
        );
        if (placed) {
          left = placed.left;
          top = placed.top;
        }
        // `placed === null`: no corner clears the disc either — keep the
        // legacy `left`/`top` as the best-effort fallback (status quo).
      }
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
   * The magnifier's current operability size limits (Addendum B, 2026-08-02)
   * — display-scale dependent, so recomputed per call rather than cached
   * (mirrors `tolerance()`/`handleHitRadius()`, which already recompute
   * `cropScale()` per event without trouble; only a window resize mid-drag
   * could change this, and that case is deliberately not special-cased).
   * The one private owner of "what canvas size / scale feed
   * `magnifierSizeLimits`" — `magnifierGeometry` (creation) and the resize
   * branch (`onMove`) both call this instead of re-deriving it.
   */
  private magnifierLimits(): MagnifierSizeLimits {
    return magnifierSizeLimits({ w: this.canvas.width, h: this.canvas.height }, this.cropScale());
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
   * Magnifier's `src-zoom` is a radial drag, so it reuses the diagonal
   * "nwse-resize" cursor. The lens's own corners already map through the box
   * cases above; dragging the source disc body is not a resize handle at all
   * (see hittest.ts's `magnifierHitPart`) — it inherits "move" from the
   * ordinary `hitTest -> "move"` hover fallback, no cursor code needed here.
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
      case "src-zoom":
        return "nwse-resize";
    }
  }

  /**
   * Derive the lens's `{at, radius, zoom}` for a magnifier being created at
   * `from` — the single place `defaultSourceRadius`/`deriveLensSizeForSource`
   * (S/M/L target sizing, magnifier.ts) and `placeLens` (auto-placement,
   * magnifier.ts) are composed into one annotation-shaped result, with
   * `magnifierLimits()` (Addendum B, 2026-08-02) computed once and threaded
   * through both. Simplified from `magnifierGeometry(from, sourceRadius)` so
   * `onDown` cannot forget to apply the operability floor — this is now the
   * ONLY place `defaultSourceRadius` is called. Since Addendum A
   * (2026-08-01a), called only from `onDown`, once per gesture: sizing and
   * placement are frozen at pointerdown (`magnifierPlace`) and never
   * recomputed during the slide (see `magnifierSlideUpdate`).
   */
  private magnifierGeometry(from: Point): { at: Point; radius: number; zoom: number } {
    const canvasSize = { w: this.canvas.width, h: this.canvas.height };
    const limits = this.magnifierLimits();
    const sourceRadius = defaultSourceRadius(canvasSize, limits);
    const { radius, zoom } = deriveLensSizeForSource(sourceRadius, this.size, canvasSize, limits);
    const at = placeLens(from, sourceRadius, radius, canvasSize, MAGNIFIER_GAP_PX);
    return { at, radius, zoom };
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
        this.openTextEditor(hit.at, {
          editId: hit.id,
          value: hit.text,
          color: hit.color,
          fontSize: hit.fontSize,
          angle: angleOf(hit),
          pivot: pivotOfAnnotation(hit, this.ctx),
        });
        return;
      }
    }

    this.canvas.setPointerCapture(e.pointerId);

    if (tool === "select") {
      // Rotate-knob vs. resize-handle: nearest-wins, knob as tie-break
      // (TASK-41 round 2 review fix — see rotateOrResizeTarget's doc
      // comment). Wins over reselecting an overlapping annotation either way:
      // check the currently selected annotation's controls first.
      const selected = this.selectedAnnotation();
      if (selected) {
        const target = this.rotateOrResizeTarget(selected, e.pointerType, p);
        if (target?.kind === "rotate") {
          this.rotateDrag = {
            original: structuredClone(selected),
            pivot: pivotOf(target.bounds),
            startAngle: target.angle,
            startPointer: p,
            changed: false,
          };
          this.canvas.style.cursor = ROTATE_CURSOR_ACTIVE;
          this.render();
          return;
        }
        if (target?.kind === "resize") {
          this.resize = { handle: target.handle, original: structuredClone(selected), bounds: target.bounds, changed: false };
          this.render();
          return;
        }
      }

      this.resize = null;
      const tol = this.tolerance();
      const hit = hitTest(this.doc.annotations, p, this.ctx, tol);
      if (hit) {
        this.selectedId = hit.id;
        // Which half of a magnifier this grab targets, decided once here by
        // the same function (`magnifierHitPart`) that decided the hit — see
        // `move`'s field doc comment. The `?? "lens"` fallback is defensive
        // only (hitTest's magnifier case IS magnifierHitPart, so they cannot
        // disagree); it must never become load-bearing.
        const part: "all" | MagnifierPart = hit.kind === "magnifier" ? (magnifierHitPart(hit, p, tol) ?? "lens") : "all";
        // Do not push history yet: a pure click that never moves is not undoable.
        this.move = { original: structuredClone(hit), anchor: p, moved: false, part };
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
    } else if (tool === "magnifier") {
      // Slide-to-aim creation (Addendum A, 2026-08-01a): pointerdown plants
      // the source at `p` with the default radius, derives {radius, zoom}
      // and the lens's auto-placement ONCE, then FREEZES `offset = at - from`
      // plus `radius`/`zoom` in `magnifierPlace` for the whole gesture — the
      // same "recompute from a fixed base, never incrementally" discipline
      // `move`/`resize`/`rotateDrag` already use. `onMove` (below) only ever
      // reads size/placement back from this frozen object, so a slide can
      // never change what onDown decided.
      const { at, radius, zoom } = this.magnifierGeometry(p);
      this.magnifierPlace = { offset: { x: at.x - p.x, y: at.y - p.y }, radius, zoom };
      this.draft = { ...base, kind: "magnifier", from: p, at, radius, zoom };
    }
    this.render();
  }

  private onMove(p: Point, shiftKey = false, pointerType = ""): void {
    const tool = this.tool;

    // Priority: rotate > resize > move > crop drag > draft > hover.
    if (this.rotateDrag) {
      const { original, pivot, startAngle, startPointer } = this.rotateDrag;
      const newAngle = rotationFromDrag(pivot, startPointer, p, startAngle, shiftKey);
      const updated = applyRotation(original, newAngle);
      if (!this.rotateDrag.changed && updated !== original) {
        // Push before mutate: capture the pre-rotate array on the first frame
        // that actually changes the angle (same lazy pattern as move/resize;
        // applyRotation returns `original` by reference when unchanged, so
        // this is a cheap identity check, no JSON.stringify needed).
        this.rotateDrag.changed = true;
        this.history.push(this.snapshot());
      }
      if (this.rotateDrag.changed) {
        this.doc.annotations = this.doc.annotations.map((a) => (a.id === original.id ? updated : a));
      }
      this.canvas.style.cursor = ROTATE_CURSOR_ACTIVE;
      this.render();
      return;
    }

    if (this.resize) {
      const { handle, original, bounds } = this.resize;
      const angle = angleOf(original);
      // Resize composition (TASK-41): operate in the shape's unrotated local
      // frame — inverse-rotate the pointer about the PRE-DRAG pivot
      // (`pivotOf(bounds)`, fixed for the whole gesture) — then reuse
      // `applyResize` verbatim, then re-anchor so the pinned corner stays
      // world-fixed (see rotate.ts's `reanchorDelta` doc comment for the
      // geometry contract). Every step below is gated on `angle`, so this is
      // an exact no-op — identical code path — at angle 0.
      const localP = angle ? unrotatePoint(p, pivotOf(bounds), angle) : p;
      let updated = applyResize(original, bounds, handle, localP, shiftKey, this.magnifierLimits());
      if (angle) {
        const anchorLocal = anchorPointFor(original, bounds, handle);
        const boundsAfter = boundsOf(updated, this.ctx);
        const d = reanchorDelta(anchorLocal, bounds, boundsAfter, angle);
        if (d.x !== 0 || d.y !== 0) updated = translateAnnotation(updated, d.x, d.y);
      }
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
        // Which part moves was decided once, at grab time, in onDown — see
        // `move`'s field doc comment. A magnifier's lens body-drag moves only
        // `at`; its source body-drag moves only `from`, UNCLAMPED (same
        // "handle drags snap to the pointer, editing never clamps" policy
        // resize.ts's applyMagnifierResize doc comment records for src-zoom's
        // sibling gestures) — dragging one disc must never silently move the
        // other.
        const part = this.move.part;
        this.doc.annotations = this.doc.annotations.map((a) =>
          a.id === this.selectedId ? translateAnnotation(original, dx, dy, part) : a,
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
      } else if (this.draft.kind === "magnifier") {
        // Slide-to-aim (Addendum A): the source follows the pointer exactly
        // (`from = p`) and the lens rides along at the FROZEN offset from
        // `magnifierPlace` (captured once at pointerdown), clamped back
        // on-canvas — `radius`/`zoom` are deliberately untouched here, they
        // cannot change mid-slide. The finger occludes the source, never the
        // lens, so the lens is the live viewfinder the user aims with.
        const canvasSize = { w: this.canvas.width, h: this.canvas.height };
        const { from, at } = magnifierSlideUpdate(p, this.magnifierPlace!, canvasSize);
        this.draft.from = from;
        this.draft.at = at;
      }
      this.render();
      return;
    }

    if (tool === "select") {
      const selected = this.selectedAnnotation();
      const target = selected ? this.rotateOrResizeTarget(selected, pointerType, p) : null;
      if (target?.kind === "rotate") {
        this.canvas.style.cursor = ROTATE_CURSOR_HOVER;
      } else if (target?.kind === "resize") {
        this.canvas.style.cursor = this.cursorForResizeHandle(target.handle);
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
        this.openTextEditor(hit.at, {
          editId: hit.id,
          value: hit.text,
          color: hit.color,
          fontSize: hit.fontSize,
          angle: angleOf(hit),
          pivot: pivotOfAnnotation(hit, this.ctx),
        });
        return;
      }
      this.lastTapUp = { time: performance.now(), p };
    } else {
      this.lastTapUp = null;
    }

    if (this.rotateDrag) {
      this.rotateDrag = null;
      this.canvas.style.cursor = this.tool === "select" ? "default" : "crosshair";
      return;
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
    // Gesture-end choke point: `magnifierPlace`'s lifetime is "one gesture"
    // (matching `draft`'s), not "one branch" — reset here unconditionally,
    // regardless of `d.kind`, rather than only inside the magnifier commit
    // branch below (round-2 review fix: the old placement left it armed
    // whenever a DIFFERENT gesture — rotateDrag/resize/move/crop-drag —
    // returned early above, and relied on every future branch added here
    // remembering to reset it too). Harmless no-op for every non-magnifier
    // kind, since only the magnifier onDown branch ever sets it.
    this.magnifierPlace = null;

    if (d.kind === "magnifier") {
      // Addendum A (2026-08-01a): release always commits unconditionally —
      // a tap is just the zero-length case of the same slide gesture, no
      // separate branch — then hands off to the select tool with the new
      // loupe already selected, so all four adjustment handles and the
      // delete button are live with zero extra taps (the tedium the
      // real-iPhone feedback called out). Ordering below is LOAD-BEARING:
      // setTool("select") calls clearSelection(), which nulls selectedId and
      // renders — setting selectedId before that call would be silently
      // wiped, so it must be set AFTER setTool, followed by one more render
      // to actually draw the now-selected chrome.
      this.commit(d);
      this.setTool("select");
      this.selectedId = d.id;
      this.render();
      return;
    }

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
   * new-text flow: color/fontSize come from the toolbar's current settings,
   * angle is always 0 (a brand-new annotation is never rotated). With `opts`
   * (TASK-23 double-click re-edit, TASK-35.10 touch double-tap, TASK-41
   * rotation), the editor is pre-filled from an existing `TextAnnotation` —
   * `editId` routes `commitTextEditor` into edit-mode semantics (see there)
   * instead of creating a new annotation; `angle`/`pivot` (both computed
   * once by the caller from the pre-edit annotation) position the CSS-rotated
   * `<input>` — see `positionTextEditor`.
   */
  private openTextEditor(
    at: Point,
    opts?: { editId: string; value: string; color: string; fontSize: number; angle: number; pivot: Point },
  ): void {
    this.commitTextEditor(); // idempotent: commit any already-open editor first

    const input = document.createElement("input");
    input.className = "text-editor";
    const color = opts?.color ?? this.color;
    // opts.fontSize (TASK-23 re-edit path) is already-baked from the
    // existing annotation and must stay untouched; only the brand-new-text
    // path applies docScale (TASK-35.16, web-only, always 1 on desktop).
    const fontSize = opts?.fontSize ?? this.fontSize * this.docScale;
    const editId = opts?.editId ?? null;
    const angle = opts?.angle ?? 0;
    const pivot = opts?.pivot ?? { x: 0, y: 0 };
    const reposition = () => this.positionTextEditor();
    // Reassigned below, once the visualViewport listeners (if any) actually
    // exist; the object stored on `this.textEdit` shares this same closure
    // variable, so the later reassignment is visible through it too.
    let clearViewportGuard = () => {};
    this.textEdit = { input, at, color, fontSize, editId, angle, pivot, reposition, clearViewportGuard: () => clearViewportGuard() };

    if (opts) {
      // Edit mode (TASK-23): drop the selection/resize/move gesture state so
      // no marquee or resize handles are drawn over the annotation while its
      // editor is open — a handle click during edit would otherwise arm a
      // resize against a structuredClone taken *before* this edit commits
      // (see onDown's textEdit-commit guard below for the other half of this).
      this.selectedId = null;
      this.move = null;
      this.resize = null;
      this.rotateDrag = null;
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
    // `preventScroll` is load-bearing (Windows/WebView2 report: clicking the
    // text tool at the canvas's right edge slid the whole canvas left). The
    // default focus steps scroll the focused element into view, and this
    // input — ~170px wide, absolutely positioned, anchored at the click point
    // — hangs past #stage's box whenever the canvas fills the stage's width.
    // Chromium then scrolls #stage to reveal it; WebKit does not, which is
    // why only the desktop shell showed it. The canvas must never move just
    // because a text editor opened, so the scroll is suppressed at the source
    // here (and #stage is `overflow: clip` in styles.css, which closes every
    // other scroll path).
    input.focus({ preventScroll: true });
    // Keep the input visible above the iOS soft keyboard (TASK-35.10 AC#3):
    // applied once now and re-applied on every visualViewport resize/scroll
    // (keyboard opening/closing, or iOS panning the visual viewport).
    // Feature-detected and undone on commit/cancel below; a soft keyboard
    // never triggers these events on desktop, so this is a no-op there in
    // practice (see applyKeyboardInset for why it stays inert there).
    const vv = window.visualViewport;
    const stage = this.canvas.parentElement;
    if (vv && stage) {
      const onViewportChange = () => this.applyKeyboardInset();
      vv.addEventListener("resize", onViewportChange);
      vv.addEventListener("scroll", onViewportChange);
      clearViewportGuard = () => {
        vv.removeEventListener("resize", onViewportChange);
        vv.removeEventListener("scroll", onViewportChange);
        // Give the stage its full height back; the ResizeObserver refits the
        // canvas (and the badge bar's own shrink, if open, still applies —
        // this only ever clears the inset written by applyKeyboardInset).
        stage.style.maxHeight = "";
        // iOS standalone-PWA quirk, same nudge as ui/badgebar.ts's
        // restoreViewport: after the keyboard closes the layout viewport can
        // stay panned. The app never scrolls the window itself, so this is a
        // no-op everywhere else.
        if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
      };
      this.applyKeyboardInset();
    }
    // Repaint now: without this, the pre-edit annotation (or, for a brand-new
    // text, nothing) stays whatever render() last drew, and in edit mode that
    // pre-edit text would still be painted as an offset ghost underneath the
    // now-transparent live position (render() skips `editId` while textEdit
    // is set — see render()'s doc comment).
    this.render();
  }

  /**
   * Recompute the input's CSS-px position/font from the stored bitmap-px
   * `at`. When rotated (TASK-41), `at` (the annotation's own local-frame
   * corner) is first mapped to its world position via `rotatePoint(at,
   * pivot, angle)` — the same point `render.ts`'s canvas transform would
   * draw that corner at — and a CSS `rotate(angle)` with `transform-origin:
   * 0 0` reproduces the same visual rotation around the input's own
   * (now-world-positioned) top-left corner; no transform is set at all at
   * angle 0, so this is byte-identical to the pre-TASK-41 behavior there.
   */
  private positionTextEditor(): void {
    if (!this.textEdit) return;
    const { input, at, fontSize, angle, pivot } = this.textEdit;
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageRect = this.canvas.parentElement!.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;
    const worldAt = angle ? rotatePoint(at, pivot, angle) : at;

    input.style.left = `${canvasRect.left - stageRect.left + worldAt.x * scale}px`;
    input.style.top = `${canvasRect.top - stageRect.top + worldAt.y * scale}px`;
    input.style.font = fontString(fontSize * scale);
    input.style.transform = angle ? `rotate(${angle}rad)` : "";
    input.style.transformOrigin = angle ? "0 0" : "";
  }

  /**
   * Make room for the iOS soft keyboard by SHRINKING the stage, so the open
   * text editor's input is never hidden behind it (TASK-35.10 AC#3).
   *
   * Deliberately scrolls nothing. The predecessor of this method was
   * `input.scrollIntoView({ block: "center" })`: the input is an absolutely
   * positioned child of #stage and routinely sticks out past its padding box
   * (a default `<input>` is ~170px wide), which made #stage scrollable — so
   * scrollIntoView scrolled *the stage*, sliding the canvas sideways/up with
   * no way back (#stage has `touch-action: none` while an image is loaded).
   * That was the reported iPhone bug: tapping to enter text displaced the
   * canvas. #stage is now `overflow: hidden` in the annotating state
   * (styles.css), so neither this code nor WebKit's own focus-reveal can
   * scroll it, and making room is a layout change instead, along the path
   * the badge bar already exercises when it shrinks the stage: this writes
   * the stage's `max-height` (its sole owner, cleared in `openTextEditor`'s
   * `clearViewportGuard`), `stageResizeObserver` refits the canvas to the
   * smaller box, and `positionTextEditor` follows the canvas — so the input
   * stays glued to the text it is editing throughout.
   *
   * Inert without a keyboard: with none open, the visual viewport's bottom
   * lies below the stage (the share bar occupies that strip), so the computed
   * max-height exceeds the stage's natural height and `flex: 1` keeps it
   * exactly where it was. Desktop therefore never changes shape.
   */
  private applyKeyboardInset(): void {
    const vv = window.visualViewport;
    const stage = this.canvas.parentElement;
    if (!vv || !stage || !this.textEdit) return;
    // Client-coordinate y of the keyboard's top edge: the visual viewport's
    // bottom expressed in the layout-viewport coordinates that
    // getBoundingClientRect returns (`offsetTop` is non-zero only while iOS
    // pans the visual viewport, e.g. mid-keyboard-animation).
    const keyboardTop = vv.offsetTop + vv.height;
    // The input's overhang past the canvas's bottom edge. The canvas is
    // refitted into the shrunk stage minus its padding, so an input anchored
    // near the bottom of the image would still poke below the canvas by up to
    // one line box; whatever the stage's bottom padding does not already
    // absorb has to come out of the stage's height too.
    const inputBottom = this.textEdit.input.getBoundingClientRect().bottom;
    const canvasBottom = this.canvas.getBoundingClientRect().bottom;
    const padBottom = parseFloat(getComputedStyle(stage).paddingBottom) || 0;
    const overhang = Math.max(0, inputBottom - canvasBottom - padBottom);
    const available = keyboardTop - stage.getBoundingClientRect().top - overhang;
    if (!Number.isFinite(available)) return;
    stage.style.maxHeight = `${Math.max(available, KEYBOARD_INSET_MIN_STAGE_PX)}px`;
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
   *   strokeWidth/angle) exactly as they were, so this is a single undo step
   *   that only ever touches `text` — except that typing widens or narrows
   *   the local box, which moves its pivot; for a rotated annotation (TASK-41)
   *   that would visibly slide the string, so a `reanchorDelta(at, ...)`
   *   translation pins `at` back to its pre-edit world position (an exact
   *   no-op at angle 0, so this is byte-identical to the pre-TASK-41 result
   *   there).
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
          const boundsBefore = boundsOf(existing, this.ctx);
          const updated = { ...existing, text };
          const boundsAfter = boundsOf(updated, this.ctx);
          const angle = angleOf(existing);
          const d = reanchorDelta(existing.at, boundsBefore, boundsAfter, angle);
          const final = d.x || d.y ? translateAnnotation(updated, d.x, d.y) : updated;
          this.doc.annotations = this.doc.annotations.map((a) => (a.id === editId ? final : a));
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
