/**
 * Pure geometry for the select tool's resize handles: handle layout,
 * hit-testing, and per-kind transforms that turn a dragged handle + pointer
 * position into an updated annotation. Mirrors crop.ts's structure — DOM-free,
 * ctx-free (bounds are supplied by the caller via bounds.ts's `boundsOf`) —
 * and deliberately NOT imported by exporter.ts, same import-boundary
 * discipline as crop.ts/hittest.ts. Also owns the rotate knob's layout
 * (`rotateHandleFor`) and the resize-composition anchor point
 * (`anchorPointFor`) — selection-chrome geometry, not core rotation math, so
 * it lives here rather than in the leaf `rotate.ts` (which this module
 * imports `pivotOf`/`rotatePoint` from).
 */
import type {
  Annotation,
  ArrowAnnotation,
  BadgeAnnotation,
  CircleMagnifierAnnotation,
  ImageAnnotation,
  MagnifierAnnotation,
  Point,
  RectAnnotation,
  RectMagnifierAnnotation,
  TextAnnotation,
} from "./model";
import type { Bounds } from "./bounds";
import { pivotOf, rotatePoint, unrotatePoint } from "./rotate";
import {
  type MagnifierSizeLimits,
  magnifierSourceRadius,
  magnifierSourceRect,
  clampZoom,
  clampRectZoomForSource,
  MAGNIFIER_MAX_LENS_FRACTION,
} from "./magnifier";

/** The 8 corner/edge handles used by box-shaped kinds (rect, image). */
export type BoxHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
/** The 2 endpoint handles used by arrow. */
export type ArrowHandle = "from" | "to";
/**
 * The one round handle unique to magnifier: `src-zoom` (drag to change
 * magnification).
 * - Circle: sits on the SOURCE rim (unchanged). Its 4 LENS corners reuse the
 *   existing `BoxHandle` "nw"|"ne"|"sw"|"se" ids — no new ids needed there.
 * - Rect (Addendum I, 2026-08-09 — supersedes D5/§6): relocated to the LENS's
 *   own SE corner, mapping INVERTED (the source is held fixed and the lens
 *   follows, `lens = source * zoom`) — see `applyRectMagnifierResize`'s
 *   `src-zoom` branch. Its 8 SOURCE box handles (ringed by `srcHandleOutset`
 *   — see `resizeHandlesFor`'s magnifier case) reuse the same `BoxHandle` ids
 *   too, all 8 via `boxHandles`. The LENS itself has no box handles anymore.
 *
 * Dragging the source region (rect) or the lens body (either shape) is a
 * body drag, not a handle — see hittest.ts's `magnifierHitPart` and
 * canvas.ts's source-/lens-body drags.
 */
export type MagnifierHandle = "src-zoom";
export type ResizeHandle = BoxHandle | ArrowHandle | MagnifierHandle;

export interface HandleSpec {
  id: ResizeHandle;
  pos: Point;
  // Selection-chrome hint only (drawing lives in canvas.ts): square (default,
  // when absent) for box/corner handles, grip for magnifier's src-zoom —
  // keeping the two handle families visually unmistakable.
  shape?: "square" | "grip";
}

// SE on the source rim — where the CIRCLE's src-zoom handle sits (unchanged
// by Addendum I). The rect's grip moved to the lens's own SE corner instead
// (I5) and is positioned directly from `bounds`, not via this angle.
export const MAGNIFIER_ZOOM_HANDLE_ANGLE = Math.PI / 4;

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
 * `boundsOf`) — except a RECT magnifier's 8 box handles (Addendum I,
 * 2026-08-09), which ring the SOURCE rect instead; see that arm below.
 * `srcHandleOutset` (bitmap px) is REQUIRED so every call site names it
 * explicitly — same "required so TypeScript names every call site"
 * precedent `applyResize`'s `limits`/`canvasSize` set — and is read ONLY by
 * that rect-magnifier arm; every other kind ignores it.
 *
 * Box kinds (rect/image) get all 8 corner+edge handles; text and badge get
 * the 4 corners only; arrow gets its two endpoints, read directly from the
 * annotation (not `bounds`) so each handle keeps its own identity even when
 * `from`/`to` are not already normalized top-left/bottom-right. Highlight
 * returns `[]` — bbox-scaling a freehand polyline would distort the stroke
 * shape unpredictably, so it is resize-exempt (move/delete only).
 *
 * Magnifier: the round `src-zoom` handle is always listed FIRST so it wins
 * exact ties in `nearestHandle` — the source region under it is itself
 * hit-testable (see hittest.ts's `magnifierHitPart`), so an exact tie at the
 * grip's own center must resolve to the grip, not fall through to a corner,
 * a box handle, or the body.
 * - Circle: `src-zoom` on the SOURCE rim (unchanged), then 4 lens corners
 *   only (`cornerHandles`) — center-pinned radius resize has no independent
 *   edge handles to offer.
 * - Rect (Addendum I, 2026-08-09 — supersedes D5/§6): `src-zoom` RELOCATED to
 *   the LENS's own SE corner (`bounds` IS the lens rect for a magnifier, so
 *   no `magnifierLensRect` import is needed here), mapping inverted — see
 *   `applyRectMagnifierResize`'s `src-zoom` branch. The 8 box handles
 *   (`boxHandles`) now ring the SOURCE rect (`magnifierSourceRect(a)`),
 *   inflated by `srcHandleOutset` — an OUTSET RING, not the bare source rect
 *   (at the §G1 floor the source is 8 CSS px across; eight drawn handle
 *   squares on its corners/edges would otherwise cover it completely; see
 *   canvas.ts's `MAGNIFIER_SRC_HANDLE_OUTSET_PX` for the clearance
 *   arithmetic). The LENS itself has no box handles anymore and is not
 *   directly resizable — it only follows the source, `at`-pinned.
 */
