/**
 * Pure rotation math — no DOM, no canvas context. Leaf module: imports only
 * `model.ts` types and `bounds.ts` (itself a leaf). Used by `render.ts`
 * (pivot for the draw-time transform), `hittest.ts` (inverse-rotate the
 * pointer), `resize.ts`/`canvas.ts` (rotate-drag gesture, resize composition,
 * rotated text re-edit). Selection-chrome geometry (the rotate knob's
 * position, the resize handles' pinned-anchor point) is NOT here — see
 * `resize.ts`'s `rotateHandleFor`/`anchorPointFor`, which already owns handle
 * layout and, like this module, is never reachable from `exporter.ts`.
 *
 * All angles are radians, clockwise in canvas y-down coordinates — exactly
 * what `CanvasRenderingContext2D.rotate()` consumes — normalized to
 * `(-π, π]`. The pivot for every kind is the center of `boundsOf`'s unrotated
 * (local-frame) box; there is no per-kind special case (badge's box is
 * already centered on `a.at`, so `pivotOfAnnotation` degenerates to `a.at`
 * for badges without any extra code).
 */
import { translateAnnotation, type Annotation, type AnnotationKind, type Point } from "./model";
import { type Bounds, boundsOf } from "./bounds";

/** Absolute-angle snap increment for a Shift-modified rotate drag: 15°. */
export const ROTATION_SNAP_RAD = Math.PI / 12;

/**
 * Kinds that offer the select tool's rotate-handle affordance. Arrow's
 * direction is already first-class in from/to (endpoint drag + Shift-45°
 * snap already rotates it); highlight is a freehand stroke, move/delete-only
 * like its TASK-29 resize exemption. Both still render rotated if given an
 * angle.
 *
 * "magnifier" is the third exemption, and for correctness, not taste:
 * `ctx.drawImage`'s SOURCE rectangle is always axis-aligned in image space
 * and unaffected by the ctx transform, while the source ring drawn inside
 * `renderAnnotations`'s generic rotate transform WOULD swing around the
 * lens's pivot — pointing at a region the loupe does not actually sample, so
 * the annotation's entire spatial claim would break. (A circle is
 * rotationally symmetric anyway, so the affordance would be visually
 * meaningless even where it were safe.) TASK-42 hazard: multi-select group
 * rotation must treat magnifier as translation-only — rigidly rotate `from`/
 * `at`, leave `angle` at 0; setting `angle` on a magnifier reproduces the
 * broken state above.
 */
export function canRotate(kind: AnnotationKind): boolean {
  return kind === "rect" || kind === "image" || kind === "text" || kind === "badge";
}

/** `a.angle`, defaulting to 0 and normalized — the single place "what is this annotation's angle" is computed. */
export function angleOf(a: Annotation): number {
  return normalizeAngle(a.angle ?? 0);
}

/** Wrap `angle` into `(-π, π]`. */
export function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** The center of a local-frame `Bounds` box — the rotation pivot. */
export function pivotOf(b: Bounds): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The rotation pivot for `a`, derived from its unrotated `boundsOf` box. */
export function pivotOfAnnotation(a: Annotation, measure: CanvasRenderingContext2D): Point {
  return pivotOf(boundsOf(a, measure));
}

