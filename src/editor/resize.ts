/**
 * Pure geometry for the select tool's resize handles: handle layout,
 * hit-testing, and per-kind transforms that turn a dragged handle + pointer
 * position into an updated annotation. Mirrors crop.ts's structure — DOM-free,
 * ctx-free (bounds are supplied by the caller via hittest.ts's `boundsOf`) —
 * and deliberately NOT imported by exporter.ts, same import-boundary
 * discipline as crop.ts/hittest.ts.
 */
import type {
  Annotation,
  ArrowAnnotation,
  BadgeAnnotation,
  ImageAnnotation,
  Point,
  RectAnnotation,
  TextAnnotation,
} from "./model";
import type { Bounds } from "./hittest";

/** The 8 corner/edge handles used by box-shaped kinds (rect, image). */
export type BoxHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
/** The 2 endpoint handles used by arrow. */
export type ArrowHandle = "from" | "to";
export type ResizeHandle = BoxHandle | ArrowHandle;

export interface HandleSpec {
  id: ResizeHandle;
  pos: Point;
}

/** Minimum rect size per axis, in bitmap px. */
export const MIN_RECT_PX = 8;
/** Minimum image size per axis, in bitmap px. */
export const MIN_IMAGE_PX = 16;
/** Minimum arrow length (distance between from/to), in bitmap px. */
export const MIN_ARROW_LEN = 4;
/** Text resize fontSize clamp range. */
export const MIN_TEXT_FONT_SIZE = 8;
export const MAX_TEXT_FONT_SIZE = 400;
/** Badge resize radius clamp range. */
export const MIN_BADGE_RADIUS = 8;
export const MAX_BADGE_RADIUS = 400;

// ---- handle layout + hit-testing -------------------------------------------

/**
 * The resize handles for `a`, positioned from `bounds` (as returned by
 * `boundsOf`). Box kinds (rect/image) get all 8 corner+edge handles; text and
 * badge get the 4 corners only; arrow gets its two endpoints, read directly
 * from the annotation (not `bounds`) so each handle keeps its own identity
 * even when `from`/`to` are not already normalized top-left/bottom-right.
 * Highlight returns `[]` — bbox-scaling a freehand polyline would distort the
 * stroke shape unpredictably, so it is resize-exempt (move/delete only).
 */
export function resizeHandlesFor(a: Annotation, bounds: Bounds): HandleSpec[] {
  switch (a.kind) {
    case "arrow":
      return [
        { id: "from", pos: a.from },
        { id: "to", pos: a.to },
      ];
    case "rect":
    case "image":
      return boxHandles(bounds);
    case "text":
    case "badge":
      return cornerHandles(bounds);
    case "highlight":
      return [];
  }
}

function cornerHandles(b: Bounds): HandleSpec[] {
  return [
    { id: "nw", pos: { x: b.x, y: b.y } },
    { id: "ne", pos: { x: b.x + b.w, y: b.y } },
    { id: "sw", pos: { x: b.x, y: b.y + b.h } },
    { id: "se", pos: { x: b.x + b.w, y: b.y + b.h } },
  ];
}

function boxHandles(b: Bounds): HandleSpec[] {
  return [
    ...cornerHandles(b),
    { id: "n", pos: { x: b.x + b.w / 2, y: b.y } },
    { id: "e", pos: { x: b.x + b.w, y: b.y + b.h / 2 } },
    { id: "s", pos: { x: b.x + b.w / 2, y: b.y + b.h } },
    { id: "w", pos: { x: b.x, y: b.y + b.h / 2 } },
  ];
}

/**
 * The handle whose center is within Euclidean `hitRadius` of `p`, or null if
 * none qualify. When several handles are within radius, the nearest one wins.
 * Same nearest-within-radius pattern as `crop.ts`'s `handleAt`.
 */
export function handleAt(handles: HandleSpec[], p: Point, hitRadius: number): ResizeHandle | null {
  let best: ResizeHandle | null = null;
  let bestDist = hitRadius;
  for (const h of handles) {
    const dist = Math.hypot(p.x - h.pos.x, p.y - h.pos.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = h.id;
    }
  }
  return best;
}

// ---- per-kind transforms ----------------------------------------------------

