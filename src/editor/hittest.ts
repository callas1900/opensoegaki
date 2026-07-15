/**
 * Pure geometry: bounds and hit-testing over the annotation object model.
 * Format-agnostic (a future `.soegaki` loader or SVG exporter can reuse this),
 * and deliberately NOT imported by exporter.ts — that import boundary is the
 * mechanical guarantee that selection chrome cannot leak into rasterized output.
 */
import type { Annotation, Point } from "./model";
import { fontString } from "./render";

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOf(a: Annotation, measure: CanvasRenderingContext2D): Bounds {
  switch (a.kind) {
    case "arrow": {
      const x = Math.min(a.from.x, a.to.x);
      const y = Math.min(a.from.y, a.to.y);
      return { x, y, w: Math.abs(a.from.x - a.to.x), h: Math.abs(a.from.y - a.to.y) };
    }
    case "rect": {
      const x = Math.min(a.a.x, a.b.x);
      const y = Math.min(a.a.y, a.b.y);
      return { x, y, w: Math.abs(a.a.x - a.b.x), h: Math.abs(a.a.y - a.b.y) };
    }
    case "text": {
      measure.font = fontString(a.fontSize);
      const w = measure.measureText(a.text).width;
      const h = a.fontSize * 1.2;
      return { x: a.at.x, y: a.at.y, w, h };
    }
  }
}

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

function pointInBounds(p: Point, b: Bounds): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function inflate(b: Bounds, amount: number): Bounds {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
}
