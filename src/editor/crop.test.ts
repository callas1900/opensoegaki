import { describe, it, expect } from "vitest";
import { computeCrop, fullImageRect, handleAt, applyHandleDrag, MIN_CROP_PX, type CropRect } from "./crop";
import { translateAnnotation, type ArrowAnnotation, type RectAnnotation, type TextAnnotation } from "./model";

const IMAGE_W = 800;
const IMAGE_H = 600;

describe("computeCrop", () => {
  it("normalizes regardless of drag direction: swapping a/b yields an identical rect", () => {
    const forward = computeCrop({ x: 100, y: 50 }, { x: 300, y: 250 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    const reversed = computeCrop({ x: 300, y: 250 }, { x: 100, y: 50 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    const mixed = computeCrop({ x: 300, y: 50 }, { x: 100, y: 250 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(forward).toEqual({ x: 100, y: 50, w: 200, h: 200 });
    expect(reversed).toEqual(forward);
    expect(mixed).toEqual(forward);
  });

  it("clamps a rectangle that spills past the image edges", () => {
    const result = computeCrop({ x: 700, y: 500 }, { x: 900, y: 700 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 700, y: 500, w: 100, h: 100 });
  });

  it("clamps a negative origin to 0", () => {
    const result = computeCrop({ x: -50, y: -20 }, { x: 100, y: 80 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 0, y: 0, w: 100, h: 80 });
  });

  it("returns null when the width is below minSize", () => {
    const result = computeCrop({ x: 10, y: 10 }, { x: 10 + MIN_CROP_PX - 1, y: 100 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("returns null when the height is below minSize", () => {
    const result = computeCrop({ x: 10, y: 10 }, { x: 100, y: 10 + MIN_CROP_PX - 1 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("returns null for a degenerate a === b point", () => {
    const p = { x: 42, y: 42 };
    expect(computeCrop(p, p, IMAGE_W, IMAGE_H, MIN_CROP_PX)).toBeNull();
  });

  it("returns null for a rectangle covering the whole image", () => {
    const result = computeCrop({ x: 0, y: 0 }, { x: IMAGE_W, y: IMAGE_H }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(result).toBeNull();
  });

  it("returns integer-valued x/y/w/h for fractional input points", () => {
    const result = computeCrop({ x: 10.4, y: 20.6 }, { x: 210.2, y: 320.9 }, IMAGE_W, IMAGE_H, MIN_CROP_PX);
    expect(result).not.toBeNull();
    for (const v of [result!.x, result!.y, result!.w, result!.h]) {
      expect(Number.isInteger(v)).toBe(true);
    }
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
  const IMG_W = 800;
  const IMG_H = 600;

  it("nw drag inward shrinks the top-left corner, pinning se", () => {
    const result = applyHandleDrag(rect, "nw", { x: 150, y: 120 }, IMG_W, IMG_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 150, y: 120, w: 150, h: 130 });
  });

  it("se drag inward shrinks the bottom-right corner, pinning nw", () => {
    const result = applyHandleDrag(rect, "se", { x: 250, y: 200 }, IMG_W, IMG_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: 150, h: 100 });
  });

  it("ne drag moves the top-right corner, pinning sw", () => {
    const result = applyHandleDrag(rect, "ne", { x: 260, y: 130 }, IMG_W, IMG_H, MIN_CROP_PX);
    // sw is (100, 250); moving corner becomes (260, 130).
    expect(result).toEqual({ x: 100, y: 130, w: 160, h: 120 });
  });

  it("sw drag moves the bottom-left corner, pinning ne", () => {
    const result = applyHandleDrag(rect, "sw", { x: 140, y: 220 }, IMG_W, IMG_H, MIN_CROP_PX);
    // ne is (300, 100); moving corner becomes (140, 220).
    expect(result).toEqual({ x: 140, y: 100, w: 160, h: 120 });
  });

  it("clamps a corner dragged beyond the image edge into [0,W]x[0,H]", () => {
    const result = applyHandleDrag(rect, "se", { x: 950, y: 700 }, IMG_W, IMG_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: IMG_W - 100, h: IMG_H - 100 });
  });

  it("clamps a negative-drag corner to 0", () => {
    const result = applyHandleDrag(rect, "nw", { x: -50, y: -30 }, IMG_W, IMG_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 0, y: 0, w: 300, h: 250 });
  });

  it("clamps to minSize instead of flipping when dragged past the opposite corner", () => {
    // Drag se far past nw (100,100): should clamp to MIN_CROP_PX, never flip/invert.
    const result = applyHandleDrag(rect, "se", { x: 50, y: 50 }, IMG_W, IMG_H, MIN_CROP_PX);
    expect(result).toEqual({ x: 100, y: 100, w: MIN_CROP_PX, h: MIN_CROP_PX });
    expect(result.w).toBeGreaterThanOrEqual(MIN_CROP_PX);
    expect(result.h).toBeGreaterThanOrEqual(MIN_CROP_PX);
  });

  it("returns integer-valued x/y/w/h for fractional drag points", () => {
    const result = applyHandleDrag(rect, "se", { x: 250.6, y: 200.2 }, IMG_W, IMG_H, MIN_CROP_PX);
    for (const v of [result.x, result.y, result.w, result.h]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
