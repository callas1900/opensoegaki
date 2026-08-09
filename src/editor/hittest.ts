/**
 * Pure geometry: hit-testing over the annotation object model. Format-agnostic
 * (a future `.soegaki` loader or SVG exporter can reuse this), and
 * deliberately NOT imported by exporter.ts — that import boundary is the
 * mechanical guarantee that selection chrome cannot leak into rasterized
 * output. `Bounds`/`boundsOf` live in the leaf module `bounds.ts` (moved out
 * so `render.ts` can also reach them without a `hittest.ts` import cycle) —
 * import them from there directly, not through this module.
 */
import type { Annotation, MagnifierAnnotation, MagnifierPart, Point } from "./model";
import { HIGHLIGHTER_WIDTH_SCALE } from "./model";
import { type Bounds, boundsOf } from "./bounds";
import { pivotOfAnnotation, unrotatePoint } from "./rotate";
import { magnifierSourceRadius, magnifierSourceRect, magnifierLensRect } from "./magnifier";
// Shared with render.ts's drawMagnifier so the hit band always matches the
// weight the source ring is actually drawn at (the connector is deliberately
// not hit-testable, so this module only ever uses the ring's weight, even
// though the same constant also governs the connector in render.ts).
// magnifierMarkerStroke (Addendum F, 2026-08-08, F2) is the one owner of
// this derivation — render.ts's home, since it owns the ratio itself.
import { magnifierMarkerStroke } from "./render";

/**
 * Topmost-first hit test: iterates the list from last (drawn on top) to
 * first. `sourceMinHitHalf` (Addendum G, 2026-08-08, §G3) is REQUIRED — the
 * same "required so TypeScript names every call site" precedent
 * `applyResize`'s `canvasSize` parameter set (Addenda D §D9/§D10) — and is
 * forwarded unchanged to `magnifierHitPart` for a magnifier annotation;
 * every other kind ignores it. Pass `0` for pure-geometry callers (no
 * minimum) — see `magnifierHitPart`'s own doc comment for what it does.
 */
export function hitTest(
  list: Annotation[],
  p: Point,
  measure: CanvasRenderingContext2D,
  tolerance: number,
  sourceMinHitHalf: number,
): Annotation | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (hitsAnnotation(a, p, measure, tolerance, sourceMinHitHalf)) return a;
  }
  return null;
}

function hitsAnnotation(
  a: Annotation,
  p: Point,
  measure: CanvasRenderingContext2D,
  tolerance: number,
  sourceMinHitHalf: number,
): boolean {
  // Inverse-rotate the pointer into the shape's local (unrotated) frame
  // before running the existing, unchanged per-kind test below. Rotation is
  // an isometry, so every distance-based tolerance test stays valid.
  const angle = a.angle ?? 0;
  if (angle) p = unrotatePoint(p, pivotOfAnnotation(a, measure), angle);
  switch (a.kind) {
    case "arrow": {
      const dist = distanceToSegment(p, a.from, a.to);
      return dist <= tolerance + a.strokeWidth / 2;
    }
    case "rect": {
      const b = boundsOf(a, measure);
      return nearRectOutline(p, b, tolerance + a.strokeWidth / 2);
    }
    case "text": {
      const b = boundsOf(a, measure);
      return pointInBounds(p, inflate(b, tolerance));
    }
    case "highlight": {
      let minDist = Infinity;
      for (let i = 0; i < a.points.length - 1; i++) {
        const d = distanceToSegment(p, a.points[i], a.points[i + 1]);
        if (d < minDist) minDist = d;
      }
      return minDist <= tolerance + (a.strokeWidth * HIGHLIGHTER_WIDTH_SCALE) / 2;
    }
    case "badge": {
      // Manual badges are wider than tall (rounded rect, see drawBadge/
      // badgeHalfWidth) and filled, so a bbox hit (like text/image below)
      // matches their visible shape; auto badges stay a plain circle test.
      if (a.manual) {
        const b = boundsOf(a, measure);
        return pointInBounds(p, inflate(b, tolerance));
      }
      return Math.hypot(p.x - a.at.x, p.y - a.at.y) <= a.radius + tolerance;
    }
    case "image": {
      // Images are selectable/movable/deletable/resizable via the standard
      // select-tool machinery (translateAnnotation, deleteSelected and
      // resize.ts's applyResize all handle "image" generically).
      const b = boundsOf(a, measure);
      return pointInBounds(p, inflate(b, tolerance));
    }
    case "magnifier":
      return magnifierHitPart(a, p, tolerance, sourceMinHitHalf) !== null;
  }
}

