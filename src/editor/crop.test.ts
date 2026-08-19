import { describe, it, expect } from "vitest";
import {
  computeCrop,
  fullImageRect,
  handleAt,
  applyHandleDrag,
  MIN_CROP_PX,
  MAX_TILT_RAD,
  FULL_NORM,
  cropFrameSize,
  cropFrameFor,
  rotatedBBox,
  rotatedRectWithMaxArea,
  normalizeRect,
  denormalizeRect,
  rotateNormRect,
  frameToRotatedSource,
  tiltFromDrag,
  type CropRect,
  type NormRect,
  type CropFrame,
} from "./crop";
import { unrotatePoint } from "./rotate";
import { translateAnnotation, type ArrowAnnotation, type Point, type RectAnnotation, type TextAnnotation } from "./model";

const IMAGE_W = 800;
const IMAGE_H = 600;
const BOUNDS: CropRect = fullImageRect(IMAGE_W, IMAGE_H);

/**
 * The four corners of `frame.bounds`, expressed in the image's own local
 * (unrotated, un-recentred) frame: unrotate each corner by `-frame.angle`
 * about the frame center. Reviewer F10 on TASK-52: comparing these against
 * `+/- image.w*s/2` / `+/- image.h*s/2` is the invariant that actually
 * matters for AC#4 ("no transparent pixel") — whether every corner of the
 * crop bounds is inside the rotated image — rather than re-deriving the same
 * pixel arithmetic `cropFrameFor` already computed.
 */
function boundsCornersInImageLocalFrame(frame: CropFrame): Point[] {
  const cx = frame.w / 2;
  const cy = frame.h / 2;
  const b = frame.bounds;
  const corners: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ];
  return corners.map((p) => {
    const local = unrotatePoint(p, { x: cx, y: cy }, frame.angle);
    return { x: local.x - cx, y: local.y - cy };
  });
}

