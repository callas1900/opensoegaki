/**
 * Pure geometry for the in-editor crop tool: normalizes a pointer drag into
 * an integer-pixel crop rectangle clamped to the image bounds. DOM-free, no
 * canvas usage — deliberately NOT imported by exporter.ts (crop chrome is
 * live-canvas-only, same import-boundary discipline as hittest.ts).
 *
 * TASK-52 extends this file with "frame space" geometry for in-crop
 * rotation (design note docs/design/2026-08-19-crop-canvas-rotation.md,
 * sections D0/D3): the live canvas grows into a rotated/scaled preview
 * frame while crop mode is active, the crop region is stored as a
 * normalized rect against the frame's inscribed (axis-aligned, rotation-
 * safe) bounds, and handles now clamp to those bounds instead of the raw
 * image. This file stays the single owner of that math — canvas.ts only
 * calls into it, never re-derives it.
 *
 * `tiltFromDrag` reuses `rotate.ts`'s `pointerAngle`/`ROTATION_SNAP_RAD`/
 * `normalizeAngle`, so this file has a real (value-level) dependency on
 * rotate.ts. The reverse is never true: rotate.ts stays a leaf (model.ts +
 * bounds.ts only) and never imports this file, so there is no cycle —
 * `documentRotation`'s `outRect` parameter (rotate.ts) is typed as
 * bounds.ts's `Bounds`, which is structurally identical to `CropRect` below,
 * precisely so rotate.ts never needs to import this module.
 */
import type { Point } from "./model";
import { normalizeAngle, pointerAngle, ROTATION_SNAP_RAD, rotatedBBox as rotatedBBoxImpl } from "./rotate";

/** Drags smaller than this (in either dimension) are treated as "no crop". */
export const MIN_CROP_PX = 8;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Free-rotation ("tilt") clamp: +/-45 degrees. Promoting a tilt past 45
 * degrees into a quarter turn would require resizing the frame mid-drag,
 * which would stale the drag's pivot and start pointer and make the angle
 * jump (D0) — so 45 degrees is a hard ceiling, not a UX nicety. Beyond it,
 * the user composes a quarter turn with a smaller tilt instead.
 */
export const MAX_TILT_RAD = Math.PI / 4;

/**
 * Deadband around zero for the total crop-preview rotation (design-note
 * addendum, 2026-08-19; reviewer F8 on TASK-52). `cropAngle() === 0` used to
 * be an exact equality test, so a single-pixel jiggle on the rotate band
 * (which the user never experienced as a rotation) could leave `tilt` at a
 * residual of ~1e-7 rad — enough to fail the exact test, sending an
 * "untouched" apply down the full resample-plus-inscribed-crop path instead
 * of the pure-crop no-op guard (TASK-40 AC#3). `0.1deg = PI/1800` is well
 * under both the 15-degree Shift-snap increment and anything a real tilt
 * drag would produce, so it only ever absorbs jiggle, never an intentional
 * tilt. Applies ONLY to the "what's the effective total angle for the
 * zero-test/apply" computation (`canvas.ts`'s `cropAngle()`) — the live
 * preview's `tilt` value itself, and the transform `cropFrame()` builds from
 * it, are read raw and are NEVER snapped by this constant, so the on-screen
 * preview always reflects the pointer exactly.
 */
export const TILT_DEADBAND_RAD = Math.PI / 1800;

/**
 * Inset (frame px) applied to the inscribed rect when the total rotation is
 * NOT an exact multiple of 90 degrees, so an anti-aliased edge pixel of the
 * tilted image can never land inside the crop output (AC#4, "no transparent
 * pixel"). At an exact quarter turn the rotated image is pixel-aligned —
 * there is no anti-aliased edge — and the inset MUST be 0, otherwise an
 * untouched region would sit 1px inside the image and TASK-40 AC#3 (no
 * history step on an untouched apply) would break. See `cropFrameFor`.
 */
