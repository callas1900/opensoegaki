/**
 * Pure geometry: hit-testing over the annotation object model. Format-agnostic
 * (a future `.soegaki` loader or SVG exporter can reuse this), and
 * deliberately NOT imported by exporter.ts — that import boundary is the
 * mechanical guarantee that selection chrome cannot leak into rasterized
 * output. `Bounds`/`boundsOf` live in the leaf module `bounds.ts` (moved out
 * so `render.ts` can also reach them without a `hittest.ts` import cycle) —
 * import them from there directly, not through this module.
 */
import type { Annotation, Point } from "./model";
import { HIGHLIGHTER_WIDTH_SCALE } from "./model";
import { type Bounds, boundsOf } from "./bounds";
import { pivotOfAnnotation, unrotatePoint } from "./rotate";
import { magnifierSourceRadius } from "./magnifier";
// Shared with render.ts's drawMagnifier so the hit band always matches the
// weight the source ring is actually drawn at (the connector is deliberately
// not hit-testable, so this module only ever uses the ring's weight, even
// though the same constant also governs the connector in render.ts).
import { MAGNIFIER_MARKER_STROKE_RATIO } from "./render";

/** Topmost-first hit test: iterates the list from last (drawn on top) to first. */
export function hitTest(
  list: Annotation[],
  p: Point,
  measure: CanvasRenderingContext2D,
  tolerance: number,
): Annotation | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (hitsAnnotation(a, p, measure, tolerance)) return a;
  }
  return null;
}

function hitsAnnotation(
  a: Annotation,
  p: Point,
  measure: CanvasRenderingContext2D,
  tolerance: number,
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
    case "magnifier": {
      // Filled lens circle (the auto-badge precedent verbatim) OR the source
      // circle's hollow RING band — its interior must not swallow clicks
      // meant for whatever is underneath the source region.
      if (Math.hypot(p.x - a.at.x, p.y - a.at.y) <= a.radius + tolerance) return true;
      const sourceRadius = magnifierSourceRadius(a);
      const sourceStroke = Math.max(1, a.strokeWidth * MAGNIFIER_MARKER_STROKE_RATIO);
      return nearCircleOutline(p, a.from, sourceRadius, tolerance + sourceStroke / 2);
    }
  }
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

/** True when p is within `tol` of a circle's perimeter (ring band, not the filled disc) — mirrors `nearRectOutline` for circles. */
function nearCircleOutline(p: Point, center: Point, r: number, tol: number): boolean {
  return Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - r) <= tol;
}

function pointInBounds(p: Point, b: Bounds): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function inflate(b: Bounds, amount: number): Bounds {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
}