describe("computeCrop", () => {
  it("normalizes regardless of drag direction: swapping a/b yields an identical rect", () => {
    const forward = computeCrop({ x: 100, y: 50 }, { x: 300, y: 250 }, BOUNDS, MIN_CROP_PX);
    const reversed = computeCrop({ x: 300, y: 250 }, { x: 100, y: 50 }, BOUNDS, MIN_CROP_PX);
    const mixed = computeCrop({ x: 300, y: 50 }, { x: 100, y: 250 }, BOUNDS, MIN_CROP_PX);
    expect(forward).toEqual({ x: 100, y: 50, w: 200, h: 200 });
    expect(reversed).toEqual(forward);
    expect(mixed).toEqual(forward);
  });

  it("clamps a rectangle that spills past the image edges", () => {
    const result = computeCrop({ x: 700, y: 500 }, { x: 900, y: 700 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 700, y: 500, w: 100, h: 100 });
  });

  it("clamps a negative origin to 0", () => {
    const result = computeCrop({ x: -50, y: -20 }, { x: 100, y: 80 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it("returns null when the width is below minSize", () => {
    const result = computeCrop({ x: 10, y: 10 }, { x: 10 + MIN_CROP_PX - 1, y: 100 }, BOUNDS, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("returns null when the height is below minSize", () => {
    const result = computeCrop({ x: 10, y: 10 }, { x: 100, y: 10 + MIN_CROP_PX - 1 }, BOUNDS, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("returns null for a degenerate a === b point", () => {
    const p = { x: 42, y: 42 };
    expect(computeCrop(p, p, BOUNDS, MIN_CROP_PX)).toBeNull();
  });

  it("returns null for a rectangle covering the whole image", () => {
    const result = computeCrop({ x: 0, y: 0 }, { x: IMAGE_W, y: IMAGE_H }, BOUNDS, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("returns integer-valued x/y/w/h for fractional input points", () => {
    const result = computeCrop({ x: 10.4, y: 20.6 }, { x: 210.2, y: 320.9 }, BOUNDS, MIN_CROP_PX);
    expect(result).not.toBeNull();
    for (const v of [result!.x, result!.y, result!.w, result!.h]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("clamps to an arbitrary (non-image-sized) bounds rect and returns null when the drag covers it exactly", () => {
    const bounds: CropRect = { x: 50, y: 40, w: 200, h: 150 };
    const inside = computeCrop({ x: 60, y: 50 }, { x: 150, y: 120 }, bounds, MIN_CROP_PX);
    expect(inside).toEqual({ x: 60, y: 50, w: 90, h: 70 });
    // Spills past bounds on the bottom-right only, so the clamped rect does
    // NOT cover the whole bounds (a drag that clamps to fill bounds exactly
    // on every side is the "no-op crop" case covered separately below).
    const spillsPast = computeCrop({ x: 100, y: 90 }, { x: 5000, y: 5000 }, bounds, MIN_CROP_PX);
    expect(spillsPast).toEqual({ x: 100, y: 90, w: 150, h: 100 });
    const wholeBounds = computeCrop({ x: 50, y: 40 }, { x: 250, y: 190 }, bounds, MIN_CROP_PX);
    expect(wholeBounds).toBeNull();
  });

  it("B2: a full-coverage drag against the INTEGER, origin-0 bounds applyCrop always passes returns null exactly", () => {
    // computeCrop's one caller (applyCrop) always hands it
    // `fullImageRect(src.width, src.height)` — integer, origin (0,0) — so
    // this is the shape the exact no-op test actually has to get right.
    const bounds: CropRect = { x: 0, y: 0, w: 800, h: 600 };
    const result = computeCrop({ x: 0, y: 0 }, { x: 800, y: 600 }, bounds, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("B2 (reverted from F5): a full-coverage drag against a FRACTIONAL bounds can, under double rounding, be reported as a real (<=1px) crop rather than null", () => {
    // bounds.x and bounds.w are chosen so round(x1) - round(x0) differs from
    // bounds.w by exactly 0.5px under rounding: round(50.5) = 51,
    // round(50.5 + 200.5) = round(251) = 251, so round(x1) - round(x0) = 200,
    // which is exact-unequal to bounds.w (200.5). A prior reviewer round (F5)
    // widened the no-op test to a 1px tolerance specifically to swallow this
    // case — but that tolerance also silently discarded a genuine <=1px trim
    // on the pure-crop path, contradicting applyCrop's "byte-identical to the
    // shipped path" claim (TASK-52 B2). The exact test was reinstated
    // instead, because computeCrop's only real caller (applyCrop) never
    // actually passes a fractional bounds — see the test above — so this
    // case is accepted as unreachable in production and is pinned here only
    // to document the traded-off edge, not to guard against it.
    const bounds: CropRect = { x: 50.5, y: 40.5, w: 200.5, h: 150.5 };
    const result = computeCrop(
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
      bounds,
      MIN_CROP_PX,
    );
    expect(result).not.toBeNull();
    expect(result).toEqual({ x: 51, y: 41, w: 200, h: 150 });
  });
});

describe("crop + translateAnnotation remap", () => {
  // A fixed 200x200 crop rectangle inset from the image edges.
  const rect: CropRect = { x: 100, y: 100, w: 200, h: 200 };

  it("arrow: an annotation inside the crop moves to expected local coordinates", () => {
    const a: ArrowAnnotation = {
      id: "a1",
      kind: "arrow",
      color: "#e8465a",
      strokeWidth: 6,
      from: { x: 120, y: 130 },
      to: { x: 180, y: 190 },
    };
    const result = translateAnnotation(a, -rect.x, -rect.y) as ArrowAnnotation;
    expect(result.from).toEqual({ x: 20, y: 30 });
    expect(result.to).toEqual({ x: 80, y: 90 });
  });

  it("arrow: an annotation outside the crop is kept, moved to negative coordinates", () => {
    const a: ArrowAnnotation = {
      id: "a2",
      kind: "arrow",
      color: "#e8465a",
      strokeWidth: 6,
      from: { x: 10, y: 10 },
      to: { x: 50, y: 50 },
    };
    const result = translateAnnotation(a, -rect.x, -rect.y) as ArrowAnnotation;
    expect(result.from).toEqual({ x: -90, y: -90 });
    expect(result.to).toEqual({ x: -50, y: -50 });
  });

  it("rect: an annotation inside the crop moves to expected local coordinates", () => {
    const r: RectAnnotation = {
      id: "r1",
      kind: "rect",
      color: "#2f7de1",
      strokeWidth: 3,
      a: { x: 150, y: 150 },
      b: { x: 250, y: 250 },
    };
    const result = translateAnnotation(r, -rect.x, -rect.y) as RectAnnotation;
    expect(result.a).toEqual({ x: 50, y: 50 });
    expect(result.b).toEqual({ x: 150, y: 150 });
  });

  it("rect: an annotation outside the crop is kept, moved to negative coordinates", () => {
    const r: RectAnnotation = {
      id: "r2",
      kind: "rect",
      color: "#2f7de1",
      strokeWidth: 3,
      a: { x: 400, y: 400 },
      b: { x: 500, y: 500 },
    };
    const result = translateAnnotation(r, -rect.x, -rect.y) as RectAnnotation;
    expect(result.a).toEqual({ x: 300, y: 300 });
    expect(result.b).toEqual({ x: 400, y: 400 });
  });

  it("text: an annotation inside the crop moves to expected local coordinates", () => {
    const t: TextAnnotation = {
      id: "t1",
      kind: "text",
      color: "#222222",
      strokeWidth: 6,
      at: { x: 140, y: 160 },
      text: "hello",
      fontSize: 28,
    };
    const result = translateAnnotation(t, -rect.x, -rect.y) as TextAnnotation;
    expect(result.at).toEqual({ x: 40, y: 60 });
  });

  it("text: an annotation outside the crop is kept, moved to negative coordinates", () => {
    const t: TextAnnotation = {
      id: "t2",
      kind: "text",
      color: "#222222",
      strokeWidth: 6,
      at: { x: 5, y: 5 },
      text: "outside",
      fontSize: 28,
    };
    const result = translateAnnotation(t, -rect.x, -rect.y) as TextAnnotation;
    expect(result.at).toEqual({ x: -95, y: -95 });
  });
});

describe("fullImageRect", () => {
  it("returns a rect covering the whole image from the origin", () => {
    expect(fullImageRect(IMAGE_W, IMAGE_H)).toEqual({ x: 0, y: 0, w: IMAGE_W, h: IMAGE_H });
  });
});

describe("handleAt", () => {
  const rect: CropRect = { x: 100, y: 100, w: 200, h: 150 };
  const HIT_RADIUS = 12;

  it("finds the nw corner when the point is within radius", () => {
    expect(handleAt({ x: 103, y: 97 }, rect, HIT_RADIUS)).toBe("nw");
  });

  it("finds the ne corner when the point is within radius", () => {
    expect(handleAt({ x: 297, y: 103 }, rect, HIT_RADIUS)).toBe("ne");
  });

  it("finds the sw corner when the point is within radius", () => {
    expect(handleAt({ x: 103, y: 247 }, rect, HIT_RADIUS)).toBe("sw");
  });

  it("finds the se corner when the point is within radius", () => {
    expect(handleAt({ x: 297, y: 247 }, rect, HIT_RADIUS)).toBe("se");
  });

  it("returns null when the point is far from every corner", () => {
    expect(handleAt({ x: 200, y: 175 }, rect, HIT_RADIUS)).toBeNull();
  });

  it("returns the nearest corner when two corners of a tiny rect are both within radius", () => {
    const tiny: CropRect = { x: 100, y: 100, w: 4, h: 4 };
    // Point closer to nw (100,100) than to ne (104,100).
    const point = { x: 101, y: 100 };
    expect(handleAt(point, tiny, HIT_RADIUS)).toBe("nw");
  });
});

describe("applyHandleDrag", () => {
  const rect: CropRect = { x: 100, y: 100, w: 200, h: 150 }; // spans (100,100) to (300,250)

  it("nw drag inward shrinks the top-left corner, pinning se", () => {
    const result = applyHandleDrag(rect, "nw", { x: 150, y: 120 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 150, y: 120, w: 150, h: 130 });
  });

  it("se drag inward shrinks the bottom-right corner, pinning nw", () => {
    const result = applyHandleDrag(rect, "se", { x: 250, y: 200 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: 150, h: 100 });
  });

  it("ne drag moves the top-right corner, pinning sw", () => {
    const result = applyHandleDrag(rect, "ne", { x: 260, y: 130 }, BOUNDS, MIN_CROP_PX);
    // sw is (100, 250); moving corner becomes (260, 130).
    expect(result).toEqual({ x: 100, y: 130, w: 160, h: 120 });
  });

  it("sw drag moves the bottom-left corner, pinning ne", () => {
    const result = applyHandleDrag(rect, "sw", { x: 140, y: 220 }, BOUNDS, MIN_CROP_PX);
    // ne is (300, 100); moving corner becomes (140, 220).
    expect(result).toEqual({ x: 140, y: 100, w: 160, h: 120 });
  });

  it("clamps a corner dragged beyond the image edge into [0,W]x[0,H]", () => {
    const result = applyHandleDrag(rect, "se", { x: 950, y: 700 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: IMAGE_W - 100, h: IMAGE_H - 100 });
  });

  it("clamps a negative-drag corner to 0", () => {
    const result = applyHandleDrag(rect, "nw", { x: -50, y: -30 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 0, y: 0, w: 300, h: 250 });
  });

  it("clamps to minSize instead of flipping when dragged past the opposite corner", () => {
    // Drag se far past nw (100,100): should clamp to MIN_CROP_PX, never flip/invert.
    const result = applyHandleDrag(rect, "se", { x: 50, y: 50 }, BOUNDS, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: MIN_CROP_PX, h: MIN_CROP_PX });
    expect(result.w).toBeGreaterThanOrEqual(MIN_CROP_PX);
    expect(result.h).toBeGreaterThanOrEqual(MIN_CROP_PX);
  });

  it("returns integer-valued x/y/w/h for fractional drag points", () => {
    const result = applyHandleDrag(rect, "se", { x: 250.6, y: 200.2 }, BOUNDS, MIN_CROP_PX);
    for (const v of [result.x, result.y, result.w, result.h]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("clamps to an arbitrary (non-image-sized) bounds rect", () => {
    const bounds: CropRect = { x: 50, y: 40, w: 200, h: 150 };
    const result = applyHandleDrag(rect, "se", { x: 5000, y: 5000 }, bounds, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: bounds.x + bounds.w - 100, h: bounds.y + bounds.h - 100 });
  });
});

describe("rotatedBBox", () => {
  it("is the identity (no growth) at angle 0", () => {
    expect(rotatedBBox(100, 60, 0)).toEqual({ w: 100, h: 60 });
  });

  it("swaps w/h at a 90 degree rotation", () => {
    const result = rotatedBBox(100, 60, Math.PI / 2);
    expect(result.w).toBeCloseTo(60, 9);
    expect(result.h).toBeCloseTo(100, 9);
  });

  it("grows on both axes for a 45 degree rotation of a non-square rect", () => {
    const result = rotatedBBox(100, 60, Math.PI / 4);
    const expected = (100 + 60) / Math.SQRT2;
    expect(result.w).toBeCloseTo(expected, 9);
    expect(result.h).toBeCloseTo(expected, 9);
  });
});

describe("rotatedRectWithMaxArea", () => {
  it("is the identity at angle 0", () => {
    const result = rotatedRectWithMaxArea(100, 60, 0);
    expect(result.w).toBeCloseTo(100, 9);
    expect(result.h).toBeCloseTo(60, 9);
  });

  it("inscribes a w/sqrt(2) square inside a square rotated 45 degrees", () => {
    const result = rotatedRectWithMaxArea(100, 100, Math.PI / 4);
    expect(result.w).toBeCloseTo(100 / Math.SQRT2, 9);
    expect(result.h).toBeCloseTo(100 / Math.SQRT2, 9);
  });

  it("takes the half-constrained (near-45-degree degenerate) branch and matches its closed form", () => {
    // A non-square rect at exactly 45 degrees: |sin - cos| < 1e-10 forces the
    // half-constrained branch even though the rect isn't square, avoiding a
    // division by a near-zero cos(2*angle). Reviewer F11 on TASK-52: assert
    // the actual closed form, not just finiteness — at 45 degrees the
    // half-constrained formula degenerates to an inscribed SQUARE of side
    // `0.5 * sideShort / sin(45deg)` = `30 / (sqrt(2)/2)` = `30 * sqrt(2)` ~=
    // 42.4264 for a 200x60 rect (sideShort = 60).
    const result = rotatedRectWithMaxArea(200, 60, Math.PI / 4);
    const expectedSide = 30 * Math.SQRT2; // ~= 42.4264
    expect(result.w).toBeCloseTo(expectedSide, 4);
    expect(result.h).toBeCloseTo(expectedSide, 4);
    expect(result.w).toBeCloseTo(42.4264, 4);
  });

  it("swaps w/h at a 90 degree rotation", () => {
    const result = rotatedRectWithMaxArea(100, 60, Math.PI / 2);
    expect(result.w).toBeCloseTo(60, 9);
    expect(result.h).toBeCloseTo(100, 9);
  });

  it("has monotonically decreasing area as the angle sweeps from 0 to 45 degrees", () => {
    const angles = [0, Math.PI / 12, Math.PI / 6, Math.PI / 4];
    const areas = angles.map((a) => {
      const r = rotatedRectWithMaxArea(120, 80, a);
      return r.w * r.h;
    });
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]).toBeLessThan(areas[i - 1]);
    }
  });
});

describe("cropFrameSize", () => {
  it("grows the base image size by 2*band on every side", () => {
    expect(cropFrameSize(800, 600, 0, 40, null)).toEqual({ w: 880, h: 680 });
  });

  it("swaps the base dimensions for an odd quarter turn before adding the band", () => {
    expect(cropFrameSize(800, 600, 1, 40, null)).toEqual({ w: 680, h: 880 });
    expect(cropFrameSize(800, 600, 3, 40, null)).toEqual({ w: 680, h: 880 });
    expect(cropFrameSize(800, 600, 2, 40, null)).toEqual({ w: 880, h: 680 });
  });

  it("clamps to cap when the grown frame would exceed it", () => {
    expect(cropFrameSize(4000, 3000, 0, 40, 4096)).toEqual({ w: 4080, h: 3080 });
    expect(cropFrameSize(4096, 3000, 0, 40, 4096)).toEqual({ w: 4096, h: 3080 });
  });

  it("cap === null means unbounded, even for a huge frame", () => {
    expect(cropFrameSize(10000, 8000, 0, 40, null)).toEqual({ w: 10080, h: 8080 });
  });

  // B1 (reviewer, TASK-52): a zero-width canvas box (welcome screen ->
  // crop, or crop -> Ctrl+N -> Ctrl+Z -> restore) sends a non-finite/zero
  // `cropScale()` into `freezeBand()`, which used to hand this function a
  // non-finite/zero `band` and poison `canvas.width`/`canvas.height` with
  // Infinity/NaN (coerced to a 0x0 canvas). `freezeBand()` now guards its
  // own output, but this function guards independently — defense in depth
  // for any other caller that might someday pass a bad `band` directly.
  it("clamps a non-finite band to a finite positive integer frame instead of propagating Infinity/NaN", () => {
    expect(cropFrameSize(800, 600, 0, Infinity, null)).toEqual({ w: 1, h: 1 });
    expect(cropFrameSize(800, 600, 0, NaN, null)).toEqual({ w: 1, h: 1 });
    expect(cropFrameSize(800, 600, 0, -Infinity, 4096)).toEqual({ w: 1, h: 1 });
  });

  it("clamps a degenerate (non-finite/zero) image size to a finite positive integer frame", () => {
    expect(cropFrameSize(NaN, 600, 0, 40, null)).toEqual({ w: 1, h: 680 });
    expect(cropFrameSize(0, 0, 0, 40, null)).toEqual({ w: 80, h: 80 });
  });

  it("rounds a fractional band to an integer frame size", () => {
    expect(cropFrameSize(800, 600, 0, 12.7, null)).toEqual({ w: 825, h: 625 });
  });
});

describe("cropFrameFor", () => {
  it("at an exact quarter turn, s === 1 for an image that fits the frame, and the inset is 0", () => {
    const band = 40;
    const frame = cropFrameSize(800, 600, 0, band, null);
    const result = cropFrameFor(800, 600, { ...frame, band }, 0);
    expect(result.s).toBe(1);
    // Inscribed rect at angle 0 is the full image, uninset: exactly (frame - 2*band).
    expect(result.bounds.w).toBeCloseTo(800, 9);
    expect(result.bounds.h).toBeCloseTo(600, 9);
  });

  /**
   * Reviewer F10 on TASK-52: this replaces the previous "off a right angle"
   * test, which re-asserted the IMPLEMENTATION (`uninset.w * s - 2 *
   * INSCRIBED_INSET_PX`) rather than the property that actually matters for
   * AC#4 ("no transparent pixel"): at a genuine tilt, every corner of the
   * inscribed crop bounds must land STRICTLY inside the rotated, scaled
   * image quadrilateral — not merely at the formula's predicted distance
   * from it — so an anti-aliased source edge pixel can never be sampled.
   * Checked by unrotating each bounds corner back into the image's own local
   * (axis-aligned) frame and comparing against the image's half-extents.
   */
  it("off a right angle, every corner of the inscribed bounds lies strictly inside the rotated, scaled image quad", () => {
    const band = 40;
    const frame = cropFrameSize(800, 600, 0, band, null);
    for (const angle of [Math.PI / 12, Math.PI / 6, Math.PI / 4, (5 * Math.PI) / 12]) {
      const result = cropFrameFor(800, 600, { ...frame, band }, angle);
      const halfW = (result.image.w * result.s) / 2;
      const halfH = (result.image.h * result.s) / 2;
      for (const local of boundsCornersInImageLocalFrame(result)) {
        expect(local.x).toBeGreaterThan(-halfW);
        expect(local.x).toBeLessThan(halfW);
        expect(local.y).toBeGreaterThan(-halfH);
        expect(local.y).toBeLessThan(halfH);
      }
    }
  });

  /**
   * Reviewer F10 on TASK-52: replaces the previous "is exactly 0 inset"
   * test with the same corner-inside-the-image-quad invariant, at the angles
   * where the inset is (by design, D3) exactly 0. At a right angle the
   * rotated image is pixel-aligned, so touching the image's own edge exactly
   * is fine (there's no anti-aliased pixel to avoid) — corners must never
   * land OUTSIDE, but landing exactly on the boundary is expected and
   * correct here (unlike the tilted case above, which must be strict).
   */
  it("at 90, 180 and 270 degrees, the inscribed bounds' corners never exceed the (zero-inset) image edge", () => {
    const band = 40;
    const frame = cropFrameSize(800, 600, 0, band, null);
    for (const angle of [Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const result = cropFrameFor(800, 600, { ...frame, band }, angle);
      const halfW = (result.image.w * result.s) / 2;
      const halfH = (result.image.h * result.s) / 2;
      const TOLERANCE = 1e-6;
      for (const local of boundsCornersInImageLocalFrame(result)) {
        expect(local.x).toBeLessThanOrEqual(halfW + TOLERANCE);
        expect(local.x).toBeGreaterThanOrEqual(-halfW - TOLERANCE);
        expect(local.y).toBeLessThanOrEqual(halfH + TOLERANCE);
        expect(local.y).toBeGreaterThanOrEqual(-halfH - TOLERANCE);
      }
    }
  });

  it("F6: guards against a zero-size image (rawBbox 0) without producing NaN/Infinity", () => {
    const frame = { w: 100, h: 100, band: 10 };
    const result = cropFrameFor(0, 0, frame, 0);
    expect(Number.isFinite(result.s)).toBe(true);
    expect(result.s).toBeGreaterThan(0);
    expect(Number.isFinite(result.bounds.w)).toBe(true);
    expect(Number.isFinite(result.bounds.h)).toBe(true);
    expect(result.bounds.w).toBeGreaterThanOrEqual(0);
    expect(result.bounds.h).toBeGreaterThanOrEqual(0);
  });

  it("F6: clamps the inscribed bounds to 0 (never negative) when the inset would exceed a tiny inscribed rect", () => {
    // A tiny image rotated off a right angle: rotatedRectWithMaxArea's
    // inscribed rect is well under 2 * INSCRIBED_INSET_PX (2px), so the
    // un-guarded `rawInscribed.w * s - 2 * inset` would go negative.
    const frame = { w: 100, h: 100, band: 10 };
    const result = cropFrameFor(2, 2, frame, Math.PI / 6);
    expect(Number.isFinite(result.bounds.w)).toBe(true);
    expect(Number.isFinite(result.bounds.h)).toBe(true);
    expect(result.bounds.w).toBe(0);
    expect(result.bounds.h).toBe(0);
  });

  it("centers bounds on the frame center", () => {
    const band = 40;
    const angle = Math.PI / 6;
    const frame = cropFrameSize(800, 600, 0, band, null);
    const result = cropFrameFor(800, 600, { ...frame, band }, angle);
    const boundsCx = result.bounds.x + result.bounds.w / 2;
    const boundsCy = result.bounds.y + result.bounds.h / 2;
    expect(boundsCx).toBeCloseTo(frame.w / 2, 6);
    expect(boundsCy).toBeCloseTo(frame.h / 2, 6);
  });

  it("falls back to band=0 for the scale computation when the band would consume the whole frame", () => {
    // A pathologically tiny frame where 2*band >= frame.w/h: the scale
    // computation must not divide by a non-positive inner dimension.
    const frame = { w: 50, h: 50, band: 40 };
    const result = cropFrameFor(800, 600, frame, 0);
    expect(Number.isFinite(result.s)).toBe(true);
    expect(result.s).toBeGreaterThan(0);
  });
});

describe("normalizeRect / denormalizeRect", () => {
  const bounds: CropRect = { x: 100, y: 80, w: 400, h: 300 };

  it("round-trips a rect with no drift", () => {
    const rect: CropRect = { x: 150, y: 120, w: 200, h: 150 };
    const norm = normalizeRect(rect, bounds);
    const back = denormalizeRect(norm, bounds, MIN_CROP_PX);
    expect(back.x).toBeCloseTo(rect.x, 9);
    expect(back.y).toBeCloseTo(rect.y, 9);
    expect(back.w).toBeCloseTo(rect.w, 9);
    expect(back.h).toBeCloseTo(rect.h, 9);
  });

  it("FULL_NORM denormalizes to exactly bounds", () => {
    const rect = denormalizeRect(FULL_NORM, bounds, MIN_CROP_PX);
    expect(rect).toEqual(bounds);
  });

  it("floors a too-small region at MIN_CROP_PX, growing around its own center", () => {
    const tiny: NormRect = { u0: 0.5 - 0.001, v0: 0.5 - 0.001, u1: 0.5 + 0.001, v1: 0.5 + 0.001 };
    const rect = denormalizeRect(tiny, bounds, MIN_CROP_PX);
    expect(rect.w).toBe(MIN_CROP_PX);
    expect(rect.h).toBe(MIN_CROP_PX);
  });

  it("when bounds is smaller than minSize on an axis, the region equals bounds on that axis", () => {
    const sliver: CropRect = { x: 100, y: 80, w: 4, h: 300 }; // w below MIN_CROP_PX
    const rect = denormalizeRect(FULL_NORM, sliver, MIN_CROP_PX);
    expect(rect.w).toBe(sliver.w);
    expect(rect.x).toBe(sliver.x);
  });

  it("F4: clamps the result into [0,1]^2 even when the input rect exceeds bounds", () => {
    // A rect that spills past `bounds` on every side (e.g. from an
    // `applyHandleDrag` integer round-off against a fractional `bounds` —
    // D3 claims `norm` is always in [0,1]^2, but the un-clamped division
    // could exceed it by a hair).
    const spilling: CropRect = { x: bounds.x - 5, y: bounds.y - 5, w: bounds.w + 10, h: bounds.h + 10 };
    const norm = normalizeRect(spilling, bounds);
    for (const v of [norm.u0, norm.v0, norm.u1, norm.v1]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("F4: guards the division when bounds.w or bounds.h is 0, returning finite values instead of NaN/Infinity", () => {
    const degenerate: CropRect = { x: 100, y: 80, w: 0, h: 0 };
    const norm = normalizeRect({ x: 100, y: 80, w: 50, h: 50 }, degenerate);
    for (const v of [norm.u0, norm.v0, norm.u1, norm.v1]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("a tilt-then-back round trip (denormalize against a shrunk, then the original, bounds) restores the original rect exactly", () => {
    const rect: CropRect = { x: 180, y: 140, w: 100, h: 90 };
    const norm = normalizeRect(rect, bounds);
    const shrunk: CropRect = { x: 130, y: 110, w: 300, h: 220 };
    denormalizeRect(norm, shrunk, MIN_CROP_PX); // simulate an intermediate tilt; norm itself is untouched
    const back = denormalizeRect(norm, bounds, MIN_CROP_PX);
    expect(back.x).toBeCloseTo(rect.x, 9);
    expect(back.y).toBeCloseTo(rect.y, 9);
    expect(back.w).toBeCloseTo(rect.w, 9);
    expect(back.h).toBeCloseTo(rect.h, 9);
  });
});

describe("frameToRotatedSource", () => {
  // TASK-40 AC#3 rides on this function (D5's `srcRect =
  // frameToRotatedSource(rectF, frame)` feeds `computeCrop`'s full-coverage
  // no-op guard) yet, per reviewer F9 on TASK-52, it had zero direct tests.
  // A whole-image crop (FULL_NORM against the inscribed bounds) must recover
  // exactly the original image rect in rotated-source space, at angle 0 and
  // at a quarter turn (where w/h swap), and that recovery must hold even
  // when `band` is fractional (a real `freezeBand()` value, never an
  // integer) — the existing integer-band tests elsewhere in this file never
  // exercised that.
  function fullCoverageFrame(imageW: number, imageH: number, quarter: 0 | 1 | 2 | 3, band: number): CropFrame {
    const angle = quarter * (Math.PI / 2);
    const size = cropFrameSize(imageW, imageH, quarter, band, null);
    return cropFrameFor(imageW, imageH, { ...size, band }, angle);
  }

  it("F9: at angle 0, a whole-image crop recovers exactly {0, 0, imgW, imgH}", () => {
    const frame = fullCoverageFrame(IMAGE_W, IMAGE_H, 0, 40);
    const rectF = denormalizeRect(FULL_NORM, frame.bounds, MIN_CROP_PX);
    const src = frameToRotatedSource(rectF, frame);
    expect(src.x).toBeCloseTo(0, 6);
    expect(src.y).toBeCloseTo(0, 6);
    expect(src.w).toBeCloseTo(IMAGE_W, 6);
    expect(src.h).toBeCloseTo(IMAGE_H, 6);

    // Reviewer follow-up (2026-08-19 polish round): F9 stopped one step
    // short of what it exists to guard (TASK-40 AC#3, no history push on an
    // untouched apply). Feed the recovered `srcRect` corners into
    // `computeCrop` against the FULL image rect exactly as `applyCrop`'s
    // `angle === 0` branch does, and confirm it returns `null` — the signal
    // `applyCrop` reads to skip the history push entirely — so this unit
    // suite pins the end-to-end contract, not just the intermediate
    // geometry.
    const rect = computeCrop(
      { x: src.x, y: src.y },
      { x: src.x + src.w, y: src.y + src.h },
      fullImageRect(IMAGE_W, IMAGE_H),
      MIN_CROP_PX,
    );
    expect(rect).toBeNull();
  });

  it("F9: at a quarter turn, a whole-image crop recovers {0, 0, imgW, imgH} with w/h SWAPPED", () => {
    const frame = fullCoverageFrame(IMAGE_W, IMAGE_H, 1, 40);
    const rectF = denormalizeRect(FULL_NORM, frame.bounds, MIN_CROP_PX);
    const src = frameToRotatedSource(rectF, frame);
    expect(src.x).toBeCloseTo(0, 6);
    expect(src.y).toBeCloseTo(0, 6);
    expect(src.w).toBeCloseTo(IMAGE_H, 6);
    expect(src.h).toBeCloseTo(IMAGE_W, 6);
  });

  it("F9: the same recovery holds with a FRACTIONAL band, at angle 0 and at a quarter turn", () => {
    const fractionalBand = 40 * 0.9137; // a real freezeBand() value is never an integer
    for (const quarter of [0, 1] as const) {
      const frame = fullCoverageFrame(IMAGE_W, IMAGE_H, quarter, fractionalBand);
      const rectF = denormalizeRect(FULL_NORM, frame.bounds, MIN_CROP_PX);
      const src = frameToRotatedSource(rectF, frame);
      const [expectedW, expectedH] = quarter === 0 ? [IMAGE_W, IMAGE_H] : [IMAGE_H, IMAGE_W];
      expect(src.x).toBeCloseTo(0, 6);
      expect(src.y).toBeCloseTo(0, 6);
      expect(src.w).toBeCloseTo(expectedW, 6);
      expect(src.h).toBeCloseTo(expectedH, 6);
    }
  });
});

describe("rotateNormRect", () => {
  it("+1 then -1 is the identity", () => {
    const norm: NormRect = { u0: 0.1, v0: 0.2, u1: 0.6, v1: 0.7 };
    const roundTrip = rotateNormRect(rotateNormRect(norm, 1), -1);
    expect(roundTrip.u0).toBeCloseTo(norm.u0, 9);
    expect(roundTrip.v0).toBeCloseTo(norm.v0, 9);
    expect(roundTrip.u1).toBeCloseTo(norm.u1, 9);
    expect(roundTrip.v1).toBeCloseTo(norm.v1, 9);
  });

  it("-1 then +1 is also the identity", () => {
    const norm: NormRect = { u0: 0.15, v0: 0.05, u1: 0.9, v1: 0.55 };
    const roundTrip = rotateNormRect(rotateNormRect(norm, -1), 1);
    expect(roundTrip.u0).toBeCloseTo(norm.u0, 9);
    expect(roundTrip.v0).toBeCloseTo(norm.v0, 9);
    expect(roundTrip.u1).toBeCloseTo(norm.u1, 9);
    expect(roundTrip.v1).toBeCloseTo(norm.v1, 9);
  });

  it("FULL_NORM is a fixed point of both directions", () => {
    expect(rotateNormRect(FULL_NORM, 1)).toEqual(FULL_NORM);
    expect(rotateNormRect(FULL_NORM, -1)).toEqual(FULL_NORM);
  });
});

describe("tiltFromDrag", () => {
  const pivot = { x: 100, y: 100 };

  it("is relative to the grab: an offset between pointer and shape at grab time is preserved", () => {
    // Start pointer directly right of the pivot (angle 0); shape already
    // tilted 10 degrees at grab time. Dragging the pointer by +20 degrees
    // around the pivot should move the tilt by the same +20 degrees.
    const startPointer = { x: 200, y: 100 };
    const startTilt = (10 * Math.PI) / 180;
    const twentyDeg = (20 * Math.PI) / 180;
    const pointer = {
      x: pivot.x + 100 * Math.cos(twentyDeg),
      y: pivot.y + 100 * Math.sin(twentyDeg),
    };
    const result = tiltFromDrag(pivot, startPointer, pointer, startTilt, false);
    expect(result).toBeCloseTo(startTilt + twentyDeg, 6);
  });

  it("F12: snaps the ABSOLUTE angle to a multiple of 15 degrees, from a nonzero startTilt", () => {
    // A zero startTilt cannot distinguish absolute snapping (round the
    // result) from relative snapping (round only the drag's delta) — both
    // happen to agree when the start is already 0. Starting at a non-15-
    // degree-multiple tilt (7 degrees) makes the two diverge: relative
    // snapping would land on `7 + round(delta/15)*15` (never a multiple of
    // 15 unless delta itself cancels the 7), while absolute snapping always
    // lands on a bare multiple of 15 regardless of startTilt.
    const startPointer = { x: 200, y: 100 };
    const startTilt = (7 * Math.PI) / 180;
    const nearlySeventeenDeg = (17 * Math.PI) / 180;
    const pointer = {
      x: pivot.x + 100 * Math.cos(nearlySeventeenDeg),
      y: pivot.y + 100 * Math.sin(nearlySeventeenDeg),
    };
    const result = tiltFromDrag(pivot, startPointer, pointer, startTilt, true);
    const resultDeg = (result * 180) / Math.PI;
    expect(resultDeg / 15).toBeCloseTo(Math.round(resultDeg / 15), 5);
  });

  it("F12: snap composed with the +/-MAX_TILT_RAD clamp can land exactly on the clamp boundary", () => {
    // 45 degrees (MAX_TILT_RAD) IS itself a multiple of 15, so a drag that
    // snaps to (or past) 45 and then clamps must land exactly on
    // MAX_TILT_RAD, not somewhere the clamp cuts off mid-increment.
    const startPointer = { x: 200, y: 100 };
    const startTilt = (7 * Math.PI) / 180;
    const sixtyDeg = (60 * Math.PI) / 180;
    const pointer = {
      x: pivot.x + 100 * Math.cos(sixtyDeg),
      y: pivot.y + 100 * Math.sin(sixtyDeg),
    };
    const result = tiltFromDrag(pivot, startPointer, pointer, startTilt, true);
    expect(result).toBeCloseTo(MAX_TILT_RAD, 9);
  });

  it("clamps to +/-MAX_TILT_RAD for a drag well past 45 degrees", () => {
    const startPointer = { x: 200, y: 100 };
    const eightyDeg = (80 * Math.PI) / 180;
    const pointer = {
      x: pivot.x + 100 * Math.cos(eightyDeg),
      y: pivot.y + 100 * Math.sin(eightyDeg),
    };
    const result = tiltFromDrag(pivot, startPointer, pointer, 0, false);
    expect(result).toBeCloseTo(MAX_TILT_RAD, 9);

    const negEightyDeg = (-80 * Math.PI) / 180;
    const negPointer = {
      x: pivot.x + 100 * Math.cos(negEightyDeg),
      y: pivot.y + 100 * Math.sin(negEightyDeg),
    };
    const negResult = tiltFromDrag(pivot, startPointer, negPointer, 0, false);
    expect(negResult).toBeCloseTo(-MAX_TILT_RAD, 9);
  });
});