export const INSCRIBED_INSET_PX = 1;

/**
 * A crop region expressed as a ratio of the inscribed bounds, each field in
 * [0,1]. This — not a pixel rect — is the source of truth for the crop
 * region while crop mode is active (D0/D3): the pixel rect is always
 * re-derived from `norm` via `denormalizeRect`, because storing integer
 * pixels and re-deriving `norm` on every angle change would drift (tilting
 * out and back would return a thinner region).
 */
export interface NormRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * The whole inscribed rect, as a `NormRect`. Fixed point of `rotateNormRect`
 * in both directions. `Object.freeze`d (non-blocking fixup, reviewer on
 * TASK-52): `canvas.ts` writes this module-level object directly into
 * `crop.norm` at two sites (`initCrop`, `setQuarter`'s `!touched` branch) —
 * without a copy or a freeze, a later in-place mutation of `crop.norm` (were
 * one ever added) would corrupt this shared constant for every crop session
 * that follows. Frozen here as the belt; callers additionally spread a copy
 * (`{ ...FULL_NORM }`) as the suspenders, so live crop state can never alias
 * this object even indirectly.
 */
export const FULL_NORM: NormRect = Object.freeze({ u0: 0, v0: 0, u1: 1, v1: 1 });

/**
 * Normalize a drag between two points (in either direction) into an
 * integer-pixel crop rectangle clamped to `bounds`. Returns null for a
 * rectangle smaller than `minSize` in either dimension, or for a rectangle
 * that covers the whole of `bounds` exactly (a no-op crop that should not
 * push an undo step).
 *
 * `bounds` used to be the fixed `[0, imageW] x [0, imageH]` image rect; it is
 * now the caller-supplied inscribed rect (TASK-52 D0/D3) so a rotated/tilted
 * preview clamps handles to what's actually visible instead of the raw
 * image. Passing `fullImageRect(imageW, imageH)` reproduces the old,
 * unrotated behavior exactly.
 *
 * The "covers the whole of `bounds`" test is EXACT equality against
 * `bounds`' own fields — the same shape this function shipped with pre-
 * TASK-52 (`x0 === 0 && y0 === 0 && w === imageW && h === imageH`),
 * generalized to an arbitrary `bounds` rect. Reviewer B2 on TASK-52: a
 * reviewer round (F5) had briefly widened this to a 1px tolerance to paper
 * over a *different* bug — `applyCrop` was feeding this function a `bounds`
 * shrunk by a tilt residual that should have deadbanded to exactly 0 — but
 * the tolerance was the wrong fix: it silently discarded a genuine <=1px
 * trim, contradicting `applyCrop`'s "byte-identical to the shipped path"
 * claim for the untouched case. The real bug is fixed at its source
 * (`applyCrop` now builds `bounds` from the deadbanded `cropAngle()`, so at
 * `angle === 0` the inset is exactly 0 and `bounds` is exactly the full
 * image, integer, origin `(0,0)` — see `applyCrop`'s own comment), so exact
 * equality here is safe again: this function's one caller
 * (`applyCrop`'s `fullImageRect(src.width, src.height)`) always passes an
 * integer, origin-0 `bounds`.
 */
export function computeCrop(a: Point, b: Point, bounds: CropRect, minSize: number): CropRect | null {
  const boundsX1 = bounds.x + bounds.w;
  const boundsY1 = bounds.y + bounds.h;
  const x0 = Math.round(clamp(Math.min(a.x, b.x), bounds.x, boundsX1));
  const y0 = Math.round(clamp(Math.min(a.y, b.y), bounds.y, boundsY1));
  const x1 = Math.round(clamp(Math.max(a.x, b.x), bounds.x, boundsX1));
  const y1 = Math.round(clamp(Math.max(a.y, b.y), bounds.y, boundsY1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < minSize || h < minSize) return null;
  if (x0 === bounds.x && y0 === bounds.y && w === bounds.w && h === bounds.h) return null;
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
 * corner in place. Clamps the moving corner to `bounds` and enforces
 * `minSize` per axis by clamping (never flipping past the pinned corner).
 * Returns an integer-valued CropRect.
 *
 * `bounds` replaces the old fixed `[0, imageW] x [0, imageH]` clamp (TASK-52
 * D0) — see `computeCrop`'s doc comment for why.
 */
export function applyHandleDrag(
  rect: CropRect,
  handle: CropHandle,
  point: Point,
  bounds: CropRect,
  minSize: number,
): CropRect {
  const opposite = corners(rect)[OPPOSITE[handle]];
  const isWest = handle === "nw" || handle === "sw";
  const isNorth = handle === "nw" || handle === "ne";
  const boundsX0 = bounds.x;
  const boundsX1 = bounds.x + bounds.w;
  const boundsY0 = bounds.y;
  const boundsY1 = bounds.y + bounds.h;

  let x0: number, x1: number;
  if (isWest) {
    x1 = opposite.x;
    x0 = clamp(point.x, boundsX0, x1 - minSize);
  } else {
    x0 = opposite.x;
    x1 = clamp(point.x, x0 + minSize, boundsX1);
  }

  let y0: number, y1: number;
  if (isNorth) {
    y1 = opposite.y;
    y0 = clamp(point.y, boundsY0, y1 - minSize);
  } else {
    y0 = opposite.y;
    y1 = clamp(point.y, y0 + minSize, boundsY1);
  }

  return {
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.round(x1 - x0),
    h: Math.round(y1 - y0),
  };
}

/**
 * Axis-aligned bounding box of a `w x h` rectangle rotated by `angle`
 * (radians) about its own center. Delegates to `rotate.ts` (reviewer F3 on
 * TASK-52: this function and `documentRotation`'s internal bbox computation
 * used to be two independently-computed owners of the same quantity and
 * disagreed by ~4e-13 px at a quarter turn — `rotate.ts::rotatedBBox` is now
 * the single owner; this is a thin re-export kept here so canvas.ts and
 * crop.test.ts don't need to know the computation moved).
 */
export function rotatedBBox(w: number, h: number, angle: number): { w: number; h: number } {
  return rotatedBBoxImpl(w, h, angle);
}

/**
 * The largest axis-aligned rectangle that fits inside a `w x h` rectangle
 * rotated by `angle` about its own center (both share the same center) — the
 * classic "rotate and crop" solution. Two regimes:
 *
 * - **Half-constrained**: the short side of the source rectangle is small
 *   enough (relative to the long side and the angle) that only two corners
 *   of the inscribed rect can touch the long side; the other two ride the
 *   midline. This is also the branch used near a 45-degree angle
 *   (`|sin - cos| < 1e-10`), where the fully-constrained formula's
 *   denominator (`cos(2*angle)`) approaches zero and would blow up.
 * - **Fully-constrained**: all four corners of the inscribed rect touch a
 *   side of the rotated source rectangle.
 *
 * Both branches are linear/homogeneous in `w, h`, so scaling the source
 * rectangle scales the result by the same factor — `cropFrameFor` relies on
 * this to compute the inscribed rect of the SCALED preview from the
 * unscaled image dimensions.
 */
export function rotatedRectWithMaxArea(w: number, h: number, angle: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const widthIsLonger = w >= h;
  const sideLong = widthIsLonger ? w : h;
  const sideShort = widthIsLonger ? h : w;
  const sinA = Math.abs(Math.sin(angle));
  const cosA = Math.abs(Math.cos(angle));

  if (sideShort <= 2 * sinA * cosA * sideLong || Math.abs(sinA - cosA) < 1e-10) {
    const x = 0.5 * sideShort;
    return widthIsLonger ? { w: x / sinA, h: x / cosA } : { w: x / cosA, h: x / sinA };
  }

  const cos2a = cosA * cosA - sinA * sinA;
  return {
    w: (w * cosA - h * sinA) / cos2a,
    h: (h * cosA - w * sinA) / cos2a,
  };
}

/**
 * Live-canvas ("frame space") size while crop mode is active (D0). Base
 * dimensions are `(imageW, imageH)` for an even `quarter` and
 * `(imageH, imageW)` for an odd one (a quarter turn swaps the document's
 * long/short axis before any band is added); the frame then grows outward by
 * `band` on every side, clamped to the platform's `cap` seam
 * (`Editor.maxImportDimension`: a number on web, `null` = unbounded on
 * desktop).
 */
export function cropFrameSize(
  imageW: number,
  imageH: number,
  quarter: number,
  band: number,
  cap: number | null,
): { w: number; h: number } {
  const odd = (((quarter % 2) + 2) % 2) === 1;
  const baseW = odd ? imageH : imageW;
  const baseH = odd ? imageW : imageH;
  const rawW = baseW + 2 * band;
  const rawH = baseH + 2 * band;
  const w = cap === null ? rawW : Math.min(rawW, cap);
  const h = cap === null ? rawH : Math.min(rawH, cap);
  // B1 (reviewer, TASK-52): this is the last stop before the result becomes
  // `canvas.width`/`canvas.height`, and `canvas.width = Infinity` silently
  // coerces to 0 (a 0x0 canvas that then looks "fine" to every caller that
  // only checks `hasImage()`). A non-finite/non-positive `band` (e.g. from a
  // zero-width canvas box feeding `cropScale()`, see `freezeBand`'s B1 doc
  // comment) or a degenerate `imageW`/`imageH` must never reach the canvas
  // as-is. Clamp to a finite positive integer floor of 1px per axis instead
  // of propagating NaN/Infinity/0 — defense in depth alongside `freezeBand`'s
  // own guard, not a substitute for it (the two guard different inputs:
  // `freezeBand` guards the scale that produces `band`; this guards the
  // arithmetic that consumes it).
  const clampFinite = (v: number): number => (Number.isFinite(v) && v >= 1 ? Math.round(v) : 1);
  return { w: clampFinite(w), h: clampFinite(h) };
}

/**
 * Snapshot of the crop preview's geometry for one frame size + angle. The
 * single owner of the preview transform math (D0) — `render()`,
 * `drawCropOverlay()` and `applyCrop()` in canvas.ts all read this instead of
 * re-deriving it, so the three call sites can never disagree about where the
 * image or the crop region actually is.
 */
export interface CropFrame {
  /** Frame (live canvas backing-store) size, px. */
  w: number;
  h: number;
  /** Frozen rotate-band thickness, frame px (see canvas.ts's `freezeBand`). */
  band: number;
  /** Total rotation `quarter * PI/2 + tilt`, radians, normalized. */
  angle: number;
  /** Preview scale applied to the source image (`<= 1`). */
  s: number;
  /** Source document size, unscaled, unrotated. */
  image: { w: number; h: number };
  /** Rotated bounding box of the image, FRAME px, already scaled by `s`. */
  bbox: { w: number; h: number };
  /** Inscribed rect (crop bounds), frame px, inset already applied. */
  bounds: CropRect;
}

/** True when `angle` is within `1e-9` radians of a multiple of `PI/2`. */
function isRightAngleMultiple(angle: number): boolean {
  const q = angle / (Math.PI / 2);
  return Math.abs(q - Math.round(q)) < 1e-9;
}

/**
 * Compute the full preview geometry for a given frame size + total angle
 * (D0/D3). The image is rotated about the frame center and uniformly scaled
 * by `s = min(1, innerW / bboxW, innerH / bboxH)`, where `inner` is the frame
 * interior after subtracting the band on both sides; if the band would
 * consume the whole frame on an axis (a pathological tiny frame), `s`'s
 * computation falls back to `band = 0` for that computation only — `frame`'s
 * own `band` field (returned unchanged) still reflects the real, frozen
 * band.
 *
 * The inscribed rect (`bounds`) is the largest axis-aligned rect inside the
 * rotated, scaled image, centered on the frame center, deflated by
 * `INSCRIBED_INSET_PX` per side EXCEPT at an exact multiple of 90 degrees,
 * where the inset must be exactly 0 (see `INSCRIBED_INSET_PX`'s doc
 * comment).
 */
export function cropFrameFor(
  imageW: number,
  imageH: number,
  frame: { w: number; h: number; band: number },
  angle: number,
): CropFrame {
  const rawBbox = rotatedBBox(imageW, imageH, angle);
  const bandFits = frame.w - 2 * frame.band > 0 && frame.h - 2 * frame.band > 0;
  const scaleBand = bandFits ? frame.band : 0;
  const innerW = frame.w - 2 * scaleBand;
  const innerH = frame.h - 2 * scaleBand;
  // Reviewer F6 on TASK-52: `rawBbox.w`/`.h` is 0 for a degenerate (zero-size)
  // image, which would otherwise divide by zero and turn `s` into
  // `NaN`/`Infinity`, poisoning every field derived from it below. A tiny
  // floor keeps the division finite without meaningfully changing `s` for
  // any real (nonzero) image.
  const safeBboxW = Math.max(rawBbox.w, 1e-6);
  const safeBboxH = Math.max(rawBbox.h, 1e-6);
  const s = Math.min(1, innerW / safeBboxW, innerH / safeBboxH);
  const bbox = { w: rawBbox.w * s, h: rawBbox.h * s };

  const inset = isRightAngleMultiple(angle) ? 0 : INSCRIBED_INSET_PX;
  const rawInscribed = rotatedRectWithMaxArea(imageW, imageH, angle);
  // Reviewer F6 on TASK-52: for a pathologically tiny frame/image, `2 *
  // INSCRIBED_INSET_PX` can exceed the (scaled) inscribed size, driving
  // `boundsW`/`boundsH` negative. Clamp to 0 — a negative `bounds` size would
  // otherwise flow into `denormalizeRect`'s `clamp(..., minSize, bounds.w)`
  // as an inverted (max < min) range.
  const boundsW = Math.max(0, rawInscribed.w * s - 2 * inset);
  const boundsH = Math.max(0, rawInscribed.h * s - 2 * inset);
  const cx = frame.w / 2;
  const cy = frame.h / 2;

  return {
    w: frame.w,
    h: frame.h,
    band: frame.band,
    angle: normalizeAngle(angle),
    s,
    image: { w: imageW, h: imageH },
    bbox,
    bounds: { x: cx - boundsW / 2, y: cy - boundsH / 2, w: boundsW, h: boundsH },
  };
}

/**
 * Express a pixel `rect` as a ratio of `bounds` — the inverse of
 * `denormalizeRect`. D3 states the result is always in `[0,1]^2`; that used
 * to be merely aspirational (`applyHandleDrag` rounds to integers against a
 * possibly-fractional `bounds`, so the write-back could land a hair outside
 * the range — reviewer F4 on TASK-52) — this function now CLAMPS each field
 * into `[0,1]` so the invariant actually holds, and guards the division when
 * `bounds.w`/`bounds.h` is 0 (a degenerate/pathological bounds) rather than
 * producing `NaN`/`Infinity`.
 */
export function normalizeRect(rect: CropRect, bounds: CropRect): NormRect {
  const u = (x: number): number => (bounds.w > 0 ? clamp((x - bounds.x) / bounds.w, 0, 1) : 0);
  const v = (y: number): number => (bounds.h > 0 ? clamp((y - bounds.y) / bounds.h, 0, 1) : 0);
  return {
    u0: u(rect.x),
    v0: v(rect.y),
    u1: u(rect.x + rect.w),
    v1: v(rect.y + rect.h),
  };
}

/**
 * Derive the pixel crop rect for `norm` against `bounds` (D3): grow to
 * `minSize` around the region's own center first, then slide the whole
 * rect inside `bounds`. Returns floats — rounding happens only in
 * `applyCrop`, so re-deriving this on every angle change never accumulates
 * rounding drift.
 *
 * If `bounds` itself is smaller than `minSize` on an axis (a pathological
 * sliver — e.g. a near-degenerate tilt), the clamp order below makes `w`
 * (or `h`) equal `bounds.w` (or `bounds.h`) exactly, and the region is then
 * slid to exactly match `bounds` on that axis — never left partially
 * outside it.
 */
export function denormalizeRect(norm: NormRect, bounds: CropRect, minSize: number): CropRect {
  const w = clamp((norm.u1 - norm.u0) * bounds.w, minSize, bounds.w);
  const h = clamp((norm.v1 - norm.v0) * bounds.h, minSize, bounds.h);
  const cx = bounds.x + ((norm.u0 + norm.u1) / 2) * bounds.w;
  const cy = bounds.y + ((norm.v0 + norm.v1) / 2) * bounds.h;
  const x = clamp(cx - w / 2, bounds.x, bounds.x + bounds.w - w);
  const y = clamp(cy - h / 2, bounds.y, bounds.y + bounds.h - h);
  return { x, y, w, h };
}

/**
 * Transpose a normalized crop region across a quarter turn, so the region
 * keeps tracking the same image content instead of jumping to a mirrored
 * part of the picture (D3). `delta = +1` and `delta = -1` are exact inverses
 * of each other, and `FULL_NORM` is a fixed point of both.
 */
export function rotateNormRect(norm: NormRect, quarterDelta: -1 | 1): NormRect {
  const { u0, v0, u1, v1 } = norm;
  if (quarterDelta === 1) {
    return { u0: 1 - v1, v0: u0, u1: 1 - v0, v1: u1 };
  }
  return { u0: v0, v0: 1 - u1, u1: v1, v1: 1 - u0 };
}

/**
 * Map a frame-px rect (e.g. the current crop rect) into "rotated-source"
 * px: the coordinate system of the rotated-but-unscaled image, origin at
 * the rotated bounding box's own top-left. This undoes both the preview
 * scale `s` and the frame's centering offset, so `applyCrop` (D5) can turn
 * a frame-space rect into a rect it can hand to `documentRotation` /
 * `computeCrop` without carrying any preview-only concept forward.
 */
export function frameToRotatedSource(rect: CropRect, frame: CropFrame): CropRect {
  const originX = frame.w / 2 - frame.bbox.w / 2;
  const originY = frame.h / 2 - frame.bbox.h / 2;
  return {
    x: (rect.x - originX) / frame.s,
    y: (rect.y - originY) / frame.s,
    w: rect.w / frame.s,
    h: rect.h / frame.s,
  };
}

/**
 * The new tilt angle for a free-rotation drag anchored at `pivot` (the frame
 * center): relative to the drag's start, exactly like `rotate.ts`'s
 * `rotationFromDrag` for annotation rotate-knob drags (grabbing the band
 * never snaps the image to the pointer). `snap` rounds the resulting
 * ABSOLUTE angle to the nearest `ROTATION_SNAP_RAD` (15 degrees), and the
 * result is always clamped to `+/-MAX_TILT_RAD` — a single gesture that
 * sweeps more than 180 degrees around the pivot wraps the delta's sign, and
 * the clamp is what bounds the damage (the design's accepted corner case).
 */
export function tiltFromDrag(
  pivot: Point,
  startPointer: Point,
  pointer: Point,
  startTilt: number,
  snap: boolean,
): number {
  const delta = pointerAngle(pivot, pointer) - pointerAngle(pivot, startPointer);
  let tilt = startTilt + delta;
  if (snap) tilt = Math.round(tilt / ROTATION_SNAP_RAD) * ROTATION_SNAP_RAD;
  return clamp(tilt, -MAX_TILT_RAD, MAX_TILT_RAD);
}