/** Rotate `p` about `pivot` by `angle` (clockwise, y-down — matches `ctx.rotate`). */
export function rotatePoint(p: Point, pivot: Point, angle: number): Point {
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

/** Inverse of `rotatePoint`: maps a world-space point into the shape's local (unrotated) frame. */
export function unrotatePoint(p: Point, pivot: Point, angle: number): Point {
  return rotatePoint(p, pivot, -angle);
}

/** Angle (radians) from `pivot` to `p`, `atan2`-based (not normalized — callers only ever difference two of these). */
export function pointerAngle(pivot: Point, p: Point): number {
  return Math.atan2(p.y - pivot.y, p.x - pivot.x);
}

/**
 * The new angle for a rotate-knob drag: relative to the drag's start (grabbing
 * the knob never snaps the shape to the pointer — the offset between the
 * pointer and the shape's current orientation at grab time is preserved for
 * the whole gesture). `snap` rounds the resulting ABSOLUTE angle to the
 * nearest `ROTATION_SNAP_RAD` (15°) — so 0° is always reachable even though
 * the drag itself is relative. Returns a normalized angle.
 */
export function rotationFromDrag(
  pivot: Point,
  startPointer: Point,
  pointer: Point,
  startAngle: number,
  snap: boolean,
): number {
  const delta = pointerAngle(pivot, pointer) - pointerAngle(pivot, startPointer);
  let angle = startAngle + delta;
  if (snap) angle = Math.round(angle / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD;
  return normalizeAngle(angle);
}

/** World-space corners of a local box `b` rotated by `angle` about its own pivot, in nw, ne, se, sw order. */
export function rotatedCorners(b: Bounds, angle: number): [Point, Point, Point, Point] {
  const pivot = pivotOf(b);
  const nw = { x: b.x, y: b.y };
  const ne = { x: b.x + b.w, y: b.y };
  const se = { x: b.x + b.w, y: b.y + b.h };
  const sw = { x: b.x, y: b.y + b.h };
  return [nw, ne, se, sw].map((p) => rotatePoint(p, pivot, angle)) as [Point, Point, Point, Point];
}

/**
 * The translation that keeps `anchorLocal` (a point expressed in the shape's
 * local frame, invariant across the bounds change) world-fixed when its local
 * bounds change from `before` to `after` at constant `angle`. `{0,0}` at
 * `angle === 0` or when the two boxes share a pivot (nothing to re-anchor).
 * See resize.ts's `anchorPointFor` for how the anchor point itself is picked,
 * and canvas.ts's rotate-composition wiring for how this closes the loop.
 */
export function reanchorDelta(anchorLocal: Point, before: Bounds, after: Bounds, angle: number): Point {
  if (!angle) return { x: 0, y: 0 };
  const pivotBefore = pivotOf(before);
  const pivotAfter = pivotOf(after);
  if (pivotBefore.x === pivotAfter.x && pivotBefore.y === pivotAfter.y) return { x: 0, y: 0 };
  const worldBefore = rotatePoint(anchorLocal, pivotBefore, angle);
  const worldAfter = rotatePoint(anchorLocal, pivotAfter, angle);
  return { x: worldBefore.x - worldAfter.x, y: worldBefore.y - worldAfter.y };
}

/** `{...a, angle: normalized}` — returns `a` unchanged (same reference) when the normalized angle doesn't change, so callers can cheaply skip a no-op history push/render. Never mutates `a`. */
export function applyRotation(a: Annotation, angle: number): Annotation {
  const normalized = normalizeAngle(angle);
  if (angleOf(a) === normalized) return a;
  return { ...a, angle: normalized };
}

/**
 * TASK-52 destructive document rotation (design note
 * docs/design/2026-08-19-crop-canvas-rotation.md, D5/D6): the crop tool's
 * "apply" step never stores a document-level angle — it resamples the
 * background bitmap once and rigidly re-maps every annotation to match. This
 * section stays a leaf: it only ever reuses `rotatePoint`/`normalizeAngle`/
 * `pivotOfAnnotation`/`applyRotation`/`canRotate` above and `translateAnnotation`
 * from model.ts.
 *
 * `outRect` is typed as bounds.ts's `Bounds` rather than crop.ts's
 * `CropRect` — the two interfaces are structurally identical (`{x,y,w,h}`)
 * — specifically so this module never has to import crop.ts (crop.ts
 * already imports THIS module's `pointerAngle`/`ROTATION_SNAP_RAD`/
 * `normalizeAngle` for its own tilt-drag math, so the reverse import would
 * be a cycle). Any `CropRect` value can be passed here as-is.
 */

/** True when `angle` is within `1e-9` radians of an ODD multiple of `PI/2` (90 or 270 degrees, not 0 or 180). */
function isOddQuarterTurn(angle: number): boolean {
  const q = angle / (Math.PI / 2);
  const rounded = Math.round(q);
  return Math.abs(q - rounded) < 1e-9 && ((((rounded % 2) + 2) % 2) === 1);
}

/**
 * `cos`/`sin` of `angle`, snapped to the exact integers `0`/`+/-1` when
 * `angle` is within `1e-9` radians of a multiple of `PI/2` (reviewer F2 on
 * TASK-52: `Math.cos(Math.PI / 2)` is `6.1e-17`, not `0`, so a "clean" 90
 * degree turn was silently taking the general resampling path and paying a
 * bit-lossy quarter turn for no reason). `documentRotation`'s `matrix` and
 * `map` both go through this one function — never `Math.cos`/`Math.sin`
 * directly — so the two representations of the same rotation can never
 * disagree, and `rotatedBBox` below reuses it so bbox and map agree too
 * (F3: they used to be two independently-rounded owners of the same
 * quantity, off by ~4e-13 px at a quarter turn).
 */
function exactCosSin(angle: number): { cos: number; sin: number } {
  const q = angle / (Math.PI / 2);
  const rounded = Math.round(q);
  if (Math.abs(q - rounded) < 1e-9) {
    const k = ((rounded % 4) + 4) % 4;
    const COS = [1, 0, -1, 0];
    const SIN = [0, 1, 0, -1];
    return { cos: COS[k], sin: SIN[k] };
  }
  return { cos: Math.cos(angle), sin: Math.sin(angle) };
}

/**
 * Axis-aligned bounding box of a `w x h` box rotated by `angle` about its own
 * center — `w * |cos| + h * |sin|` (and the transposed form for height), the
 * standard projection formula, valid for any angle since both trig terms are
 * taken as absolute values. THE single owner of this quantity (F3 on
 * TASK-52): `crop.ts`'s `rotatedBBox` re-exports this function rather than
 * keeping its own independently-computed copy, and `documentRotation` below
 * calls it directly for the same reason. Uses `exactCosSin` so a quarter
 * turn's bbox is bit-exact (an integer `w`/`h` in, an integer `w`/`h` out),
 * matching `documentRotation`'s `map`.
 */
export function rotatedBBox(w: number, h: number, angle: number): { w: number; h: number } {
  const { cos, sin } = exactCosSin(normalizeAngle(angle));
  const c = Math.abs(cos);
  const s = Math.abs(sin);
  return { w: w * c + h * s, h: w * s + h * c };
}

/**
 * The result of rotating an `srcW x srcH` source image by `angle` and
 * cropping to `outRect` — `outRect` lives in "rotated-source" space: origin
 * at the rotated bounding box's own top-left, unit = source (unscaled) px
 * (exactly what `crop.ts`'s `frameToRotatedSource` produces). `map` carries
 * that same rigid transform for annotations (`rotateAnnotationForDocument`
 * below) and for any other source-px point a caller needs to relocate.
 */
export interface DocumentRotation {
  /** Normalized total rotation, radians. */
  angle: number;
  /** Output document size, integer px. */
  out: { w: number; h: number };
  /** `ctx.setTransform(...)` arguments for `drawImage(src, 0, 0)` into the output canvas. */
  matrix: [number, number, number, number, number, number];
  /** Source image px -> output px, for the same rigid transform as `matrix`. */
  map(p: Point): Point;
}

/**
 * Build the source-to-output rotation for a crop-with-rotation apply (D5).
 * `map(p) = rotate(p - c, cos, sin) + (bboxW/2 - outRect.x, bboxH/2 - outRect.y)`
 * with `c` the source image's own center — i.e. rotate about the source
 * center, then shift so `outRect`'s top-left in rotated-source space lands
 * at the output's (0,0). `matrix` is `[cos, sin, -sin, cos, e, f]` with
 * `(e, f) = map({x:0, y:0})`, which is algebraically exactly the constant
 * term of `map` as an affine transform (`map(p) = M*p + map(0,0)`), so
 * `ctx.setTransform(...matrix)` followed by `drawImage(src, 0, 0)` paints
 * the source through the identical transform `map` uses for annotations.
 *
 * `cos`/`sin` come from `exactCosSin`, not `rotatePoint`'s own
 * `Math.cos`/`Math.sin` — F2 on TASK-52: at a quarter turn this makes `map`
 * bit-exact (an integer source corner maps to an integer output corner) and
 * keeps `bbox` (from `rotatedBBox`, which uses the same helper) in exact
 * agreement with the translation term below, instead of the two drifting by
 * a `~1e-13` px residual.
 */
export function documentRotation(srcW: number, srcH: number, angle: number, outRect: Bounds): DocumentRotation {
  const a = normalizeAngle(angle);
  const { cos, sin } = exactCosSin(a);
  const c: Point = { x: srcW / 2, y: srcH / 2 };
  const bbox = rotatedBBox(srcW, srcH, a);
  const offsetX = bbox.w / 2 - outRect.x;
  const offsetY = bbox.h / 2 - outRect.y;

  const map = (p: Point): Point => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return {
      x: dx * cos - dy * sin + offsetX,
      y: dx * sin + dy * cos + offsetY,
    };
  };

  const origin = map({ x: 0, y: 0 });
  return {
    angle: a,
    out: { w: Math.round(outRect.w), h: Math.round(outRect.h) },
    matrix: [cos, sin, -sin, cos, origin.x, origin.y],
    map,
  };
}

/**
 * Rigidly re-map annotation `a` through document rotation `r` (D6). `s`
 * (the crop preview's scale factor) never applies here — `r` is a pure
 * rotation + translation — so every size field (stroke width, font size,
 * radius, lens dimensions) is invariant; only position and angle change.
 *
 * - Kinds with a first-class `angle` (`rect`, `image`, `text`, `badge`, and
 *   any `arrow`/`highlight` that a future TASK-42 group rotation gave a
 *   nonzero angle): rotate in place (`applyRotation(a, angleOf(a) + r.angle)`)
 *   then translate by the delta that puts the shape's pivot exactly on
 *   `r.map(pivot)`. The pivot is computed from `a`'s UNROTATED local bounds
 *   (`pivotOfAnnotation`, which ignores `a.angle` by construction — see
 *   bounds.ts's `boundsOf`), and `applyRotation` never touches the shape's
 *   points, so that same pivot is still exactly where the rotated-in-place
 *   copy's pivot is; the translate delta is simply `r.map(pivot) - pivot`.
 * - `arrow`/`highlight` with `angle === 0` (today, always — see `canRotate`):
 *   map every point directly (`from`/`to`, `points`). Exact, and preserves
 *   the existing design intent that an arrow's direction is first-class in
 *   `from`/`to` rather than in `angle`.
 * - `magnifier` (excluded from `canRotate` — its source rectangle is always
 *   axis-aligned in image space, see that function's doc comment): map `at`
 *   and `from` as plain points, leave `angle` at 0. A rect-shaped lens swaps
 *   `width`/`height` only when the rotation is an ODD multiple of 90 degrees
 *   (`isOddQuarterTurn`) — a documented TASK-52 deviation: a rect lens
 *   un-tilts under free rotation (see the design note's "Documented
 *   deviations" section), which the model cannot avoid without giving a
 *   magnifier an angle and breaking the axis-aligned-source invariant
 *   `canRotate` documents.
 */
export function rotateAnnotationForDocument(
  a: Annotation,
  r: DocumentRotation,
  measure: CanvasRenderingContext2D,
): Annotation {
  if (a.kind === "magnifier") {
    const at = r.map(a.at);
    const from = r.map(a.from);
    if (a.shape === "rect" && isOddQuarterTurn(r.angle)) {
      return { ...a, at, from, angle: 0, width: a.height, height: a.width };
    }
    return { ...a, at, from, angle: 0 };
  }

  if (a.kind === "arrow" && angleOf(a) === 0) {
    return { ...a, from: r.map(a.from), to: r.map(a.to) };
  }

  if (a.kind === "highlight" && angleOf(a) === 0) {
    return { ...a, points: a.points.map((p) => r.map(p)) };
  }

  // rect, image, text, badge — plus a future angled arrow/highlight.
  const pivot = pivotOfAnnotation(a, measure);
  const rotated = applyRotation(a, angleOf(a) + r.angle);
  const target = r.map(pivot);
  return translateAnnotation(rotated, target.x - pivot.x, target.y - pivot.y);
}