/**
 * Apply a resize drag to `original` (the pre-drag annotation), returning a
 * new annotation — never mutates `original`. `bounds` is the pre-drag
 * `boundsOf(original, ctx)`, so repeated calls across a drag (each recomputed
 * from the same fixed `original`/`bounds` pair, never incrementally) stay
 * numerically stable. `handle` must be one produced by `resizeHandlesFor` for
 * this same annotation.
 */
export function applyResize(
  original: Annotation,
  bounds: Bounds,
  handle: ResizeHandle,
  pointer: Point,
  shiftKey: boolean,
): Annotation {
  switch (original.kind) {
    case "rect":
      return applyRectResize(original, bounds, handle as BoxHandle, shiftKey, pointer);
    case "image":
      return applyImageResize(original, bounds, handle as BoxHandle, shiftKey, pointer);
    case "arrow":
      return applyArrowResize(original, handle as ArrowHandle, pointer, shiftKey);
    case "text":
      return applyTextResize(original, bounds, handle as BoxHandle, pointer);
    case "badge":
      return applyBadgeResize(original, pointer);
    case "highlight":
      return original;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

interface HandleDir {
  west: boolean;
  east: boolean;
  north: boolean;
  south: boolean;
}

const BOX_HANDLE_DIR: Record<BoxHandle, HandleDir> = {
  nw: { west: true, east: false, north: true, south: false },
  n: { west: false, east: false, north: true, south: false },
  ne: { west: false, east: true, north: true, south: false },
  e: { west: false, east: true, north: false, south: false },
  se: { west: false, east: true, north: false, south: true },
  s: { west: false, east: false, north: false, south: true },
  sw: { west: true, east: false, north: false, south: true },
  w: { west: true, east: false, north: false, south: false },
};

/**
 * Shared box-resize math for rect/image: moves the edge(s) implied by
 * `handle`, pinning the opposite edge(s)/corner. Corner handles move both
 * axes (free, independent per-axis clamp — "pins the diagonally opposite
 * corner"); edge handles move only their one axis. When `aspectLocked` and
 * `handle` is a corner, the pre-drag aspect ratio (`bounds.w / bounds.h`) is
 * preserved instead: the dominant axis of pointer movement (relative to the
 * pinned opposite corner) drives a uniform scale of both dimensions. Never
 * flips past the pinned edge/corner; always at least `minPx` per axis.
 */
function resizeBox(bounds: Bounds, handle: BoxHandle, pointer: Point, minPx: number, aspectLocked: boolean): Bounds {
  const dir = BOX_HANDLE_DIR[handle];
  const isCorner = (dir.west || dir.east) && (dir.north || dir.south);

  let x0 = bounds.x;
  let x1 = bounds.x + bounds.w;
  let y0 = bounds.y;
  let y1 = bounds.y + bounds.h;

  if (isCorner && aspectLocked) {
    const anchorX = dir.west ? x1 : x0;
    const anchorY = dir.north ? y1 : y0;
    const origW = bounds.w;
    const origH = bounds.h;
    const safeW = origW || 1;
    const safeH = origH || 1;
    // Signed distance from the anchor in the handle's own direction, floored
    // at 0: a pointer that has crossed back past the anchor (dragged the
    // opposite way) must shrink toward minPx, never grow the box the wrong way.
    const rawDx = Math.max(0, dir.west ? anchorX - pointer.x : pointer.x - anchorX);
    const rawDy = Math.max(0, dir.north ? anchorY - pointer.y : pointer.y - anchorY);
    const scale = Math.max(rawDx / safeW, rawDy / safeH, minPx / safeW, minPx / safeH);
    const newW = origW * scale;
    const newH = origH * scale;
    if (dir.west) x0 = anchorX - newW;
    else x1 = anchorX + newW;
    if (dir.north) y0 = anchorY - newH;
    else y1 = anchorY + newH;
  } else {
    if (dir.west) x0 = Math.min(pointer.x, x1 - minPx);
    else if (dir.east) x1 = Math.max(pointer.x, x0 + minPx);
    if (dir.north) y0 = Math.min(pointer.y, y1 - minPx);
    else if (dir.south) y1 = Math.max(pointer.y, y0 + minPx);
  }

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** rect: free corner/edge resize by default; Shift on a corner locks the pre-drag aspect ratio. */
function applyRectResize(
  a: RectAnnotation,
  bounds: Bounds,
  handle: BoxHandle,
  shiftKey: boolean,
  pointer: Point,
): RectAnnotation {
  const box = resizeBox(bounds, handle, pointer, MIN_RECT_PX, shiftKey);
  return { ...a, a: { x: box.x, y: box.y }, b: { x: box.x + box.w, y: box.y + box.h } };
}

/** image: corner resize is aspect-locked by default; Shift frees it. */
function applyImageResize(
  a: ImageAnnotation,
  bounds: Bounds,
  handle: BoxHandle,
  shiftKey: boolean,
  pointer: Point,
): ImageAnnotation {
  const box = resizeBox(bounds, handle, pointer, MIN_IMAGE_PX, !shiftKey);
  return { ...a, at: { x: box.x, y: box.y }, width: box.w, height: box.h };
}

/**
 * arrow: the dragged endpoint (`handle`) follows the pointer; the other
 * endpoint stays fixed. Shift snaps the dragged endpoint's angle relative to
 * the fixed endpoint to 45° increments (magnitude unchanged). Updates that
 * would bring the endpoints closer than `MIN_ARROW_LEN` are clamped along the
 * same direction; if the pointer lands exactly on the fixed endpoint (no
 * direction to clamp along), the update is rejected and the dragged endpoint
 * stays at its pre-drag position.
 */
function applyArrowResize(a: ArrowAnnotation, handle: ArrowHandle, pointer: Point, shiftKey: boolean): ArrowAnnotation {
  const fixed = handle === "from" ? a.to : a.from;
  let target = shiftKey ? snapAngle45(fixed, pointer) : pointer;

  const dist = Math.hypot(target.x - fixed.x, target.y - fixed.y);
  if (dist < MIN_ARROW_LEN) {
    if (dist === 0) {
      target = handle === "from" ? a.from : a.to;
    } else {
      const scale = MIN_ARROW_LEN / dist;
      target = { x: fixed.x + (target.x - fixed.x) * scale, y: fixed.y + (target.y - fixed.y) * scale };
    }
  }

  return handle === "from" ? { ...a, from: target } : { ...a, to: target };
}

/** Snap the direction from `fixed` to `p` to the nearest 45° increment, keeping the distance unchanged. */
function snapAngle45(fixed: Point, p: Point): Point {
  const dx = p.x - fixed.x;
  const dy = p.y - fixed.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return p;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: fixed.x + dist * Math.cos(angle), y: fixed.y + dist * Math.sin(angle) };
}

/**
 * text: uniform scale driven by the vertical distance from the pinned
 * (diagonally opposite) corner, applied to `fontSize` (clamped, then the
 * effective scale is recomputed from the clamped value so `at` repositions
 * consistently with the actual rendered size). Shift is ignored — text has no
 * free-aspect concept distinct from its single `fontSize` scalar.
 */
function applyTextResize(a: TextAnnotation, bounds: Bounds, handle: BoxHandle, pointer: Point): TextAnnotation {
  const dir = BOX_HANDLE_DIR[handle];
  const pinnedX = dir.west ? bounds.x + bounds.w : bounds.x;
  const pinnedY = dir.north ? bounds.y + bounds.h : bounds.y;

  // Signed distance from the pinned corner in the handle's own (outward)
  // direction, floored at 0 — same approach as resizeBox's aspect-locked
  // branch. A plain Math.abs() would make fontSize grow again once the
  // pointer crosses back past the pinned corner instead of staying clamped
  // at the minimum.
  const outwardY = Math.max(0, dir.north ? pinnedY - pointer.y : pointer.y - pinnedY);
  const scale = bounds.h === 0 ? 1 : outwardY / bounds.h;
  const fontSize = clamp(Math.round(a.fontSize * scale), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
  const effScale = a.fontSize === 0 ? scale : fontSize / a.fontSize;
  const width = bounds.w * effScale;
  const height = bounds.h * effScale;

  const atX = dir.west ? pinnedX - width : pinnedX;
  const atY = dir.north ? pinnedY - height : pinnedY;
  return { ...a, fontSize, at: { x: atX, y: atY } };
}

/** badge: radius tracks the pointer's max axis distance from the fixed center; center/number never change. */
function applyBadgeResize(a: BadgeAnnotation, pointer: Point): BadgeAnnotation {
  const radius = clamp(
    Math.max(Math.abs(pointer.x - a.at.x), Math.abs(pointer.y - a.at.y)),
    MIN_BADGE_RADIUS,
    MAX_BADGE_RADIUS,
  );
  return { ...a, radius };
}