/**
 * Which half of a magnifier the pointer landed on — the lens wins where the
 * two overlap (paint order): the lens is tested first (filled disc, `radius +
 * tolerance`, the auto-badge precedent verbatim — filled rect, inflated by
 * `tolerance`, for the rect variant), then the source region. `null` when
 * neither is hit.
 *
 * **`sourceMinHitHalf` (Addendum G, 2026-08-08, §G3) — REQUIRED, rect-only.**
 * Pre-Addendum-G the rect source's hit region was exactly its drawn size
 * (inflated by the marker band), same as the circle. Addendum G shrank the
 * rect source's DRAWN size to a legibility-only floor
 * (`MIN_MAGNIFIER_RECT_SOURCE_CSS_PX`, magnifier.ts) far below a fingertip —
 * so the fingertip/operability requirement moved HERE, to the hit region,
 * which is now independently floored per axis at `sourceMinHitHalf`
 * (half-extent, CSS-px-derived, `canvas.ts`'s `magnifierSourceMinHit`):
 *
 * ```ts
 * const src = magnifierSourceRect(a);            // centred on a.from by construction (D2)
 * const pad = tolerance + markerStroke / 2;
 * const hw = Math.max(src.w / 2 + pad, sourceMinHitHalf);
 * const hh = Math.max(src.h / 2 + pad, sourceMinHitHalf);
 * ```
 *
 * The CIRCLE branch ignores this parameter entirely — its own `minSource`
 * floor (20 CSS px radius) already exceeds any minimum this module would
 * apply, and touching the circle's hit geometry here would change TASK-49
 * AC#1 surface for a problem the circle does not have. Required (not
 * optional-with-a-default) so every call site must decide the value
 * explicitly — the same "required so TypeScript names every call site"
 * precedent `applyResize`'s `canvasSize` parameter set. Unit tests pass `0`
 * ("no minimum" — pure geometry, matching the pre-Addendum-G behavior
 * exactly for those fixtures).
 *
 * No unrotation: a magnifier can never carry a non-zero `angle`
 * (`canRotate("magnifier") === false` — see rotate.ts — and group rotation is
 * translation-only), so this probe takes world coords as-is. This is the one
 * owner of magnifier hit geometry; `hitsAnnotation`'s "magnifier" case is a
 * pure delegation to it.
 */
export function magnifierHitPart(a: MagnifierAnnotation, p: Point, tolerance: number, sourceMinHitHalf: number): MagnifierPart | null {
  const markerStroke = magnifierMarkerStroke(a.strokeWidth);
  if (a.shape === "rect") {
    const lensHit = pointInBounds(p, inflate(magnifierLensRect(a), tolerance));
    if (lensHit) return "lens";
    const src = magnifierSourceRect(a); // centred on a.from by construction (D2)
    const pad = tolerance + markerStroke / 2;
    const hw = Math.max(src.w / 2 + pad, sourceMinHitHalf);
    const hh = Math.max(src.h / 2 + pad, sourceMinHitHalf);
    const sourceHit = Math.abs(p.x - a.from.x) <= hw && Math.abs(p.y - a.from.y) <= hh;
    return sourceHit ? "source" : null;
  }
  if (Math.hypot(p.x - a.at.x, p.y - a.at.y) <= a.radius + tolerance) return "lens";
  const sourceRadius = magnifierSourceRadius(a);
  if (Math.hypot(p.x - a.from.x, p.y - a.from.y) <= sourceRadius + tolerance + markerStroke / 2) return "source";
  return null;
}

/** Shortest distance from point p to segment v-w. */
function distanceToSegment(p: Point, v: Point, w: Point): number {
  const dx = w.x - v.x;
  const dy = w.y - v.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * dx + (p.y - v.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * dx;
  const projY = v.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** True when p is within `tol` of the rect's perimeter (edge band, not filled interior). */
function nearRectOutline(p: Point, r: Bounds, tol: number): boolean {
  const outer = inflate(r, tol);
  if (!pointInBounds(p, outer)) return false;
  const inner = inflate(r, -tol);
  // Degenerate thin rects (inner has no positive area) fall back to filled hit.
  if (inner.w <= 0 || inner.h <= 0) return true;
  return !pointInBounds(p, inner);
}

function pointInBounds(p: Point, b: Bounds): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function inflate(b: Bounds, amount: number): Bounds {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
}
