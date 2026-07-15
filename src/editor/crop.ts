/**
 * Pure geometry for the in-editor crop tool: normalizes a pointer drag into
 * an integer-pixel crop rectangle clamped to the image bounds. DOM-free, no
 * canvas usage — deliberately NOT imported by exporter.ts (crop chrome is
 * live-canvas-only, same import-boundary discipline as hittest.ts).
 */
import type { Point } from "./model";

/** Drags smaller than this (in either dimension) are treated as "no crop". */
export const MIN_CROP_PX = 8;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalize a drag between two points (in either direction) into an
 * integer-pixel crop rectangle clamped to [0, imageW] x [0, imageH]. Returns
 * null for a rectangle smaller than `minSize` in either dimension, or for a
 * rectangle that covers the whole image (a no-op crop that should not push
 * an undo step).
 */
export function computeCrop(
  a: Point,
  b: Point,
  imageW: number,
  imageH: number,
  minSize: number,
): CropRect | null {
  const x0 = Math.round(clamp(Math.min(a.x, b.x), 0, imageW));
  const y0 = Math.round(clamp(Math.min(a.y, b.y), 0, imageH));
  const x1 = Math.round(clamp(Math.max(a.x, b.x), 0, imageW));
  const y1 = Math.round(clamp(Math.max(a.y, b.y), 0, imageH));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < minSize || h < minSize) return null;
  if (x0 === 0 && y0 === 0 && w === imageW && h === imageH) return null;
  return { x: x0, y: y0, w, h };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** The four corner grab handles of a crop rectangle. */
export type CropHandle = "nw" | "ne" | "sw" | "se";

/** The crop region initialized to cover the whole loaded image. */
export function fullImageRect(imageW: number, imageH: number): CropRect {
  return { x: 0, y: 0, w: imageW, h: imageH };
}

const OPPOSITE: Record<CropHandle, CropHandle> = { nw: "se", ne: "sw", sw: "ne", se: "nw" };

function corners(rect: CropRect): Record<CropHandle, Point> {
  return {
    nw: { x: rect.x, y: rect.y },
    ne: { x: rect.x + rect.w, y: rect.y },
    sw: { x: rect.x, y: rect.y + rect.h },
    se: { x: rect.x + rect.w, y: rect.y + rect.h },
  };
}

/**
 * The corner handle whose center is within Euclidean `hitRadius` of `point`,
 * or null if none qualify. When several corners are within radius (a tiny
 * rect), the nearest one wins.
 */
export function handleAt(point: Point, rect: CropRect, hitRadius: number): CropHandle | null {
  const c = corners(rect);
  let best: CropHandle | null = null;
  let bestDist = hitRadius;
  for (const h of Object.keys(c) as CropHandle[]) {
    const dist = Math.hypot(point.x - c[h].x, point.y - c[h].y);
    if (dist < bestDist) {
      bestDist = dist;
      best = h;
    }
  }
  return best;
}

/**
 * Move the named corner of `rect` to `point`, pinning the diagonally-opposite
 * corner in place. Clamps the moving corner to [0, imageW] x [0, imageH] and
 * enforces `minSize` per axis by clamping (never flipping past the pinned
 * corner). Returns an integer-valued CropRect.
 */
export function applyHandleDrag(
  rect: CropRect,
  handle: CropHandle,
  point: Point,
  imageW: number,
  imageH: number,
  minSize: number,
): CropRect {
  const opposite = corners(rect)[OPPOSITE[handle]];
  const isWest = handle === "nw" || handle === "sw";
  const isNorth = handle === "nw" || handle === "ne";

  let x0: number, x1: number;
  if (isWest) {
    x1 = opposite.x;
    x0 = clamp(point.x, 0, x1 - minSize);
  } else {
    x0 = opposite.x;
    x1 = clamp(point.x, x0 + minSize, imageW);
  }

  let y0: number, y1: number;
  if (isNorth) {
    y1 = opposite.y;
    y0 = clamp(point.y, 0, y1 - minSize);
  } else {
    y0 = opposite.y;
    y1 = clamp(point.y, y0 + minSize, imageH);
  }

  return {
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.round(x1 - x0),
    h: Math.round(y1 - y0),
  };
}
