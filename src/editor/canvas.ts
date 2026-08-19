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
import { renderAnnotations, magnifierMarkerStroke } from "./render";
import { History, type DocSnapshot } from "./history";
import { type Bounds, boundsOf, fontString } from "./bounds";
import { hitTest, magnifierHitPart } from "./hittest";
import { decodeClampedBitmap } from "./downscale";
import {
  computeCrop,
  fullImageRect,
  handleAt,
  applyHandleDrag,
  cropFrameSize,
  cropFrameFor,
  normalizeRect,
  denormalizeRect,
  rotateNormRect,
  frameToRotatedSource,
  tiltFromDrag,
  FULL_NORM,
  MIN_CROP_PX,
  TILT_DEADBAND_RAD,
  type CropRect,
  type CropHandle,
  type CropFrame,
  type NormRect,
} from "./crop";
import {
  deriveLensSizeForSource,
  deriveRectLensSize,
  placeLens,
  placeRectLens,
  magnifierSourceRadius,
  magnifierSourceRect,
  magnifierLensRect,
  defaultSourceRadius,
  magnifierSlideUpdate,
  magnifierRectSlideUpdate,
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
  magnifierSourceBodyWins,
  MAGNIFIER_ZOOM_HANDLE_ANGLE,
  type ResizeHandle,
  type AvoidCircle,
} from "./resize";
import {
  angleOf,
  applyRotation,
  canRotate,
  documentRotation,
  normalizeAngle,
  pivotOf,
  pivotOfAnnotation,
  reanchorDelta,
  rotateAnnotationForDocument,
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
 * a 16 px accent disc (vs HANDLE_DRAW_PX = 10 for the other square resize
 * handles — a shape's own box/corner handles, or, for a rect magnifier as of
 * Addendum I (2026-08-09), the 8 handles ringing the SOURCE rect) with a
 * white casing ring and three tangential ridges (perpendicular to the
 * outward radial direction — the scrollbar-thumb / bottom-sheet grab idiom),
 * textured so it reads as draggable at a glance and is unmistakable from the
 * plain square handles: circle vs square, 16 vs 10 px, accent-fill+
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
/**
 * Minimum half-extent of a RECT magnifier's source drag target, CSS px
 * (Addendum G, 2026-08-08, §G3). 44 CSS px across on touch — Apple HIG's
 * minimum touch target — once `TOUCH_HIT_MULTIPLIER` is applied, same as
 * every other touch-scaled hit region in this file. This is the fingertip
 * floor that moved OUT of the rect source's drawn size (now a legibility-only
 * floor, `magnifier.ts`'s `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX`) and INTO its
 * hit region instead — see `magnifierSourceMinHit`, below, and
 * `hittest.ts`'s `magnifierHitPart` doc comment for the full rationale.
 */
const MAGNIFIER_SOURCE_MIN_HIT_HALF_PX = 11;
/**
 * Outset (CSS px, `* cropScale()` at the call site — screen-constant, like
 * `HANDLE_DRAW_PX`) `resizeHandlesFor` inflates a rect magnifier's SOURCE
 * rect by before ringing it with the 8 box handles (Addendum I, 2026-08-09,
 * §I2). At the §G1 floor the drawn source is 8 CSS px across; eight
 * `HANDLE_DRAW_PX = 10` squares centered on its corners/edges would cover it
 * completely without an outset. At `outset = 14`, a drawn handle's INNER
 * edge sits `14 - HANDLE_DRAW_PX/2 = 9` CSS px outside the source's own
 * edge, leaving a few CSS px clear of the marker band at every source size
 * and guaranteeing a non-empty body core on mouse. Threaded into both
 * `resizeHandlesFor` call sites and `applyResize` (whose
 * `applyMagnifierBoxResize` recomputes this same ring position to
 * short-circuit an exact pointer match to a no-op, and inverts it for every
 * genuine drag — see that function's doc comment; grabbing a handle without
 * moving is an exact no-op either way) via the private `srcHandleOutset()`
 * below, the one owner of the `* cropScale()` multiplication.
 */
const MAGNIFIER_SRC_HANDLE_OUTSET_PX = 14;
/**
 * TASK-52 (design note docs/design/2026-08-19-crop-canvas-rotation.md, D0/D1):
 * the rotate band's nominal thickness, measured in CSS px against the canvas
 * as it is BEFORE the frame grows (see `freezeBand`'s doc comment for why the
 * measurement must be taken pre-growth). On-screen it renders thinner right
 * after growth (down to ~32.7 CSS px on a 390px iPhone viewport at a normal
 * entry, for a roughly-square fixture).
 *
 * N1 (reviewer, non-blocking round): D1's original "converges back up to
 * exactly 40 CSS px after the first quarter turn ... never ratchets" claim
 * is FALSE for extreme aspect ratios and was never true in general — it only
 * held for the near-square fixtures it was originally checked against. On a
 * very tall or very wide document the effective on-screen band, per turn,
 * moves with the frame's actual on-screen scale at that quarter (which
 * itself depends on which axis of the frame is stage-constrained), not with
 * a single contraction factor toward 40 — measured on the TALL 120x900
 * fixture on the 390x844 iPhone viewport it went 35 CSS px at entry to
 * 21.7 CSS px after one clockwise turn and back up to ~66 CSS px after a
 * second, i.e. it oscillates rather than converging, and 21.7 CSS px sits
 * below the 44pt HIG touch guidance the rest of this file otherwise honours
 * for isolated controls (the band is a continuous strip, not an isolated
 * control — see D1's own "why 40 and not 44" rationale — so this is a real
 * but not a HIG-violating minimum). This is a property of the geometry
 * (`cropFrameSize`'s per-axis `cap`/aspect-ratio interaction with the
 * stage's own aspect ratio), not a bug in any one measurement path — the
 * `freezeBand()` staleness bug documented on that method (N1) was a
 * SEPARATE, now-fixed defect that could push the band far outside even this
 * oscillating range (e.g. ~70.5 CSS px with a stubbed keyboard up).
 */
const ROTATE_BAND_CSS_PX = 40;
/**
 * TASK-52 D1 layer 1: opaque fill for the whole crop frame, painted before
 * the preview transform, so the band and any tilt-opened triangular gaps
 * read as one flat non-photographic surface rather than a hole. Slightly
 * lighter than the app's own `--bg` (#1e1f22) so the frame reads as a
 * surface, not emptiness; `drawCropOverlay`'s existing 45% black dim then
 * lands on top of it (unchanged), resolving the band to ~#171a1c.
 */
const CROP_VOID_FILL = "#2a2d31";
/**
 * TASK-52 reviewer B2.2: the tilt gesture is armed only once the pointer has
 * moved this far (CSS px, scale-compensated to bitmap px at the call site,
 * same pattern as `DOUBLE_TAP_SLOP_PX`) from its `onDown` start position. A
 * press-and-release on the rotate band with no perceptible drag must never
 * write `crop.tilt` at all — before this slop existed, `tiltFromDrag` could
 * leave a residual on the order of 1e-7 rad from pointer jitter alone, which
 * (before `TILT_DEADBAND_RAD`'s arithmetic-only fix) was large enough to trip
 * `applyCrop`'s rotated-vs-pure-crop split. The deadband alone was not
 * sufficient: a 1 CSS px jiggle at a realistic pivot radius is well above
 * `TILT_DEADBAND_RAD` (~0.1°), so a tap could still take the full resample
 * path while the readout kept showing 0°. Arming at the gesture's origin
 * fixes the actual cause — a tap never becomes a rotation in the first
 * place — rather than papering over its symptom at apply time.
 */
const TILT_SLOP_PX = 4;
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
  // TASK-52: rotation doesn't recompute it either, for the same reason (D4)
  // — the long side is invariant under a quarter turn and can only shrink
  // under a tilt + inscribed crop.
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
  // Magnifier lens shape mode ("cube mode", D7): session-scoped, mirrors
  // `badgeFixedNumber`'s persistence — survives tool switches (so re-selecting
  // the magnifier tool keeps the last-chosen shape) and resets only on reload.
  // Toggled by a second tap on the already-active magnifier toolbar button
  // (see `app.ts`'s click loop, badge's own second-tap precedent), never by
  // `onToolChanged` — the icon must keep reflecting the mode across ordinary
  // tool switches, not reset to "circle" every time.
  private magnifierShape: "circle" | "rect" = "circle";

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
  // `radius`/`zoom` (circle) or `half` (rect, D4) are captured here (not just
  // read off the draft) so "sizing cannot change mid-gesture" is structural:
  // `magnifierSlideUpdate`/`magnifierRectSlideUpdate` only ever read them from
  // this frozen object, never from the live draft. Tagged union on `shape` so
  // `onMove`'s slide branch can dispatch to the matching per-shape update
  // function without re-deriving which mode the in-flight gesture is in.
  private magnifierPlace:
    | { shape: "circle"; offset: Point; radius: number; zoom: number }
    | { shape: "rect"; offset: Point; half: Point }
    | null = null;
  // Crop tool state (TASK-52, design note docs/design/2026-08-19-crop-canvas-rotation.md,
  // D0): while crop mode is active the live canvas is a temporarily enlarged
  // "frame space" — the region is stored normalized against the frame's
  // inscribed (rotation-safe) bounds, not as a pixel rect, so tilting out
  // and back never drifts the region (see crop.ts's `NormRect` doc comment).
  // Never part of doc, history, or renderAnnotations.
  private crop: {
    /** Region as a ratio of the inscribed bounds — source of truth (D3). */
    norm: NormRect;
    /** Clockwise quarter turns applied to the preview. */
    quarter: 0 | 1 | 2 | 3;
    /** Free rotation, radians, clamped to +/-MAX_TILT_RAD (crop.ts). */
    tilt: number;
    /** Frozen rotate-band thickness, FRAME px — see `freezeBand`. */
    band: number;
    /** True once a corner handle has ever been dragged (D3's re-assert rule). */
    touched: boolean;
    /** Active corner drag, if any. */
    drag: CropHandle | null;
    // Active free-rotation ("tilt") drag, if any (D4). TASK-47: when
    // pointercancel hygiene lands, its reset routine must clear this
    // alongside crop.drag, rotateDrag, resize, move, magnifierPlace and
    // draft — a cancelled tilt drag left armed would keep rotating the
    // preview on the next unrelated pointermove. `armed` (reviewer B2.2)
    // starts false at `onDown` and flips to true only once the pointer has
    // moved past `TILT_SLOP_PX` from `startPointer` — until then `onMove`
    // never writes `tilt`, so a tap-and-release never counts as a rotation.
    rotate: { startPointer: Point; startTilt: number; pivot: Point; armed: boolean } | null;
    controls: HTMLDivElement;
    /** Live angle label inside `controls` (D2). */
    readout: HTMLSpanElement;
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
    // TASK-52 (D0): while crop mode is active the live canvas is a "frame
    // space" preview — fill the whole frame with an opaque void color first
    // (the band and any tilt-opened triangular gaps are not photographic
    // content, D1 layer 1), then draw the background/annotations/draft
    // through the frame's rotate+scale preview transform. `cropFrame()` is
    // the single source of that geometry — drawCropOverlay() and
    // applyCrop() read the exact same thing, so the three call sites can
    // never disagree about where the image or the crop region are.
    const frame = this.crop ? this.cropFrame() : null;
    if (frame) {
      ctx.fillStyle = CROP_VOID_FILL;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      this.applyPreviewTransform(ctx, frame);
    }
    if (this.doc.imageBitmap) ctx.drawImage(this.doc.imageBitmap, 0, 0);
    // While re-editing an existing text annotation, skip drawing it here —
    // the DOM input overlay is its live stand-in (see `textEdit` doc comment).
    const editId = this.textEdit?.editId ?? null;
    const list = editId ? this.doc.annotations.filter((a) => a.id !== editId) : this.doc.annotations;
    renderAnnotations(ctx, list, this.doc.images, this.doc.imageBitmap);
    if (this.draft) renderAnnotations(ctx, [this.draft], this.doc.images, this.doc.imageBitmap);
    if (frame) ctx.restore();
    // Selection chrome is drawn last, directly on the live canvas context only —
    // never through renderAnnotations, so it can never reach exportPng().
    // (Deliberately OUTSIDE the preview transform above: selectedId is
    // always null while crop mode is active, so this is moot in practice,
    // but it stays in frame space like drawCropOverlay below.)
    const selected = this.selectedAnnotation();
    if (selected) this.drawSelectionOverlay(selected);
    else this.teardownSelectionControls();
    if (frame) this.drawCropOverlay(frame);
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

  /** Current magnifier lens shape mode ("cube mode", D7). Read by the toolbar to pick which icon glyph to show. */
  getMagnifierShape(): "circle" | "rect" {
    return this.magnifierShape;
  }

  /** Flip circle<->rect (D7's second-tap toggle) and return the new mode, so the toolbar's icon-swap call site (`app.ts`) never needs a separate read-back. */
  toggleMagnifierShape(): "circle" | "rect" {
    this.magnifierShape = this.magnifierShape === "circle" ? "rect" : "circle";
    return this.magnifierShape;
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
   * TASK-52 D0: the frame is larger than the document even at `quarter ===
   * 0` (the band grows outward on every side), so the frame's on-screen CSS
   * thickness has to be measured against the canvas as it is BEFORE this
   * call resizes it. Recomputing the band on every render instead of
   * freezing it once per frame-size change (`initCrop`, `setQuarter`) would
   * close a feedback loop: band -> frame size -> display scale ->
   * (whatever measures the display scale) -> band.
   *
   * N1 (reviewer, non-blocking round after the browser-verified APPROVE):
   * this method's PRIMARY source used to be `cropScale()`, which divides by
   * `canvas.getBoundingClientRect().width` — the canvas's *inline* CSS box,
   * written only when `fitCanvasToStage()` actually runs. That write is
   * synchronous at this class's own explicit call sites (`initCrop`,
   * `setQuarter`, …) but ASYNCHRONOUS everywhere else: `#stage` can resize
   * for a reason outside this class's control — the badge bar opening, or
   * `applyKeyboardInset` shrinking the stage for an open soft keyboard —
   * and in both cases the resulting canvas refit runs inside
   * `stageResizeObserver`'s callback, which `ResizeObserver` schedules
   * asynchronously (a queued microtask-adjacent callback, not synchronous
   * with the layout change). So there is a real window — entering crop
   * mode right after either of those triggers, before the observer
   * callback has fired — where `canvas.getBoundingClientRect()` still
   * reflects the STALE, pre-shrink box while `#stage` itself has already
   * resized. Measured on the 390x844 iPhone viewport with the TALL
   * 120x900 fixture, that staleness poisoned the band by up to 2x (a
   * ~35 CSS px band at a normal entry became ~70.5 CSS px with a stubbed
   * keyboard up), and because `setQuarter` re-freezes from the SAME
   * (by-then-correct) box on every subsequent quarter turn, the visible
   * band would lurch back toward the true value on the first turn after
   * entry — an apparent "ratchet" that was really just the stale read
   * finally being replaced by a fresh one.
   *
   * Fix: read `#stage`'s own client box FIRST. `clientWidth`/
   * `getComputedStyle` force a synchronous layout recalculation reflecting
   * the CURRENT DOM the instant they're read — independent of
   * `stageResizeObserver`'s own (separate, async) timing — so this is
   * immune to the staleness above by construction, not by luck of when it
   * happens to run relative to the observer. This mirrors
   * `fitCanvasToStage()`'s own scale computation (shrink-to-fit, never
   * upscale) so the frozen band matches what the canvas's own refit is
   * about to produce.
   *
   * `cropScale()` is kept as a SECOND fallback, not deleted: if `#stage`
   * itself is unusable (detached canvas — should not happen while crop is
   * active, but this method has no way to assert it isn't) it is still a
   * legitimate secondary source. It is never preferred over the stage
   * read, though, because it can only ever be as fresh as the stage read
   * and is sometimes staler (see above).
   *
   * B1 (reviewer, pre-existing): two paths can reach here while the
   * canvas's own on-screen box is still zero-width — `app.ts`'s
   * `syncEmptyState()` un-hides `#canvas` (`#stage.empty #canvas {
   * display: none }`) AFTER the editor re-arms crop on a fresh
   * `setBackground`/`restore`, and `getBoundingClientRect()` on a
   * `display:none` element is all-zero. The stage element is never
   * `display: none` while crop mode is (re-)activating, only the canvas
   * is, so the primary stage-derived read stays trustworthy exactly when
   * `cropScale()` alone would not have been. Only if the stage box is ALSO
   * unusable does this fall through to the flat `ROTATE_BAND_CSS_PX`
   * constant as a last resort.
   */
  private freezeBand(): number {
    const stage = this.canvas.parentElement;
    if (stage) {
      const cs = getComputedStyle(stage);
      const cw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ch = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      // Mirrors fitCanvasToStage()'s own scale computation (shrink-to-fit,
      // never upscale) so the frozen band matches what the band will
      // actually measure once fitCanvasToStage() runs.
      const fitScale = Math.min(1, cw / this.canvas.width, ch / this.canvas.height);
      if (Number.isFinite(fitScale) && fitScale > 0) return ROTATE_BAND_CSS_PX / fitScale;
    }
    const scale = this.cropScale();
    if (Number.isFinite(scale) && scale > 0) return ROTATE_BAND_CSS_PX * scale;
    return ROTATE_BAND_CSS_PX;
  }

  /**
   * Total crop-preview rotation (D0): `quarter * 90° + tilt`, normalized. 0
   * with no active crop.
   *
   * F8 (design-note addendum, 2026-08-19): the result is passed through
   * `TILT_DEADBAND_RAD` — a magnitude under the deadband is snapped to
   * exactly 0 — because this is the accessor `applyCrop()`'s `angle === 0`
   * no-op test and `updateCropReadout()` both read. The live preview
   * transform does NOT go through this method: `cropFrame()` below computes
   * `quarter * (Math.PI / 2) + tilt` directly from the raw, un-deadbanded
   * `tilt`, so what's drawn on screen always matches the pointer exactly.
   */
  private cropAngle(): number {
    if (!this.crop) return 0;
    const total = normalizeAngle(this.crop.quarter * (Math.PI / 2) + this.crop.tilt);
    return Math.abs(total) < TILT_DEADBAND_RAD ? 0 : total;
  }

  /**
   * `cropFrame()` and `effectiveFrame()` (below) are a deliberate PAIR, and
   * this comment covers both: the live canvas has two different notions of
   * "the current angle", and each accessor commits to exactly one so no
   * caller can accidentally cross-wire them.
   *
   * - `cropFrame()` reads the RAW, un-deadbanded `crop.tilt` — the angle the
   *   pointer is actually at right now. `render()`/`drawCropOverlay()` and
   *   the gesture handlers (hit-testing, hover cursor) use this one, so the
   *   on-screen preview always tracks the pointer exactly, with no
   *   deadband-induced dead zone and no jump when a tilt drag arms.
   * - `effectiveFrame()` reads `cropAngle()` — the deadbanded, "did the user
   *   actually rotate anything" angle `applyCrop()`'s zero-test also reads.
   *   This is `applyCrop()`'s ONLY entry point for building its frame (B2.1:
   *   see the design note's addendum). Feeding `cropFrameFor` a residual
   *   in-deadband tilt still shrinks `bounds` by `INSCRIBED_INSET_PX`, which
   *   would push an apply the user experienced as untouched down the
   *   rotated/history-pushing branch — building the frame from the SAME
   *   angle the zero-test reads is what keeps the two from disagreeing.
   *
   * Both are the single call sites in this class that invoke `cropFrameFor`
   * for their respective purpose — never recomputed ad hoc elsewhere.
   * Assumes `this.crop` is set (every caller guards first).
   *
   * Reviewer (non-blocking): degrades to a zero-size image/frame instead of
   * throwing if `this.crop` is set but `this.doc.imageBitmap` is somehow
   * null — `crop` and the bitmap are supposed to be torn down/rebuilt
   * together (`teardownCrop`/`initCrop`/`setBackground`/`restore`), so this
   * should be unreachable, but `render()` calls this on every frame while
   * crop mode is active and a bare `.width` on `null` would blank the whole
   * canvas instead of just the crop chrome.
   */
  private cropFrame(): CropFrame {
    const bitmap = this.doc.imageBitmap;
    const { quarter, tilt, band } = this.crop!;
    if (!bitmap) {
      return {
        w: this.canvas.width,
        h: this.canvas.height,
        band,
        angle: 0,
        s: 1,
        image: { w: 0, h: 0 },
        bbox: { w: 0, h: 0 },
        bounds: { x: this.canvas.width / 2, y: this.canvas.height / 2, w: 0, h: 0 },
      };
    }
    return cropFrameFor(
      bitmap.width,
      bitmap.height,
      { w: this.canvas.width, h: this.canvas.height, band },
      quarter * (Math.PI / 2) + tilt,
    );
  }

  /**
   * The APPLY-TIME frame — see `cropFrame()`'s doc comment above for the
   * raw-tilt (preview) vs effective-angle (apply) split this accessor is
   * one half of. `applyCrop()` uses this instead of an inline `cropFrameFor`
   * call so the split has exactly one named entry point on each side.
   * Assumes `this.crop` and `this.doc.imageBitmap` are both set (every
   * caller — currently only `applyCrop()` — guards both first).
   */
  private effectiveFrame(): CropFrame {
    const bitmap = this.doc.imageBitmap!;
    return cropFrameFor(
      bitmap.width,
      bitmap.height,
      { w: this.canvas.width, h: this.canvas.height, band: this.crop!.band },
      this.cropAngle(),
    );
  }

  /**
   * The current crop region in frame px, derived from `norm` against
   * `frame`'s inscribed bounds (D3) — never stored as pixels (see the
   * `crop` state's `norm` field doc comment for why). Reuses an
   * already-computed `frame` when the caller has one, to avoid recomputing
   * `cropFrameFor` twice in the same render/gesture frame.
   */
  private cropRect(frame?: CropFrame): CropRect {
    const f = frame ?? this.cropFrame();
    return denormalizeRect(this.crop!.norm, f.bounds, MIN_CROP_PX);
  }

  /**
   * Apply the crop preview's rotate+scale transform (D0) to `ctx`: the
   * background image (and, inside the same `save/.../restore`, the
   * annotations drawn on top of it) is rotated about the frame centre by
   * `frame.angle` and uniformly scaled by `frame.s`, then centred back on
   * the frame. Callers `save()` before and `restore()` after — this method
   * only ever composes onto whatever transform is already active.
   */
  private applyPreviewTransform(ctx: CanvasRenderingContext2D, frame: CropFrame): void {
    ctx.translate(frame.w / 2, frame.h / 2);
    ctx.rotate(frame.angle);
    ctx.scale(frame.s, frame.s);
    ctx.translate(-frame.image.w / 2, -frame.image.h / 2);
  }

  /**
   * True when `p` (frame px) is inside `rect` (frame px), inclusive of the
   * boundary — shared by `onDown`'s tilt-vs-inert decision and the crop
   * hover cursor (D4), so both agree on exactly what "outside the region"
   * means.
   */
  private pointInRect(p: Point, rect: CropRect): boolean {
    return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  }

  /**
   * The image's own four corners in frame space — rotated by `frame.angle`
   * about the frame centre and scaled by `frame.s`, exactly the transform
   * `applyPreviewTransform` applies to the background draw. NOT the same as
   * `frame.bbox`'s corners, which are the rotated image's axis-aligned
   * BOUNDING box, not the tilted rectangle itself; used only by
   * `drawCropOverlay`'s image-outline stroke (D1 layer 3).
   */
  private rotatedImageCorners(frame: CropFrame): [Point, Point, Point, Point] {
    const { w: imgW, h: imgH } = frame.image;
    const cos = Math.cos(frame.angle);
    const sin = Math.sin(frame.angle);
    const cx = frame.w / 2;
    const cy = frame.h / 2;
    const local: Point[] = [
      { x: -imgW / 2, y: -imgH / 2 },
      { x: imgW / 2, y: -imgH / 2 },
      { x: imgW / 2, y: imgH / 2 },
      { x: -imgW / 2, y: imgH / 2 },
    ];
    return local.map(({ x, y }) => {
      const sx = x * frame.s;
      const sy = y * frame.s;
      return { x: cx + sx * cos - sy * sin, y: cy + sx * sin + sy * cos };
    }) as [Point, Point, Point, Point];
  }

  /**
   * Initialize crop state: a fresh frame at `quarter === 0`/`tilt === 0`
   * with the region covering the whole inscribed rect, plus the two-row
   * floating controls overlay (D2, owned like `textEdit.input`). No-op if
   * there is no image or crop is already active.
   *
   * `commitTextEditor()` runs first so an in-flight text edit is settled
   * into `doc.annotations` before the canvas resizes into frame space —
   * mirrors the existing `onDown`/select-tool discipline of never letting a
   * pending edit straddle a canvas geometry change.
   */
  private initCrop(): void {
    if (!this.hasImage() || this.crop) return;
    this.commitTextEditor();
    const bitmap = this.doc.imageBitmap!;

    const controls = document.createElement("div");
    controls.className = "crop-controls";

    const ccw = document.createElement("button");
    ccw.type = "button";
    ccw.className = "crop-rotate-ccw";
    ccw.title = "Rotate left 90°";
    ccw.setAttribute("aria-label", "Rotate left 90°");
    // Feather-style "rotate-ccw" icon (same inline-SVG precedent as
    // ensureSelectionControls' trash icon — emoji/text glyphs render nearly
    // invisible on iOS).
    ccw.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
    ccw.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setQuarter(-1);
    });

    const readout = document.createElement("span");
    readout.className = "crop-angle";

    const cw = document.createElement("button");
    cw.type = "button";
    cw.className = "crop-rotate-cw";
    cw.title = "Rotate right 90°";
    cw.setAttribute("aria-label", "Rotate right 90°");
    cw.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>';
    cw.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setQuarter(1);
    });

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "crop-cancel";
    cancel.title = "Cancel crop (Esc)";
    cancel.setAttribute("aria-label", "Cancel crop (Esc)");
    cancel.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cancelCrop();
    });
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "crop-apply";
    apply.title = "Apply crop (Enter)";
    apply.setAttribute("aria-label", "Apply crop (Enter)");
    apply.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<polyline points="20 6 9 17 4 12"/></svg>';
    apply.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.applyCrop();
    });

    // Single row, left to right: ccw / angle readout / cw / cancel / apply
    // (see the `.crop-controls` CSS comment for the width arithmetic).
    controls.appendChild(ccw);
    controls.appendChild(readout);
    controls.appendChild(cw);
    controls.appendChild(cancel);
    controls.appendChild(apply);

    // TASK-52 regression fix (reviewer round, 2026-08-19): `.crop-controls`
    // used to be `position: absolute`, docked at `#stage`'s own bottom-centre
    // (the 2026-08-19 UI-1 addendum) -- an opaque overlay ON TOP OF `#stage`,
    // not a part of its layout. Measured with `document.elementFromPoint` at
    // the live crop corner-handle positions, that overlay sat directly on
    // top of the two BOTTOM handles on several real geometries (a tall
    // portrait fixture on both a 390x844 WebKit viewport and the desktop
    // Chromium shell), and on top of the rotate buttons themselves on a
    // small landscape fixture -- a press meant for the bottom-left handle
    // never reached the canvas at all (TASK-4 AC#2 FAIL: the region could
    // not be shrunk from the bottom), and a press meant for a handle
    // silently rotated the document instead. TASK-38 already hit and solved
    // this exact failure mode for `#badge-bar` ("the fixed overlay bar hides
    // the bottom of the photo, making it impossible to stamp there"); this
    // is the same fix (option A, the design note's addendum superseding
    // UI-1): make the group an IN-FLOW flex child of `#app`, a sibling of
    // `#stage` and `#share-bar`, not an overlay on top of `#stage`. `#stage`
    // then shrinks via its own `flex: 1` to make room, so the corner handles
    // always land on the canvas's own reduced, fully-visible footprint
    // instead of underneath the bar. No JS repositioning is needed either
    // way (the old absolute-positioned version already needed none) -- CSS
    // derives both the bar's own layout and the stage's resulting shrink for
    // free on every viewport change.
    //
    // `body.crop-bar-open` mirrors `body.badge-bar-open` (src/ui/badgebar.ts)
    // exactly: styles.css uses it to hide `#share-bar` while crop is active
    // (crop is modal, so losing Copy/Share for its duration is the same
    // trade-off the badge bar already makes), and defensively cross-hides
    // `#badge-bar`/`.crop-controls` against each other so the two
    // mutually-exclusive bars can never both render -- see that rule block's
    // own comment for the full invariant writeup.
    // N3 (reviewer, non-blocking): the Editor previously needed only
    // `canvas.parentElement` (the stage) to build its chrome -- this is the
    // first place it reaches for `#app` specifically, a mount point both
    // shipped shells (`index.html`, `pwa/index.html`) always provide but
    // that nothing in this class's own contract guarantees. A non-null
    // assertion here would turn "editor mounted somewhere unexpected" into
    // a hard throw out of `initCrop()`, leaving `this.crop` unset while the
    // controls DOM (if any got appended before the throw) and
    // `crop-bar-open` class are left inconsistent. Falling back to the
    // stage keeps the bar buildable (crop still functions, just without the
    // in-flow bottom-bar layout `#app`'s flex children give it) instead of
    // crashing outright.
    const app = document.querySelector<HTMLElement>("#app") ?? this.canvas.parentElement;
    if (!app) return; // No mount point at all -- bail out of building the bar rather than crash.
    app.appendChild(controls);
    document.body.classList.add("crop-bar-open");

    // Band frozen BEFORE the resize (freezeBand's doc comment); frame size
    // computed for quarter 0 (D0). Ordering hazard (reviewer): `freezeBand()`
    // falls back to reading `#stage`'s own client box when the canvas is
    // still `display: none` (B1, below) -- that read only sees the stage
    // already shrunk by the bar just inserted above because
    // `getBoundingClientRect()`/`clientWidth` force a synchronous layout
    // recalculation reflecting the CURRENT DOM, not because of the
    // (separate, async) `stageResizeObserver`. The bar must stay inserted
    // (and `crop-bar-open` applied) strictly before this call for that to
    // hold -- verified by the ordering of this function's statements.
    const band = this.freezeBand();
    const frameSize = cropFrameSize(bitmap.width, bitmap.height, 0, band, this.maxImportDimension);
    this.canvas.width = frameSize.w;
    this.canvas.height = frameSize.h;
    this.fitCanvasToStage();

    this.crop = {
      norm: { ...FULL_NORM },
      quarter: 0,
      tilt: 0,
      band,
      touched: false,
      drag: null,
      rotate: null,
      controls,
      readout,
    };
    this.render();
  }

  /**
   * Apply a quarter turn to the crop preview (D0/D3): transpose the
   * normalized region across the turn (or re-assert `FULL_NORM` if the
   * region has never been touched), re-freeze the band against the
   * pre-resize canvas, resize the canvas to the new frame size, refit the
   * on-screen box, and re-render. Canvas resizes only ever happen on this
   * kind of discrete event — never mid-drag (D0). No-op without an image or
   * an active crop, and also a no-op while a corner or tilt drag is in
   * flight (reviewer, non-blocking): D0 forbids a mid-drag canvas resize
   * because it would stale the drag's pivot/start-point and make the
   * geometry jump — a second finger tapping a rotate button while the first
   * is mid-drag is exactly that scenario (the rotate buttons are DOM
   * elements, so they are reachable by a second pointer even while the
   * canvas has pointer capture from the first).
   */
  private setQuarter(delta: -1 | 1): void {
    if (!this.crop || !this.hasImage()) return;
    if (this.crop.drag || this.crop.rotate) return;
    const bitmap = this.doc.imageBitmap!;
    const crop = this.crop;
    crop.norm = crop.touched ? rotateNormRect(crop.norm, delta) : { ...FULL_NORM };
    crop.quarter = ((((crop.quarter + delta) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    crop.band = this.freezeBand();
    const frameSize = cropFrameSize(bitmap.width, bitmap.height, crop.quarter, crop.band, this.maxImportDimension);
    this.canvas.width = frameSize.w;
    this.canvas.height = frameSize.h;
    this.fitCanvasToStage();
    this.render();
  }

  /** Tear down crop state and its DOM bar. Does not render (callers render). */
  private teardownCrop(): void {
    if (!this.crop) return;
    this.crop.controls.remove();
    // Restores #share-bar and lets #stage grow back, mirroring
    // src/ui/badgebar.ts's close() -- see initCrop()'s doc comment for the
    // full in-flow-bar writeup. Removed unconditionally (before the
    // canvas-dimension restore below) whether or not that restore branch
    // actually runs, so the bar/class and the crop state stay consistent
    // even on an already-original-size canvas (e.g. cancelling an untouched
    // crop before any quarter turn).
    document.body.classList.remove("crop-bar-open");
    this.crop = null;
    // TASK-52 B1 (D4): the frame is larger than the document even at
    // `quarter === 0` (the band grows outward on every side), so leaving
    // crop mode without shrinking the canvas back would paint an
    // original-size bitmap onto an oversized canvas. `teardownCrop` is the
    // SINGLE owner of restoring the canvas's dimensions on the way out of
    // crop mode — verified against all four call sites (setBackground,
    // restore, applyCrop, clearDocument) in the design note; no other code
    // path may write canvas dimensions on the way out of crop mode.
    const bmp = this.doc.imageBitmap;
    if (bmp && (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height)) {
      this.canvas.width = bmp.width;
      this.canvas.height = bmp.height;
    }
    // N2 (reviewer, non-blocking): `fitCanvasToStage()` used to run only
    // inside the branch above, so on the `applyCrop()` exit path (where
    // `applyCrop` already set `canvas.width/height` to the output size
    // before calling `setTool("select")` -> here) this method never called
    // it itself -- the final on-screen refit was left entirely to the
    // asynchronous `stageResizeObserver` callback that a canvas-size change
    // eventually triggers. Harmless in practice today, since the observer
    // does fire, but it also silently skipped the cap-clamped edge case
    // where the branch's dimension check can be FALSE even though the
    // canvas's on-screen CSS box still needs refitting for the new frame
    // it's leaving (e.g. a square image already at `maxImportDimension`,
    // where the frame and the bitmap can land on the same width/height by
    // coincidence, so the "dimensions differ" guard above never fires at
    // all). Calling `fitCanvasToStage()` unconditionally here, right after
    // the `crop-bar-open` class removal, makes the exit-time refit
    // synchronous and independent of ResizeObserver's own timing in every
    // case, not just the common one — `fitCanvasToStage()` is already a
    // cheap no-op read-then-maybe-write when the box is already correct.
    this.fitCanvasToStage();
  }

  /**
   * Discard the pending crop region and exit crop mode to the select tool
   * (TASK-40; amends TASK-4 AC#5, which kept crop mode active on cancel).
   * The document is never touched — only the in-flight region, rotation and
   * frame are dropped. Routed entirely through `setTool("select")`, which
   * tears crop down (restoring the canvas's dimensions via `teardownCrop`'s
   * B1, D4), clears selection and renders. Re-cropping means re-activating
   * the crop tool, which re-initializes a fresh full-image region. Returns
   * false if there was no active crop.
   */
  cancelCrop(): boolean {
    if (!this.crop) return false;
    this.setTool("select");
    return true;
  }

  /**
   * Apply the pending crop (and any rotation) and exit crop mode to the
   * select tool (TASK-40; amends TASK-4 AC#5; extended by TASK-52 D5 for
   * rotation). Splits on whether there is any rotation at all
   * (`cropAngle() === 0`):
   *
   * - **No rotation**: byte-identical to the pre-TASK-52 v2/TASK-40 path,
   *   including its untouched/degenerate no-op guard (no history push) —
   *   only now fed the source-space rect `frameToRotatedSource` derives from
   *   the frame-space region (undoes the preview scale and the frame's
   *   centering offset).
   * - **Rotated**: resamples the background once through an `OffscreenCanvas`
   *   (`documentRotation`'s matrix) and rigidly re-maps every annotation
   *   (`rotateAnnotationForDocument`, computed BEFORE the await so the
   *   existing stale-document guard below stays exact), landing rotation +
   *   crop as a single undoable step.
   *
   * Either way, crop mode exits to select; re-cropping means re-activating
   * the crop tool, which re-initializes a fresh full-image region.
   */
  /**
   * G1 (reviewer, TASK-52): a raster surface for `applyCrop`'s rotated
   * branch — `OffscreenCanvas` when available, else a plain `<canvas>`
   * (never attached to the DOM). Both expose the same
   * `getContext("2d")` -> `imageSmoothingQuality` -> `setTransform` ->
   * `drawImage` -> `createImageBitmap(...)` surface, so the rest of the
   * branch is unchanged either way.
   *
   * Real Safari 16.4+ and WebView2 both implement `OffscreenCanvas` (D5), so
   * in the shipped app this is always the first branch. It exists for two
   * reasons: (1) Playwright's bundled WebKitGTK build does NOT implement
   * `OffscreenCanvas` — without this fallback, every rotated-apply e2e test
   * throws a bare `ReferenceError` under `pnpm test:e2e`, a harness gap, not
   * a product bug; (2) it is a free safety net against any future webview
   * older than the `OffscreenCanvas` floor `docs/WEB.md` documents for
   * `convertToBlob`.
   */
  private createRasterSurface(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  async applyCrop(): Promise<void> {
    if (!this.crop || !this.hasImage()) return;
    const src = this.doc.imageBitmap!;
    // B2.1 (reviewer, TASK-52): the apply-time frame MUST be built from the
    // EFFECTIVE (deadbanded) angle, not the raw `crop.tilt` that `cropFrame()`
    // (used by render()/drawCropOverlay()) reads — see `effectiveFrame()`'s
    // doc comment (shared with `cropFrame()`) for why the two must never be
    // conflated. `angle` is read here (not just inside `effectiveFrame()`)
    // because the `angle === 0` branch below needs it too, from the exact
    // same `cropAngle()` call `effectiveFrame()` makes internally, so the
    // zero-test and the frame geometry always agree.
    const angle = this.cropAngle();
    const frame = this.effectiveFrame();
    const rectF = this.cropRect(frame);
    const srcRect = frameToRotatedSource(rectF, frame);

    if (angle === 0) {
      // Pure crop — byte-identical to the TASK-4/40 path (D5).
      const rect = computeCrop(
        { x: srcRect.x, y: srcRect.y },
        { x: srcRect.x + srcRect.w, y: srcRect.y + srcRect.h },
        fullImageRect(src.width, src.height),
        MIN_CROP_PX,
      );
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
      return;
    }

    // Rotated apply (D5/D6): one resample of the background plus a rigid
    // remap of every annotation, landing rotation + crop as a single
    // undoable step. `mapped` is computed BEFORE the await so the
    // stale-document guard below (identical to the pure-crop path above)
    // stays exact.
    const r = documentRotation(src.width, src.height, angle, srcRect);
    if (r.out.w < 1 || r.out.h < 1) {
      // Reviewer F7 on TASK-52: a degenerate `srcRect` (e.g. a sub-pixel
      // region at the MIN_CROP_PX floor rounding down) can make
      // `documentRotation`'s `out.w`/`out.h` round to 0. `new
      // OffscreenCanvas(0, 0)` is invalid, so bail out here exactly like the
      // pure-crop path's own no-op guard above: exit crop mode to select, no
      // history push.
      this.setTool("select");
      return;
    }
    const mapped = this.doc.annotations.map((a) => rotateAnnotationForDocument(a, r, this.ctx));
    const off = this.createRasterSurface(r.out.w, r.out.h);
    const octx = off.getContext("2d")!;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.setTransform(...r.matrix);
    octx.drawImage(src, 0, 0);
    const rotated = await createImageBitmap(off);
    // Same stale-document guard as the pure-crop path above; the source
    // bitmap is never close()d — history holds it by reference.
    if (this.doc.imageBitmap !== src) {
      rotated.close();
      return;
    }
    this.history.push(this.snapshot());
    this.doc.imageBitmap = rotated;
    this.doc.annotations = mapped;
    this.canvas.width = r.out.w;
    this.canvas.height = r.out.h;
    this.fitCanvasToStage();
    this.selectedId = null;
    this.move = null;
    this.resize = null;
    this.rotateDrag = null;
    this.magnifierPlace = null;
    this.draft = null;
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
   *
   * Addendum I (2026-08-09), §I6: for a rect magnifier, `magnifierSourceBodyWins`
   * is consulted right after `nearest` is computed — if a press is at least
   * as near the source center as to the nearest box handle, this returns
   * `null` so the caller falls through to the ordinary `hitTest`-driven
   * source-body drag instead of a handle drag. Magnifier is excluded from
   * `canRotate`, so this never interacts with the knob tie-break below.
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
    const nearest = nearestHandle(resizeHandlesFor(selected, bounds, this.srcHandleOutset()), localP, r);
    if (magnifierSourceBodyWins(selected, localP, nearest)) return null;

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
    // N6 (Addendum D, 2026-08-08 reviewer nit): a rect magnifier's source
    // rect is needed by two separate pieces of chrome below (source tint,
    // the zoom readout's NE/SW anchor) — computed once here, not once per
    // site, so there is one owner of "call magnifierSourceRect(a)" for this
    // whole method. (A third consumer, the zoom-grip's outward angle, read
    // this too pre-Addendum-I; as of Addendum I (2026-08-09) the grip moved
    // to the LENS's own SE corner and reads `a.height`/`a.width` directly
    // instead — see the `resizeHandlesFor` draw loop below.)
    const rectSourceRect = a.kind === "magnifier" && a.shape === "rect" ? magnifierSourceRect(a) : null;

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
      // where the tint correctly vanishes. True for the CIRCLE without
      // qualification. For the RECT (Addendum G, 2026-08-08, §G3): the tint
      // is still drawn on the DRAWN source rect (`magnifierSourceRect(a)`),
      // never the inflated hit region — it must keep meaning "this is the
      // region being sampled", and `magnifierSourceMinHit`'s inflation is a
      // pure hit-testing concern with no drawn counterpart (drawing it would
      // imply a second, phantom source marker at the wrong size). So for a
      // rect the tint is now a LOWER BOUND on the actual (fingertip-floored)
      // draggable region, not an exact match — a press can start a "source"
      // drag from just outside the tint's own edge when the drawn source is
      // below the hit-target floor.
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
      //
      // Rect (D6): same clip+evenodd recipe, `ctx.rect`/`path.rect` in place
      // of `arc` — the two implicit-closing-segment/winding arguments above
      // hold identically for two rects.
      if (a.shape === "rect") {
        const sourceRect = rectSourceRect!; // N6: hoisted at the top of drawSelectionOverlay
        const lensRect = magnifierLensRect(a);
        ctx.save();
        ctx.beginPath();
        ctx.rect(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h);
        ctx.clip();
        const tint = new Path2D();
        tint.rect(sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h);
        tint.rect(lensRect.x, lensRect.y, lensRect.w, lensRect.h);
        ctx.globalAlpha = MAGNIFIER_SOURCE_TINT_ALPHA;
        ctx.fillStyle = PALETTE[0];
        ctx.fill(tint, "evenodd");
        ctx.restore();
      } else {
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
    }

    const side = HANDLE_DRAW_PX * this.cropScale();
    const half = side / 2;
    ctx.lineWidth = 1.5;
    for (const handle of resizeHandlesFor(a, b, this.srcHandleOutset())) {
      if (handle.shape === "grip") {
        // B2 (Addendum D, 2026-08-08), ridge angle RE-TARGETED by Addendum I
        // (2026-08-09): outward angle defaults to the circle's fixed
        // MAGNIFIER_ZOOM_HANDLE_ANGLE inside drawZoomGrip itself; a rect
        // magnifier now passes the LENS rect's own actual SE angle (the grip
        // moved there, I5) instead of the source's, so the ridge orientation
        // still reads as "radially outward" for a non-square lens too.
        const gripAngle = a.kind === "magnifier" && a.shape === "rect" ? Math.atan2(a.height / 2, a.width / 2) : undefined;
        this.drawZoomGrip(ctx, handle.pos, gripAngle);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillRect(handle.pos.x - half, handle.pos.y - half, side, side);
        ctx.strokeStyle = PALETTE[0];
        ctx.strokeRect(handle.pos.x - half, handle.pos.y - half, side, side);
      }
    }

    if (a.kind === "magnifier") {
      // Zoom readout (design note): selection chrome only, drawn beside the
      // source marker — never through renderAnnotations, so it can never
      // reach exportPng(). Two-pass text (white halo + accent fill), the same
      // legibility trick render.ts's drawText/drawArrow use, since the marker
      // can sit over an arbitrarily light or dark part of the image.
      // One decimal, trailing ".0" trimmed: "2.4×", but "3×" not "3.0×".
      const zoomDigits = a.zoom.toFixed(1);
      const label = (zoomDigits.endsWith(".0") ? zoomDigits.slice(0, -2) : zoomDigits) + "×";
      const fontPx = MAGNIFIER_READOUT_FONT_PX * this.cropScale();
      ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const offset = MAGNIFIER_READOUT_MARGIN_PX * this.cropScale() + half;

      // Natural placement: above-right (NE) of the source marker. When that
      // would leave the canvas — the source marker sitting near the top or
      // right edge — mirror to below-left (SW) instead: the same
      // problem-class fix `rotateHandleFor`/`knobMargin` use for the rotate
      // knob (try the natural spot, fall back to the opposite side). Chrome
      // only, so this never touches exported pixels — it only keeps the
      // on-screen readout legible.
      //
      // Circle: the NE/SW anchor is the point on the source RING at +-45deg
      // (`a.from +- sourceRadius*SQRT1_2` on each axis) — computed exactly as
      // before this refactor, so the numeric result is unchanged. Rect (D6):
      // the anchor is simply the source RECT's own NE/SW corner — no trig
      // needed, the rect already has a corner there.
      let neAnchor: Point;
      let swAnchor: Point;
      if (a.shape === "rect") {
        const sourceRect = rectSourceRect!; // N6: hoisted at the top of drawSelectionOverlay
        neAnchor = { x: sourceRect.x + sourceRect.w, y: sourceRect.y };
        swAnchor = { x: sourceRect.x, y: sourceRect.y + sourceRect.h };
      } else {
        const sourceRadius = magnifierSourceRadius(a);
        neAnchor = { x: a.from.x + sourceRadius * Math.SQRT1_2, y: a.from.y - sourceRadius * Math.SQRT1_2 };
        swAnchor = { x: a.from.x - sourceRadius * Math.SQRT1_2, y: a.from.y + sourceRadius * Math.SQRT1_2 };
      }
      const neX = neAnchor.x + offset;
      const neY = neAnchor.y - offset;
      const mirror = neX + textWidth > this.canvas.width || neY - fontPx / 2 < 0;
      const labelPos = mirror ? { x: swAnchor.x - offset, y: swAnchor.y + offset } : { x: neX, y: neY };

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
      // on inside the helper. Rect (D6): radius = the source rect's own
      // half-diagonal — a circumscribing circle around the rect, conservative
      // (never smaller than the rect's own true clearance need) but keeps
      // `deleteButtonCornerFor`'s AvoidCircle machinery unchanged.
      //
      // Addendum I (2026-08-09), §I7: explicitly NOT re-derived from the
      // handle ring even though the 8 box handles now sit outside the source
      // rect by `srcHandleOutset` — `positionSelectionControls` already
      // inflates its own clearance check by ~24 CSS px (touch handle radius)
      // + `SELECTION_CONTROLS_MARGIN_PX`, comfortably more than the ring's
      // own worst-case reach beyond this half-diagonal (`outset * sqrt(2) ~=
      // 19.8` CSS px at a corner), so no extra margin is needed here.
      a.kind === "magnifier" && angle === 0
        ? { center: a.from, radius: a.shape === "rect" ? Math.hypot(rectSourceRect!.w, rectSourceRect!.h) / 2 : magnifierSourceRadius(a) }
        : null,
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
   * idiom. `angle` (B2, Addendum D 2026-08-08) is the outward radial
   * direction the ridges orient to; defaults to `MAGNIFIER_ZOOM_HANDLE_ANGLE`
   * (resize.ts) — the same angle the CIRCLE handle's rim position is
   * computed from, so the default case never hardcodes a second copy of that
   * constant. The caller passes a different angle for a rect magnifier (the
   * source rect's own actual SE angle), so the ridge orientation still reads
   * as "radially outward from the source" for a non-square source rect.
   */
  private drawZoomGrip(ctx: CanvasRenderingContext2D, pos: Point, angle: number = MAGNIFIER_ZOOM_HANDLE_ANGLE): void {
    const s = this.cropScale();
    const r = (MAGNIFIER_ZOOM_GRIP_PX / 2) * s;
    const u = { x: Math.cos(angle), y: Math.sin(angle) };
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
   * marquee's NE corner, using the same bitmap-px -> CSS-px mapping
   * `positionTextEditor` uses (the crop controls group no longer needs this
   * mapping — UI-1 addendum moved it to pure CSS), clamped to stay fully
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
   * Dimmed exterior + rotated-image outline + dashed border + corner
   * handles for the active crop region, all read from `frame` (D0/D1/D3).
   * Not exported (see render()). Also updates the live angle readout every
   * render (the floating controls group's own position is now pure CSS —
   * UI-1 addendum — so no per-render repositioning call is needed here).
   *
   * `frame` is threaded in by the caller (`render()`, the only call site)
   * rather than recomputed here via `cropFrame()` — non-blocking reviewer
   * fixup on TASK-52: `render()` already computes the exact same
   * `cropFrameFor` result once per frame to apply the preview transform, and
   * a second independent call site recomputing the same geometry (even
   * though, being pure, it agrees bit-for-bit today) is exactly the kind of
   * duplication the design note's "one owner" discipline warns against.
   */
  private drawCropOverlay(frame: CropFrame): void {
    if (!this.crop) return;
    const { ctx, canvas } = this;
    const { x, y, w, h } = this.cropRect(frame);

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, y); // top
    ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h)); // bottom
    ctx.fillRect(0, y, x, h); // left
    ctx.fillRect(x + w, y, canvas.width - (x + w), h); // right

    // TASK-52 D1 layer 3: stroke the rotated image's own outline — the only
    // cue that says "the picture ends here, you are now on the drag band",
    // and what makes a tilt legible at small angles. Drawn AFTER the dim
    // (so it's visible on the dark band) and BEFORE the dashed crop border
    // below (so the region's own chrome stays dominant).
    const imageCorners = this.rotatedImageCorners(frame);
    ctx.beginPath();
    ctx.moveTo(imageCorners[0].x, imageCorners[0].y);
    for (let i = 1; i < imageCorners.length; i++) ctx.lineTo(imageCorners[i].x, imageCorners[i].y);
    ctx.closePath();
    ctx.lineWidth = 1 * this.cropScale();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();

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

    this.updateCropReadout();
    // The controls group needs no per-render (or per-resize) JS
    // repositioning at all: it used to be repositioned every render,
    // anchored to the crop rect's SE corner (`positionCropControls`, long
    // deleted); that anchor did not scale to a 5-control group. It then
    // became a `position: absolute` overlay docked at `#stage`'s
    // bottom-centre by pure CSS (the UI-1 addendum) — which fixed the
    // sizing problem but turned out to still cover the crop corner handles
    // on several real viewports (a blocking regression, TASK-4 AC#2). It is
    // now an IN-FLOW `#app` child (see `initCrop()`'s doc comment and the
    // design note's addendum superseding UI-1) — CSS derives its layout,
    // and `#stage`'s own resulting shrink, for free either way.
  }

  /**
   * Write the live total-angle label (D2): `normalizeAngle(quarter*90 +
   * tilt)` rounded to whole degrees. DOM write only (`textContent`), no
   * reflow risk — `.crop-angle`'s CSS `min-width` absorbs any digit-count
   * change without moving either rotate button under the user's finger
   * mid-drag.
   *
   * Reviewer (non-blocking, TASK-52): `cropAngle()`'s `normalizeAngle` keeps
   * the STORED angle in `(-180°, 180°]` — that range is correct for the
   * stored state (it is what every geometry function in crop.ts/rotate.ts
   * expects) and is left exactly as-is. But it made three clockwise quarter
   * turns (270°) display as "-90°" in the readout, which reads as backwards
   * rotation to the user. The wrap to `[0°, 360°)` below is applied ONLY to
   * this display string, after rounding, so it can never feed back into
   * `crop.tilt` or any stored angle.
   *
   * Reviewer (readout precision, 2026-08-19 polish round): plain
   * `Math.round` showed "0°" for anything under 0.5° even though a real
   * resample already happens above the 0.1° deadband (`TILT_DEADBAND_RAD`)
   * — a bare 4px arming-slop drag on a large desktop canvas lands around
   * 0.46°, which rounded straight to "0°" and made the drag look like it
   * had done nothing. Below 1° (and not exactly 0 — the deadbanded,
   * genuinely-untouched idle state stays a plain "0°") show one decimal
   * place instead, SIGNED and unwrapped: a small in-progress tilt is
   * already close to 0, so "0.5°"/"-0.5°" is more informative than
   * wrapping it up near "359.5°". At or above 1° magnitude the existing
   * `[0°, 360°)` wrap + integer rounding above still applies.
   */
  private updateCropReadout(): void {
    if (!this.crop) return;
    const rawDeg = (this.cropAngle() * 180) / Math.PI;
    if (rawDeg !== 0 && Math.abs(rawDeg) < 1) {
      this.crop.readout.textContent = `${rawDeg.toFixed(1)}°`;
      return;
    }
    const totalDeg = ((Math.round(rawDeg) % 360) + 360) % 360;
    this.crop.readout.textContent = `${totalDeg}°`;
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

  /**
   * Minimum half-extent (bitmap px) of a rect magnifier's source drag
   * target, threaded into `hittest.ts`'s `magnifierHitPart`/`hitTest` as
   * their required `sourceMinHitHalf` parameter (Addendum G, 2026-08-08,
   * §G3) — mirrors `handleHitRadius` exactly, same touch-multiplier /
   * `cropScale()` composition, different base constant.
   *
   * **Grip vs. body at the new minimum** (verify on device, per TASK-50's
   * device checklist): at the `minRectSource` floor (drawn source half-
   * extent 4 CSS px on each axis), the `src-zoom` grip's own touch hit
   * radius is `HANDLE_HIT_PX(12) * TOUCH_HIT_MULTIPLIER(2)` = 24 CSS px,
   * centred at `from + (4, 4)` (the source rect's SE corner); the inflated
   * source hit region is a `2 * MAGNIFIER_SOURCE_MIN_HIT_HALF_PX` = 44 CSS
   * px square (touch), centred on `from`. The square's FAR (NW) corner sits
   * `hypot(22 + 4, 22 + 4)` = **~36.8** CSS px from the grip's centre — well
   * outside the grip's 24 CSS px radius (for reference, `hypot(22, 22) ~=
   * 31.1` is the distance if the drawn source had shrunk all the way to 0;
   * neither figure is close to the grip's radius, so the corner is safe at
   * every drawn-source size down to the floor). Since handles are hit-
   * tested BEFORE `hitTest` (grip wins ties), the grip's disc claims
   * whatever it overlaps; the guaranteed-safe pocket that survives in the
   * far corner is roughly a **9 x 9 CSS px** right triangle at the square's
   * NW corner. Shifted to the grip's own centre, that corner sits at
   * `(-26, -26)` (26 = 22 + 4, the square's half-extent plus the grip's own
   * offset from `from`); along that corner's diagonal, the grip's disc
   * boundary (radius 24) crosses at `24 / sqrt(2) ~= 17` on each axis, so
   * each leg of the safe triangle is `26 - 24/sqrt(2) ~= 9` CSS px before
   * the disc intrudes. This is the mechanism that replaces `minSource = 20`'s
   * "16 CSS px lune" argument (magnifier.ts's own doc comment) for the rect
   * variant, where the DRAWN source can now be much smaller than the
   * grip's own hit radius — it is tight, and is the same property TASK-49
   * AC#8 asserts for the circle; confirm it holds by touch on device.
   */
  private magnifierSourceMinHit(pointerType: string): number {
    const touchMultiplier = pointerType === "touch" ? TOUCH_HIT_MULTIPLIER : 1;
    return MAGNIFIER_SOURCE_MIN_HIT_HALF_PX * touchMultiplier * this.cropScale();
  }

  /**
   * `MAGNIFIER_SRC_HANDLE_OUTSET_PX` in bitmap px (Addendum I, 2026-08-09).
   * NOT touch-multiplied — this is drawn/hit geometry for the handle RING
   * itself (like `HANDLE_DRAW_PX`), not a fingertip floor; the box handles'
   * own grab radius is already touch-scaled independently via
   * `handleHitRadius`. The one owner of the `* cropScale()` multiplication —
   * every `resizeHandlesFor`/`applyResize` call site below reads this
   * instead of re-deriving it.
   */
  private srcHandleOutset(): number {
    return MAGNIFIER_SRC_HANDLE_OUTSET_PX * this.cropScale();
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
   * Derive the lens's `{at, radius, zoom}` for a CIRCLE magnifier being
   * created at `from` — the single place `defaultSourceRadius`/
   * `deriveLensSizeForSource` (S/M/L target sizing, magnifier.ts) and
   * `placeLens` (auto-placement, magnifier.ts) are composed into one
   * annotation-shaped result, with `magnifierLimits()` (Addendum B,
   * 2026-08-02) computed once and threaded through both. Simplified from
   * `magnifierGeometry(from, sourceRadius)` so `onDown` cannot forget to
   * apply the operability floor. Since Addendum A (2026-08-01a), called only
   * from `onDown`, once per gesture: sizing and placement are frozen at
   * pointerdown (`magnifierPlace`) and never recomputed during the slide (see
   * `magnifierSlideUpdate`). Rect twin: `magnifierRectGeometry` below (D4).
   */
  private magnifierGeometry(from: Point): { at: Point; radius: number; zoom: number } {
    const canvasSize = { w: this.canvas.width, h: this.canvas.height };
    const limits = this.magnifierLimits();
    const sourceRadius = defaultSourceRadius(canvasSize, limits);
    const { radius, zoom } = deriveLensSizeForSource(sourceRadius, this.size, canvasSize, limits);
    const at = placeLens(from, sourceRadius, radius, canvasSize, MAGNIFIER_GAP_PX);
    return { at, radius, zoom };
  }

  /**
   * Rect ("cube mode", D4) twin of `magnifierGeometry`: composes
   * `deriveRectLensSize` (S/M/L target sizing, which owns BOTH the source and
   * lens half-extent derivation for the rect case — unlike the circle split
   * above, see that function's own doc comment for why) and `placeRectLens`
   * (auto-placement) into one `{at, width, height, zoom}` result. Same
   * "called once per gesture, frozen into `magnifierPlace`" discipline as
   * `magnifierGeometry`.
   *
   * **`strokeWidth` param and the inflated gap (Addendum F, 2026-08-08, §F1
   * — post-Addendum-E follow-up; the guard this refers to was later carried
   * over unchanged into Addendum G's `magnifierRectConnectorLines`, which
   * replaced the wedge/pentagon `magnifierRectConnectorShape` outright).**
   * Addendum E §E4 widened the rect connector's suppression guard to
   * inflate the SOURCE half-extents by `markerStroke/2` (the source marker
   * is stroked CENTERED
   * on the source rect's boundary, so the painted rim extends that far
   * beyond `magnifierSourceRect`) — correct for the guard, but it means a
   * freshly created magnifier placed with the bare `MAGNIFIER_GAP_PX`
   * (12px, rect-to-rect) can land its connector inside the now-wider
   * suppression band whenever `markerStroke/2 > MAGNIFIER_GAP_PX -
   * MAGNIFIER_CONNECTOR_MIN_GAP_PX` (10px) — reachable on the web target's
   * large `docScale` (e.g. a 2532px-wide iPhone photo at the L preset:
   * `strokeWidth ~= 33.8`, `markerStroke/2 ~= 15.2 > 10`), where the
   * connector would be silently suppressed on creation. Fix: the gap PASSED
   * TO `placeRectLens` is inflated by the same `markerStroke/2` term the
   * guard itself subtracts —
   * `MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth) / 2` — so
   * `MAGNIFIER_GAP_PX` now means "clear space between the PAINTED source
   * rim and the lens rect", the same quantity the guard actually checks.
   * This restores the invariant that a freshly created rect magnifier
   * always clears its own suppression guard by the full
   * `MAGNIFIER_GAP_PX` (not just `MAGNIFIER_CONNECTOR_MIN_GAP_PX`), and
   * self-corrects if `MAGNIFIER_MARKER_STROKE_RATIO` is ever retuned again
   * (it already was once, in TASK-49). `strokeWidth` is the caller's
   * EFFECTIVE creation stroke (`base.strokeWidth`, i.e. `this.strokeWidth *
   * this.docScale` — already `docScale`-adjusted at the call site), not
   * `this.strokeWidth` — using the raw picker value would under-inflate on
   * the web target, where `docScale` is what actually grows the stroke.
   * The circle's `magnifierGeometry` is deliberately untouched:
   * `trimmedConnectorAxis` (the circle's guard) has no band-width term, so a
   * circle connector is suppressed only on true rim overlap — this bug does
   * not exist there, and `MAGNIFIER_GAP_PX` scaling by `docScale` for both
   * shapes was considered and rejected (it would change circle creation
   * layout, a device-verified Done surface, for a problem the circle
   * doesn't have, and `docScale` is the wrong variable regardless — the
   * guard subtracts `markerStroke/2`, not a global scale).
   *
   * **`placeRectLens` itself is intentionally unchanged (§F3)** — no `w1`
   * term added inside it; it stays a pure "place a box with `gap`
   * clearance" function, and the inflated `gap` argument already covers
   * both axes and all 8 `PLACEMENT_DIRS` uniformly. Two consequences of
   * that choice, recorded rather than "fixed": (1) **clamp fallback** — when
   * no candidate fits fully on-canvas, `placeRectLens` returns a clamped
   * candidate whose clearance can fall below the guard (the one documented
   * exception to the "always clears" invariant above; the circle has the
   * same exception, simply overlapping there); (2) **slide-to-aim** —
   * `magnifierRectSlideUpdate` translates a frozen `offset`, so the
   * creation clearance is preserved for the whole gesture, except where the
   * per-frame on-canvas clamp pulls the lens back toward the source at a
   * canvas edge — pre-existing, shape-symmetric with the circle, and
   * legitimate (the user is pushing the two together), not a regression to
   * correct.
   */
  private magnifierRectGeometry(from: Point, strokeWidth: number): { at: Point; width: number; height: number; zoom: number } {
    const canvasSize = { w: this.canvas.width, h: this.canvas.height };
    const limits = this.magnifierLimits();
    const { sourceHalfW, sourceHalfH, width, height, zoom } = deriveRectLensSize(this.size, canvasSize, limits);
    const gap = MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth) / 2;
    const at = placeRectLens(from, sourceHalfW, sourceHalfH, width / 2, height / 2, canvasSize, gap);
    return { at, width, height, zoom };
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
      // Manages its own pointer capture: a handle grab or a tilt drag both
      // take capture; a press inside the region does not (D4's three-way
      // decision order). If crop state is somehow absent, this is a no-op.
      if (!this.crop) return;
      const frame = this.cropFrame();
      const rect = this.cropRect(frame);
      const h = handleAt(p, rect, this.handleHitRadius(e.pointerType));
      if (h) {
        // 1. Corner handle.
        this.canvas.setPointerCapture(e.pointerId);
        this.crop.drag = h;
        this.canvas.style.cursor = this.cursorForHandle(h);
        this.render();
        return;
      }
      if (!this.pointInRect(p, rect)) {
        // 2. Outside the region -> tilt. Capture is mandatory: "drag
        // outside the image" is exactly the gesture that leaves the canvas
        // box. No render() here — nothing has changed yet.
        this.canvas.setPointerCapture(e.pointerId);
        this.crop.rotate = {
          startPointer: p,
          startTilt: this.crop.tilt,
          pivot: { x: frame.w / 2, y: frame.h / 2 },
          armed: false,
        };
        this.canvas.style.cursor = ROTATE_CURSOR_ACTIVE;
        return;
      }
      // 3. Inside the region -> inert (v1/v2's contract, preserved verbatim).
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
      const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance(), this.magnifierSourceMinHit(e.pointerType));
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
      const hit = hitTest(this.doc.annotations, p, this.ctx, tol, this.magnifierSourceMinHit(e.pointerType));
      if (hit) {
        this.selectedId = hit.id;
        // Which half of a magnifier this grab targets, decided once here by
        // the same function (`magnifierHitPart`) that decided the hit — see
        // `move`'s field doc comment. The `?? "lens"` fallback is defensive
        // only (hitTest's magnifier case IS magnifierHitPart, so they cannot
        // disagree); it must never become load-bearing.
        const part: "all" | MagnifierPart = hit.kind === "magnifier" ? (magnifierHitPart(hit, p, tol, this.magnifierSourceMinHit(e.pointerType)) ?? "lens") : "all";
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
      // the source at `p` with the default size, derives the lens's size/zoom
      // and its auto-placement ONCE, then FREEZES `offset = at - from` plus
      // the sizing fields in `magnifierPlace` for the whole gesture — the
      // same "recompute from a fixed base, never incrementally" discipline
      // `move`/`resize`/`rotateDrag` already use. `onMove` (below) only ever
      // reads size/placement back from this frozen object, so a slide can
      // never change what onDown decided. Dispatches on `magnifierShape`
      // (D7's mode toggle) between the circle path (unchanged) and the rect
      // ("cube mode", D4) path — `magnifierRectGeometry`/`magnifierRectSlideUpdate`.
      if (this.magnifierShape === "rect") {
        const { at, width, height, zoom } = this.magnifierRectGeometry(p, base.strokeWidth);
        this.magnifierPlace = { shape: "rect", offset: { x: at.x - p.x, y: at.y - p.y }, half: { x: width / 2, y: height / 2 } };
        this.draft = { ...base, kind: "magnifier", shape: "rect", from: p, at, width, height, zoom };
      } else {
        const { at, radius, zoom } = this.magnifierGeometry(p);
        this.magnifierPlace = { shape: "circle", offset: { x: at.x - p.x, y: at.y - p.y }, radius, zoom };
        this.draft = { ...base, kind: "magnifier", from: p, at, radius, zoom };
      }
    }
    this.render();
  }

  private onMove(p: Point, shiftKey = false, pointerType = ""): void {
    const tool = this.tool;

    // Priority: rotate > resize > move > crop tilt > crop handle drag > draft > hover (D4).
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
      let updated = applyResize(
        original,
        bounds,
        handle,
        localP,
        shiftKey,
        this.magnifierLimits(),
        { w: this.canvas.width, h: this.canvas.height },
        this.srcHandleOutset(),
      );
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

    if (this.crop?.rotate) {
      // B2.2: unarmed until the pointer clears TILT_SLOP_PX from the grab —
      // a tap-and-release never writes `crop.tilt` at all. Once armed for
      // this gesture, stays armed (checking every move would let the
      // pointer wander back inside the slop radius and freeze mid-drag).
      const { startPointer, startTilt, pivot, armed } = this.crop.rotate;
      if (!armed) {
        const dist = Math.hypot(p.x - startPointer.x, p.y - startPointer.y);
        if (dist <= TILT_SLOP_PX * this.cropScale()) {
          this.canvas.style.cursor = ROTATE_CURSOR_ACTIVE;
          return;
        }
        this.crop.rotate.armed = true;
      }
      // D4: relative to the grab (tiltFromDrag never snaps the image to the
      // pointer), snapped to 15° with Shift, clamped to +/-MAX_TILT_RAD.
      this.crop.tilt = tiltFromDrag(pivot, startPointer, p, startTilt, shiftKey);
      this.canvas.style.cursor = ROTATE_CURSOR_ACTIVE;
      this.render();
      return;
    }

    if (this.crop?.drag) {
      const frame = this.cropFrame();
      const rect = applyHandleDrag(this.cropRect(frame), this.crop.drag, p, frame.bounds, MIN_CROP_PX);
      this.crop.norm = normalizeRect(rect, frame.bounds);
      this.crop.touched = true;
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
        // on-canvas — the frozen size fields are deliberately untouched here,
        // they cannot change mid-slide. The finger occludes the source, never
        // the lens, so the lens is the live viewfinder the user aims with.
        // Dispatches on `magnifierPlace.shape` (set together with the draft
        // in onDown, so it always agrees with `this.draft.shape`) to the
        // matching per-shape slide-update function (D4).
        const canvasSize = { w: this.canvas.width, h: this.canvas.height };
        const place = this.magnifierPlace!;
        if (place.shape === "rect") {
          const { from, at } = magnifierRectSlideUpdate(p, place, canvasSize);
          this.draft.from = from;
          this.draft.at = at;
        } else {
          const { from, at } = magnifierSlideUpdate(p, place, canvasSize);
          this.draft.from = from;
          this.draft.at = at;
        }
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
        const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance(), this.magnifierSourceMinHit(pointerType));
        this.canvas.style.cursor = hit ? "move" : "default";
      }
    } else if (tool === "crop" && this.crop) {
      // Hover cursor rules (D4): a corner handle wins, else outside the
      // region reads as the tilt affordance, else inside is the resting
      // (inert) cursor.
      const rect = this.cropRect();
      const h = handleAt(p, rect, this.handleHitRadius(pointerType));
      if (h) {
        this.canvas.style.cursor = this.cursorForHandle(h);
      } else {
        this.canvas.style.cursor = this.pointInRect(p, rect) ? "default" : ROTATE_CURSOR_HOVER;
      }
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

    if (this.crop?.rotate) {
      // D4: tilt release commits nothing to history either — the tilt only
      // becomes undoable state on applyCrop(). Pointer capture is released
      // implicitly by the browser on pointerup.
      this.crop.rotate = null;
      this.canvas.style.cursor = "crosshair";
      this.render();
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
