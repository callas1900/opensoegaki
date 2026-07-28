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
import type { Annotation, AnnotationKind, Point } from "./model";
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