export function resizeHandlesFor(a: Annotation, bounds: Bounds, srcHandleOutset: number): HandleSpec[] {
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
    case "magnifier": {
      if (a.shape === "rect") {
        // I5: grip on the LENS's own SE corner — `bounds` IS the lens rect
        // for a magnifier, so no magnifierLensRect import is needed here.
        const grip = { x: bounds.x + bounds.w, y: bounds.y + bounds.h };
        return [
          { id: "src-zoom", pos: grip, shape: "grip" },
          ...boxHandles(inflate(magnifierSourceRect(a), srcHandleOutset)),
        ];
      }
      const sourceRadius = magnifierSourceRadius(a);
      const zoomHandlePos = {
        x: a.from.x + sourceRadius * Math.cos(MAGNIFIER_ZOOM_HANDLE_ANGLE),
        y: a.from.y + sourceRadius * Math.sin(MAGNIFIER_ZOOM_HANDLE_ANGLE),
      };
      return [
        { id: "src-zoom", pos: zoomHandlePos, shape: "grip" },
        ...cornerHandles(bounds),
      ];
    }
  }
}

/** Expand `b` by `amount` on every side (negative shrinks). Module-private — the rect magnifier's source-handle ring (§I2, Addendum I) is the only current caller. */
function inflate(b: Bounds, amount: number): Bounds {
  return { x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 };
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
 * The handle whose center is nearest to `p`, among those within Euclidean
 * `hitRadius`, plus that distance — or `null` if none qualify. The one owner
 * of "which handle did the pointer land on"; `handleAt` (below) and
 * `canvas.ts`'s knob-vs-resize-handle tie-break (TASK-41 round 2) both build
 * on this instead of re-deriving nearest-within-radius themselves.
 */
export function nearestHandle(handles: HandleSpec[], p: Point, hitRadius: number): { id: ResizeHandle; dist: number } | null {
  let best: { id: ResizeHandle; dist: number } | null = null;
  for (const h of handles) {
    const dist = Math.hypot(p.x - h.pos.x, p.y - h.pos.y);
    if (dist < hitRadius && (!best || dist < best.dist)) {
      best = { id: h.id, dist };
    }
  }
  return best;
}

/**
 * The handle whose center is within Euclidean `hitRadius` of `p`, or null if
 * none qualify. When several handles are within radius, the nearest one wins.
 * Same nearest-within-radius pattern as `crop.ts`'s `handleAt`. Thin delegate
 * to `nearestHandle` — one owner of the nearest-within-radius search.
 */
export function handleAt(handles: HandleSpec[], p: Point, hitRadius: number): ResizeHandle | null {
  return nearestHandle(handles, p, hitRadius)?.id ?? null;
}

/**
 * True when a press at `p` should fall through to the rect magnifier's
 * SOURCE-body drag (aiming) rather than resolve to `nearest` (the box handle
 * `nearestHandle` already picked out, if any) — Addendum I §I6, 2026-08-09.
 * With 8 handles now ringing a source whose short half-extent can be as
 * small as `limits.minRectSource` (4 CSS px), the handles' 24 CSS px touch
 * hit discs (`canvas.ts`'s `handleHitRadius`, touch-multiplied) can swallow
 * the source's own fingertip-floored hit square (`hittest.ts`'s
 * `magnifierHitPart`) entirely — without this tie-break the source-body
 * drag would be unreachable on touch at small sizes. Same nearest-wins SHAPE
 * as the knob-vs-handle tie-break `canvas.ts`'s `rotateOrResizeTarget`
 * already applies (TASK-41 round 2): `from` (the source center) competes in
 * the same nearest-wins comparison the handles use, winning ties (`<=`, not
 * `<`).
 *
 * Circle is always `false` — its `src-zoom` grip sits >= 20 CSS px out on
 * the source rim (`MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX`), well clear of the
 * source center, so applying this rule there would change TASK-49-verified
 * behavior for a problem the circle does not have.
 *
 * Two properties are asserted in resize.test.ts, not just trusted: (1) the
 * body core this predicate carves out is never empty, even at the source's
 * floor size; (2) that core is always inside the source's own hit region
 * (`hittest.ts`'s `magnifierHitPart`), so "body wins" never means "deselect".
 */
export function magnifierSourceBodyWins(a: Annotation, p: Point, nearest: { id: ResizeHandle; dist: number } | null): boolean {
  if (a.kind !== "magnifier" || a.shape !== "rect" || nearest === null) return false;
  return Math.hypot(p.x - a.from.x, p.y - a.from.y) <= nearest.dist;
}

/**
 * The rotate knob for `bounds` at `angle`, `offset` bitmap px outside the
 * north edge (in the shape's local frame). Returns the LOCAL position — draw
 * it inside the selection overlay's rotated `save/rotate/restore` transform —
 * and the WORLD position — hit-test it directly against the raw pointer, no
 * transform needed. Draw and hit-test MUST both go through this one function
 * so they can never disagree about where the knob is.
 *
 * Three placements, tried in order, each tested against the inset rect
 * `[margin, canvasSize.w - margin] × [margin, canvasSize.h - margin]` (`margin`
 * keeps the knob's own drawn radius, not just its center point, on-canvas):
 * 1. **"north"** — the knob's natural position, if its WORLD point falls
 *    inside the inset rect.
 *  2. **"south"** — the shape's south edge instead, if THAT falls inside (a
 *    rotated shape near the top of the capture can swing "north" off-canvas).
 * 3. **"clamped"** — neither side fits (a large or heavily rotated shape):
 *    component-wise clamp the NORTH world position into the inset rect, then
 *    recompute `local` by inverse-rotating the clamped world point about the
 *    same pivot. Recomputing `local` here is load-bearing — the connector
 *    line (drawn inside the rotated overlay transform, in local coordinates)
 *    must still point at the actual knob position, and draw/hit-test must
 *    stay derived from this one function.
 */
export function rotateHandleFor(
  bounds: Bounds,
  angle: number,
  offset: number,
  canvasSize: { w: number; h: number },
  margin: number,
): { local: Point; world: Point; placement: "north" | "south" | "clamped" } {
  const pivot = pivotOf(bounds);
  const midX = bounds.x + bounds.w / 2;
  const inset = { x0: margin, y0: margin, x1: canvasSize.w - margin, y1: canvasSize.h - margin };

  const northLocal = { x: midX, y: bounds.y - offset };
  const northWorld = rotatePoint(northLocal, pivot, angle);
  if (withinInset(northWorld, inset)) {
    return { local: northLocal, world: northWorld, placement: "north" };
  }

  const southLocal = { x: midX, y: bounds.y + bounds.h + offset };
  const southWorld = rotatePoint(southLocal, pivot, angle);
  if (withinInset(southWorld, inset)) {
    return { local: southLocal, world: southWorld, placement: "south" };
  }

  const worldClamped = {
    x: clamp(northWorld.x, inset.x0, inset.x1),
    y: clamp(northWorld.y, inset.y0, inset.y1),
  };
  const localClamped = unrotatePoint(worldClamped, pivot, angle);
  return { local: localClamped, world: worldClamped, placement: "clamped" };
}

function withinInset(p: Point, inset: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return p.x >= inset.x0 && p.x <= inset.x1 && p.y >= inset.y0 && p.y <= inset.y1;
}

/** A circle to keep the floating delete button clear of, in the same CSS-px space as `padded`/`stage` below. */
export interface AvoidCircle {
  center: Point;
  radius: number;
}
/** Which corner of the padded selection bbox the delete button ended up anchored to. */
export type DeleteCorner = "ne" | "nw" | "se" | "sw";

/**
 * Pick a corner of the padded selection bbox to anchor the floating delete
 * button to, trying NE first but falling back to NW, SE, then SW if NE would
 * either run off the stage viewport or overlap `avoid` (the magnifier's
 * source disc, already expanded by the caller with touch-hit clearance).
 * Assumes an axis-aligned `padded` box — true for every caller, since this is
 * only consulted for magnifier selections, and magnifiers cannot rotate
 * (`canRotate` excludes "magnifier").
 *
 * The caller (canvas.ts's `positionSelectionControls`) computes its legacy
 * placement (ideal NE + viewport clamp + drop-below fallback) first, and
 * only calls this helper if THAT placement collides with the expanded source
 * disc — so in practice this only ever runs to find an alternative once a
 * real conflict has already been detected.
 *
 * A candidate qualifies iff its button rect lies fully inside the stage
 * viewport AND the nearest point of that rect to `avoid.center` is at least
 * `avoid.radius` away (same nearest-point idiom canvas.ts's `knobTooClose`
 * check uses). The first qualifying candidate, in NE -> NW -> SE -> SW order,
 * wins. Returns `null` if none qualifies — the caller then keeps its legacy
 * placement as a best-effort fallback.
 */
export function deleteButtonCornerFor(
  padded: Bounds,
  btn: { w: number; h: number },
  margin: number,
  stage: { w: number; h: number },
  avoid: AvoidCircle,
): { corner: DeleteCorner; left: number; top: number } | null {
  const topY = padded.y - margin - btn.h;
  const bottomY = padded.y + padded.h + margin;
  const neLeft = padded.x + padded.w + margin;
  const nwLeft = padded.x - margin - btn.w;

  const candidates: { corner: DeleteCorner; left: number; top: number }[] = [
    { corner: "ne", left: neLeft, top: topY },
    { corner: "nw", left: nwLeft, top: topY },
    { corner: "se", left: neLeft, top: bottomY },
    { corner: "sw", left: nwLeft, top: bottomY },
  ];

  for (const c of candidates) {
    const withinStage = c.left >= 0 && c.top >= 0 && c.left + btn.w <= stage.w && c.top + btn.h <= stage.h;
    if (!withinStage) continue;
    const dx = Math.max(c.left - avoid.center.x, 0, avoid.center.x - (c.left + btn.w));
    const dy = Math.max(c.top - avoid.center.y, 0, avoid.center.y - (c.top + btn.h));
    const d = Math.hypot(dx, dy);
    if (d >= avoid.radius) return c;
  }
  return null;
}

/**
 * The point pinned by `handle` — diagonally opposite corner for box (rect/
 * image) and text handles, the fixed (non-dragged) endpoint for arrow, the
 * center for badge/highlight (badge resize never moves `at`; highlight is
 * resize-exempt, so this is never actually exercised in a drag) — in LOCAL
 * coordinates. Its local coordinates are invariant across `applyResize`,
 * which is exactly what lets `canvas.ts`'s rotate-composed resize gesture
 * re-anchor the pinned point back to its pre-drag world position via
 * `rotate.ts`'s `reanchorDelta` (see that function's doc comment for the
 * geometry contract).
 */
export function anchorPointFor(a: Annotation, bounds: Bounds, handle: ResizeHandle): Point {
  switch (a.kind) {
    case "arrow":
      return handle === "from" ? a.to : a.from;
    case "badge":
      return { x: a.at.x, y: a.at.y };
    case "magnifier":
      // Circle: the lens center is invariant under every gesture (lens
      // resize is center-pinned; src-zoom and the source-body drag don't
      // touch `at` at all). Rect (Addendum I, 2026-08-09): now ALSO exact —
      // the 8 box handles moved to the SOURCE rect (I2/I3), so `at` (the
      // lens's own center) is invariant under that gesture too; the grip
      // (I5) holds the source fixed and grows/shrinks the lens about `at`
      // without ever translating it. New global invariant (I3): `at`
      // changes only under a lens-body drag. So this return value is exact
      // for every magnifier gesture, unconditionally.
      return { x: a.at.x, y: a.at.y };
    case "highlight":
      return pivotOf(bounds);
    case "rect":
    case "image":
    case "text": {
      // Same pinned-corner formula resizeBox/applyTextResize already use:
      // the corner NOT in the handle's own direction stays fixed.
      const dir = BOX_HANDLE_DIR[handle as BoxHandle];
      return {
        x: dir.west ? bounds.x + bounds.w : bounds.x,
        y: dir.north ? bounds.y + bounds.h : bounds.y,
      };
    }
  }
}

// ---- per-kind transforms ----------------------------------------------------

/**
 * Apply a resize drag to `original` (the pre-drag annotation), returning a
 * new annotation — never mutates `original`. `bounds` is the pre-drag
 * `boundsOf(original, ctx)`, so repeated calls across a drag (each recomputed
 * from the same fixed `original`/`bounds` pair, never incrementally) stay
 * numerically stable. `handle` must be one produced by `resizeHandlesFor` for
 * this same annotation.
 *
 * `limits` is REQUIRED (Addendum B, 2026-08-02), read only by the magnifier
 * branch — the same "one parameter, one kind reads it, the rest ignore it"
 * precedent `translateAnnotation(a, dx, dy, part)` already sets. Required
 * rather than optional-with-a-default so TypeScript forces the single real
 * call site (`canvas.ts`'s resize branch) to supply it explicitly; a silent
 * default would be exactly the kind of "fallback left behind" this project
 * forbids.
 *
 * `canvasSize` is REQUIRED for the same reason, added alongside the rect
 * magnifier variant (D5): read only by a rect magnifier's box-handle resize,
 * for its per-axis `MAGNIFIER_MAX_LENS_FRACTION` max clamp (the circle branch
 * has no such clamp — its `limits.maxLens` already came from `canvasSize` at
 * the call site, baked into `limits` itself). Every other kind ignores it,
 * same "one parameter, one kind reads it" precedent as `limits`.
 *
 * `srcHandleOutset` is REQUIRED for the same reason (Addendum I, 2026-08-09):
 * bitmap px, read only by a rect magnifier's box-handle resize, to invert the
 * outset ring `resizeHandlesFor` drew the handles on so the pointer sets the
 * SOURCE edge exactly (grabbing a handle without moving is then an exact
 * no-op — see `applyMagnifierBoxResize`'s doc comment). Every other kind
 * ignores it.
 */
export function applyResize(
  original: Annotation,
  bounds: Bounds,
  handle: ResizeHandle,
  pointer: Point,
  shiftKey: boolean,
  limits: MagnifierSizeLimits,
  canvasSize: { w: number; h: number },
  srcHandleOutset: number,
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
    case "magnifier":
      return applyMagnifierResize(original, bounds, handle, pointer, shiftKey, limits, canvasSize, srcHandleOutset);
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

/**
 * magnifier: one orthogonal assignment per handle — every degree of freedom
 * has exactly one control. Three gestures now (the `src-move` handle is
 * gone; dragging `from` is a source-BODY drag, hit-tested by
 * `magnifierHitPart` and applied via `translateAnnotation(a, dx, dy,
 * "source")` in canvas.ts — not a resize handle, so it never reaches this
 * function. `from` still stays UNCLAMPED for that drag, same policy the
 * deleted `src-move` branch used to document here: it is a user-steered edit
 * of an already-committed, undoable annotation, so the app's general "never
 * clamp annotations" policy applies, unlike the *creation* gesture's
 * `magnifierSlideUpdate` (magnifier.ts), which does clamp `from` (review
 * round 2 ruling: a creation gesture must always produce a usable loupe,
 * never a provably-empty one)):
 * - `src-zoom`: a single scalar radial drag from `from` sets `zoom` at fixed
 *   `radius` — a smaller source ring reads as more magnification. `Number.
 *   EPSILON` (not 0) as the hypot floor means a zero-distance drag can never
 *   divide by zero; `clampZoom` absorbs the resulting huge value at its own
 *   ceiling, so there is no separate zero-distance special case.
 * - lens corners (nw/ne/sw/se, via `cornerHandles`): badge-style center-pinned
 *   radius resize at FIXED zoom (more/less of the image at the same
 *   magnification) — `at`/`zoom` never change. `lo` is the one expression
 *   that keeps the derived source circle (`radius / zoom`) from collapsing
 *   below `limits.minSource` as the lens shrinks at a high zoom (Addendum B,
 *   2026-08-02).
 *
 * Rect ("cube mode", D5): dispatched to `applyRectMagnifierResize` before any
 * of the above — a rect magnifier's gestures are a DIFFERENT shape (8 free
 * box handles instead of 4 center-pinned corners, `canvasSize`-aware) even
 * though the underlying "one control per degree of freedom" philosophy is
 * the same. See that function's own doc comment.
 */
function applyMagnifierResize(
  a: MagnifierAnnotation,
  bounds: Bounds,
  handle: ResizeHandle,
  pointer: Point,
  shiftKey: boolean,
  limits: MagnifierSizeLimits,
  canvasSize: { w: number; h: number },
  srcHandleOutset: number,
): MagnifierAnnotation {
  if (a.shape === "rect") {
    return applyRectMagnifierResize(a, bounds, handle, pointer, shiftKey, limits, canvasSize, srcHandleOutset);
  }
  if (handle === "src-zoom") {
    const dist = Math.max(Math.hypot(pointer.x - a.from.x, pointer.y - a.from.y), Number.EPSILON);
    return { ...a, zoom: clampZoom(a.radius / dist, a, limits) };
  }
  // Only the 4 lens corners (nw/ne/sw/se, via cornerHandles) remain —
  // resizeHandlesFor never returns any other id for a circle magnifier.
  return applyMagnifierCornerResize(a, pointer, limits);
}

/** magnifier lens corner (nw/ne/sw/se): badge-style center-pinned radius resize at FIXED zoom — see applyMagnifierResize's doc comment for the `lo` floor's rationale. */
function applyMagnifierCornerResize(a: CircleMagnifierAnnotation, pointer: Point, limits: MagnifierSizeLimits): CircleMagnifierAnnotation {
  const lo = Math.max(limits.minLens, a.zoom * limits.minSource);
  const radius = clamp(Math.max(Math.abs(pointer.x - a.at.x), Math.abs(pointer.y - a.at.y)), lo, limits.maxLens);
  return { ...a, radius };
}

/**
 * rect ("cube mode"): src-zoom and 8 SOURCE box handles, two DIFFERENT
 * gestures dispatched here, mirroring `applyMagnifierResize`'s own top-level
 * dispatch structure for the circle:
 * - `src-zoom` (Addendum I, 2026-08-09, §I5 — supersedes D5/§6's lens-corner
 *   mapping): RELOCATED to the LENS's own SE corner, mapping INVERTED — the
 *   SOURCE is held fixed and the LENS follows (`lens = source * zoom`).
 *   `srcHalfDiag = hypot(src.w, src.h)/2` (the source rect's own
 *   half-diagonal) stands in for the circle's `radius` term; `dist` is now
 *   measured from `a.at` (the lens center, where the grip now sits), not
 *   `a.from`. `from` never changes — only `zoom`, `width`, `height`. Same
 *   `Number.EPSILON` floor as the circle branch, same reason (a
 *   zero-distance drag must not divide by zero; `clampRectZoomForSource`
 *   absorbs the resulting huge value at its own ceiling).
 * - the 8 SOURCE box handles (`boxHandles`, ringed by `srcHandleOutset`): see
 *   `applyMagnifierBoxResize`'s own doc comment (rewritten by Addendum I,
 *   2026-08-09, re-basing Addendum D §D9/§D10's clamp units onto the
 *   source — those two rulings survive verbatim, just re-expressed) for the
 *   current min/max clamp and aspect-lock behavior.
 */
function applyRectMagnifierResize(
  a: RectMagnifierAnnotation,
  bounds: Bounds,
  handle: ResizeHandle,
  pointer: Point,
  shiftKey: boolean,
  limits: MagnifierSizeLimits,
  canvasSize: { w: number; h: number },
  srcHandleOutset: number,
): RectMagnifierAnnotation {
  if (handle === "src-zoom") {
    // Grabbing the grip without moving must be an exact (bit-identical)
    // no-op. `zoom` reconstructed via `dist/srcHalfDiag` is NOT reliably
    // bit-exact even at zero motion — `dist` and `srcHalfDiag` each go
    // through their own `Math.hypot`, and `hypot(w/2,h/2)` is not always
    // bit-identical to `hypot(w,h)/2` — so comparing the reconstructed zoom
    // to `a.zoom` would miss most real no-op grabs. Detect "didn't move"
    // directly instead, the same mechanism `applyMagnifierBoxResize` uses for
    // its own handles: recompute the grip's position with the EXACT SAME
    // arithmetic `resizeHandlesFor` used to draw it (`bounds.x + bounds.w`,
    // `bounds.y + bounds.h` — `bounds` IS the lens rect for a magnifier, see
    // bounds.ts) over the SAME `bounds` this function already received as a
    // parameter, so it is bit-identical by construction, not merely
    // algebraically equivalent to some other expression of the same point
    // (e.g. `at.x + width/2`, which measurably drifts by 1 ulp on a fraction
    // of real fixtures). A pointer landing exactly there short-circuits to
    // `a` itself: trivially bit-identical zoom/width/height.
    if (pointer.x === bounds.x + bounds.w && pointer.y === bounds.y + bounds.h) return a;

    const src = magnifierSourceRect(a);
    const srcHalfDiag = Math.max(Math.hypot(src.w, src.h) / 2, Number.EPSILON);
    const dist = Math.hypot(pointer.x - a.at.x, pointer.y - a.at.y);
    const zoom = clampRectZoomForSource(dist / srcHalfDiag, src.w, src.h, canvasSize, limits);
    return { ...a, zoom, width: src.w * zoom, height: src.h * zoom };
  }
  // Only the 8 SOURCE box handles (via boxHandles, ringed at srcHandleOutset)
  // remain — resizeHandlesFor never returns any other id for a rect magnifier.
  return applyMagnifierBoxResize(a, bounds, handle as BoxHandle, pointer, shiftKey, limits, canvasSize, srcHandleOutset);
}

/**
 * rect magnifier box handle (nw/n/ne/e/se/s/sw/w) — REBASED onto the SOURCE
 * by Addendum I (2026-08-09, user decision after live use of D5/§6's cube
 * mode): the 8 handles now resize the SOURCE rect, `zoom` stays FIXED for
 * the whole drag, and the LENS follows exactly as `source * zoom`. This
 * supersedes §5's handle list/box-drag semantics; §D9/§D10's rulings
 * (Addendum D, 2026-08-08, reviewer nits N1/N2) survive VERBATIM, just
 * re-expressed in source units below — see those two headers for what
 * changed and why (unchanged by this addendum).
 *
 * **`_bounds` is intentionally unused — NOT the resized box for this handle
 * family.** Every other box-shaped kind (rect/image/text, and this same
 * function pre-Addendum-I) resizes the box `applyResize`'s caller passed in
 * as `bounds`. This gesture is the one exception: the box being resized is
 * `magnifierSourceRect(a)` — the LENS's pre-drag `bounds` is not read at
 * all. The parameter is kept (named with a leading underscore to satisfy
 * `noUnusedParameters`) only for signature symmetry with
 * `applyRectMagnifierResize`'s other branch and the rest of this file's
 * per-kind resize functions.
 *
 * **I2: exactness via a pointer-identity short-circuit (reviewer round 3,
 * 2026-08-09).** Grabbing a handle without moving must be an exact,
 * bit-identical no-op — the SAME guarantee the `src-zoom` grip branch makes,
 * via the SAME mechanism. An earlier version tried to reconstruct this by
 * deflating the pointer (inverting the ring's `inflate`) and trusting
 * `resizeBox`'s reconstructed `w`/`h` to land back on `src.w`/`src.h`
 * bit-exactly; that is NOT reliable on production-shaped geometry (measured:
 * the deflation itself, `(x +/- outset) -/+ outset`, drifts in ~63% of
 * sampled cases, and `resizeBox`'s own edge-difference reconstruction,
 * `(src.y + src.h) - src.y`, drifts in ~98% — a fixture like `257x97, zoom
 * 3.3, from(200.5, 200.25)` fails on every one of its 8 handles). Fix:
 * recompute this handle's own RING position with the EXACT SAME call
 * `resizeHandlesFor` uses (`boxHandles(inflate(magnifierSourceRect(a),
 * srcHandleOutset))`) — deterministic IEEE ops over identical inputs are
 * bit-identical to what was drawn — and short-circuit to `a` itself on an
 * exact pointer match, before any deflation/`resizeBox` math runs at all.
 * Everything below this check only executes for a genuine drag. One
 * consequence worth being explicit about: an exact-position, zero-motion
 * grab of a SOURCE that is currently out of range (e.g. a pre-existing
 * annotation below `minRectSource`) does NOT get snapped into range by that
 * grab — §D10/TASK-48 AC#6's "first size-affecting edit" clamp is DEFERRED
 * to the first frame with actual motion, not skipped; it fires normally the
 * instant the pointer moves off the handle's exact position.
 *
 * **I3: pinning.** The dragged SOURCE edge/corner follows the (deflated)
 * pointer; the diagonally opposite SOURCE corner is pinned (`from` moves).
 * `at` (the lens center) is FIXED — the lens grows/shrinks about its own
 * centre, never translates. This is the new global invariant (I3): `at`
 * changes only under a lens-body drag.
 *
 * **I4: clamps, re-expressed in source units — §D9/§D10 survive verbatim.**
 * `minSrcPx = 2 * max(limits.minLens / a.zoom, limits.minRectSource)` is the
 * pre-Addendum-I `minPx` (`2 * max(limits.minLens, a.zoom * limits.minRectSource)`)
 * divided through by `a.zoom` — no epsilon guard needed, `a.zoom >=
 * MIN_MAGNIFIER_ZOOM` always. `maxSrcW`/`maxSrcH` are likewise the old
 * `maxW`/`maxH` divided by `zoom`. **§D9** (Shift aspect-lock surviving a
 * tripped cap): unchanged in form, now scaling the SOURCE box uniformly by
 * `s = min(1, maxSrcW/w, maxSrcH/h)` — Shift locks the source's pre-drag
 * aspect, which IS the lens's aspect (`lens = source * zoom`, a uniform
 * scalar). **§D10** (TASK-48 AC#6 — both axes always re-checked, not just
 * the dragged one; the untouched axis re-centers on its pre-drag center):
 * unchanged in form, now re-centering on `box`'s own pre-drag SOURCE center
 * (which is `a.from`'s coordinate on that axis, since `resizeBox` never
 * moves an untouched axis's edges). `loW`/`loH = min(minSrcPx, maxSrcW/H)` —
 * same "hi wins" discipline. `minRectSource` (Addendum G, 2026-08-08 — a
 * LEGIBILITY floor, not the circle's fingertip one, see
 * `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX`'s own doc comment) is now enforced
 * ONLY here — the new grip (I5) holds the source fixed and cannot enforce it.
 *
 * `zoom` never changes on this gesture (I1: the box handles solve for a new
 * SOURCE, then write `width = srcW * zoom`, `height = srcH * zoom` — the
 * model keeps LENS dims, only the gesture is re-based) — same "one control
 * per degree of freedom" discipline the circle's `applyMagnifierCornerResize`
 * documents for its own corner drag.
 */
function applyMagnifierBoxResize(
  a: RectMagnifierAnnotation,
  _bounds: Bounds,
  handle: BoxHandle,
  pointer: Point,
  shiftKey: boolean,
  limits: MagnifierSizeLimits,
  canvasSize: { w: number; h: number },
  srcHandleOutset: number,
): RectMagnifierAnnotation {
  const src = magnifierSourceRect(a);
  const dir = BOX_HANDLE_DIR[handle];
  const isCorner = (dir.west || dir.east) && (dir.north || dir.south);

  // I2: bit-exact no-op short-circuit — see this function's doc comment for
  // why a deflate-then-resizeBox reconstruction can't be trusted to land
  // back on `src.w`/`src.h` exactly. `boxHandles`/`inflate` are the exact
  // same two functions (same argument order, same arithmetic) `resizeHandlesFor`
  // calls to draw this same ring, so this recomputes a bit-identical position.
  const ringHandle = boxHandles(inflate(src, srcHandleOutset)).find((h) => h.id === handle)!;
  if (pointer.x === ringHandle.pos.x && pointer.y === ringHandle.pos.y) return a;

  // I2: invert the ring outset so the pointer sets the SOURCE edge exactly.
  const p = {
    x: dir.east ? pointer.x - srcHandleOutset : dir.west ? pointer.x + srcHandleOutset : pointer.x,
    y: dir.south ? pointer.y - srcHandleOutset : dir.north ? pointer.y + srcHandleOutset : pointer.y,
  };

  // I4: the §D9/§D10 bounds, divided by zoom (a lens floor seen through the
  // zoom vs. the source's own legibility floor, §G1 — different natures).
  const minSrcPx = 2 * Math.max(limits.minLens / a.zoom, limits.minRectSource);
  const maxSrcW = (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.w) / a.zoom;
  const maxSrcH = (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / a.zoom;
  // "hi wins" — same clamp discipline magnifierSizeLimits documents for its
  // own bounds: on a degenerate canvas the cap beats the legibility floor.
  const loW = Math.min(minSrcPx, maxSrcW);
  const loH = Math.min(minSrcPx, maxSrcH);

  const box = resizeBox(src, handle, p, minSrcPx, shiftKey);
  let w = box.w;
  let h = box.h;
  if (shiftKey && isCorner) {
    // D9: resizeBox already produced an aspect-locked box; a per-axis
    // pull-back would silently break that ratio, so a tripped cap scales
    // BOTH axes uniformly instead.
    const s = Math.min(1, maxSrcW / w, maxSrcH / h);
    if (s < 1) {
      w *= s;
      h *= s;
    }
  }
  // D10/TASK-48 #6: clamp BOTH axes, not just the dragged one. On the
  // aspect-locked path above this is a no-op except in the documented
  // floor-vs-cap conflict regime, where the floor wins and the ratio is lost.
  w = clamp(w, loW, maxSrcW);
  h = clamp(h, loH, maxSrcH);

  // Anchoring: an edge the handle moved keeps its opposite edge pinned; an
  // axis the handle never touched is re-centered on its pre-drag SOURCE
  // center (== a.from on that axis, since `src` is the pre-drag source rect
  // and resizeBox never moves an edge on an axis the handle doesn't touch).
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x0 = dir.west ? box.x + box.w - w : dir.east ? box.x : cx - w / 2;
  const y0 = dir.north ? box.y + box.h - h : dir.south ? box.y : cy - h / 2;
  // I1/I3: writes `from` (the source moved), never `at` (the lens center is
  // fixed); width/height are the LENS's full dims, `source * zoom`. No
  // special-casing needed here for the no-op case — the pointer-identity
  // short-circuit above already returns `a` itself before any of this math
  // runs, so `w`/`h` reaching this point always reflect a genuine drag.
  return {
    ...a,
    from: { x: x0 + w / 2, y: y0 + h / 2 },
    width: w * a.zoom,
    height: h * a.zoom,
  };
}
