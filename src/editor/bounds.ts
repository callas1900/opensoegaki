/**
 * Pure geometry: text/badge metrics and the annotation bounding box. Leaf
 * module — imports only `model.ts`. Format-agnostic (a future `.soegaki`
 * loader or SVG exporter can reuse this), and deliberately imported by
 * `render.ts`/`hittest.ts`/`resize.ts`/`rotate.ts`/`canvas.ts` alike: it is
 * the one shared owner of "where a shape is", so render/hit-test/resize/
 * rotate never duplicate this math and drift apart.
 */
import type { Annotation, BadgeAnnotation } from "./model";

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FONT_STACK = "system-ui, sans-serif";
export function fontString(fontSize: number): string {
  return `bold ${fontSize}px ${FONT_STACK}`;
}

// Lazily-created offscreen 2D context used only for text-width measurements
// taken outside of a live draw call (badgeHalfWidth below, called from
// hittest.ts/canvas.ts, which have no CanvasRenderingContext2D of their own
// to measure with).
let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    measureCtx = ctx;
  }
  return measureCtx;
}

/**
 * Half-width of a badge's visible shape, in bitmap px. Auto badges are
 * perfect circles, so this is just `a.radius`. Manual (fixed-number) badges
 * are drawn as a rounded rect that widens to fit the number instead of
 * shrinking the font (see `render.ts`'s `drawBadge`); this mirrors that same
 * layout math so hit-testing and selection bounds (`boundsOf` below,
 * `canvas.ts`) never disagree with rendering about where a manual badge's
 * edge is.
 */
export function badgeHalfWidth(a: BadgeAnnotation): number {
  if (!a.manual) return a.radius;
  const ctx = getMeasureCtx();
  ctx.font = fontString(a.radius * 1.2);
  const textWidth = ctx.measureText(String(a.number)).width;
  return Math.max(a.radius, textWidth / 2 + a.radius * 0.55);
}

/**
 * The annotation's UNROTATED, local-frame axis-aligned box — `a.angle` is
 * never consulted here. Every handle position, `applyResize` call and
 * marquee coordinate is expressed in this local frame; world position is
 * `rotate(local, pivotOf(bounds), a.angle)` (see `rotate.ts`).
 */
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
    case "highlight": {
      const xs = a.points.map((p) => p.x);
      const ys = a.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case "badge": {
      // Auto badges: hw === a.radius, so this is exactly the old circle
      // bbox. Manual badges widen to fit their number (see badgeHalfWidth's
      // doc comment) — same widened box drawBadge renders.
      const hw = badgeHalfWidth(a);
      return { x: a.at.x - hw, y: a.at.y - a.radius, w: 2 * hw, h: 2 * a.radius };
    }
    case "image":
      return { x: a.at.x, y: a.at.y, w: a.width, h: a.height };
    case "magnifier":
      // The LENS's bounding box only — the marquee, resize handles and
      // rotation pivot all want the lens, not a union with the source. The
      // source region is a satellite with its own drag surface and its own
      // hit region (see magnifier.ts's magnifierSourceRadius/
      // magnifierSourceRect, hittest.ts's magnifierHitPart, and resize.ts's
      // src-zoom handle), never folded into these bounds. Rect branch (D2)
      // returns the lens rect inline rather than calling magnifier.ts's
      // `magnifierLensRect` — existing pattern: `magnifier.ts` already
      // imports `Bounds` from this module, so the reverse import would be a
      // cycle; bounds.ts stays a magnifier.ts-free leaf.
      if (a.shape === "rect") {
        return { x: a.at.x - a.width / 2, y: a.at.y - a.height / 2, w: a.width, h: a.height };
      }
      return { x: a.at.x - a.radius, y: a.at.y - a.radius, w: 2 * a.radius, h: 2 * a.radius };
  }
}
