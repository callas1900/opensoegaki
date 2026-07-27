import { describe, it, expect } from "vitest";
import {
  canRotate,
  angleOf,
  normalizeAngle,
  pivotOf,
  pivotOfAnnotation,
  rotatePoint,
  unrotatePoint,
  pointerAngle,
  rotationFromDrag,
  rotatedCorners,
  reanchorDelta,
  applyRotation,
} from "./rotate";
import { boundsOf } from "./bounds";
import type { RectAnnotation, TextAnnotation, BadgeAnnotation, ImageAnnotation } from "./model";

// Trivial fake 2D context, same pattern as hittest.test.ts/resize.test.ts.
const measure = {
  font: "",
  measureText: (t: string) => ({ width: t.length * 10 }),
} as unknown as CanvasRenderingContext2D;

function rect(a: { x: number; y: number }, b: { x: number; y: number }): RectAnnotation {
  return { id: "rect1", kind: "rect", color: "#2f7de1", strokeWidth: 4, a, b };
}

function text(at: { x: number; y: number }, str: string, fontSize = 20): TextAnnotation {
  return { id: "text1", kind: "text", color: "#222222", strokeWidth: 1, at, text: str, fontSize };
}

function badge(at: { x: number; y: number }, radius = 20): BadgeAnnotation {
  return { id: "badge1", kind: "badge", color: "#ED107B", strokeWidth: 6, at, number: 1, radius };
}

function image(at: { x: number; y: number }, width: number, height: number): ImageAnnotation {
  return { id: "image1", kind: "image", color: "#000000", strokeWidth: 1, at, width, height };
}

describe("canRotate", () => {
  it("offers the affordance on rect/image/text/badge, not arrow/highlight", () => {
    expect(canRotate("rect")).toBe(true);
    expect(canRotate("image")).toBe(true);
    expect(canRotate("text")).toBe(true);
    expect(canRotate("badge")).toBe(true);
    expect(canRotate("arrow")).toBe(false);
    expect(canRotate("highlight")).toBe(false);
  });
});

describe("normalizeAngle", () => {
  it("leaves angles already in (-π, π] unchanged", () => {
    expect(normalizeAngle(0)).toBeCloseTo(0);
    expect(normalizeAngle(1)).toBeCloseTo(1);
    expect(normalizeAngle(-1)).toBeCloseTo(-1);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI);
  });

  it("wraps -π to π (upper-inclusive boundary)", () => {
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
  });

  it("wraps an angle just past π back down near -π", () => {
    expect(normalizeAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1);
  });

  it("wraps angles more than one full turn away", () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe("angleOf", () => {
  it("defaults to 0 when angle is absent", () => {
    const r = rect({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(angleOf(r)).toBe(0);
  });

  it("normalizes a stored angle", () => {
    const r = { ...rect({ x: 0, y: 0 }, { x: 10, y: 10 }), angle: -Math.PI };
    expect(angleOf(r)).toBeCloseTo(Math.PI);
  });
});

describe("rotatePoint / unrotatePoint", () => {
  it("θ=0 is the identity", () => {
    const p = { x: 12, y: 34 };
    const pivot = { x: 5, y: 5 };
    expect(rotatePoint(p, pivot, 0)).toEqual(p);
    expect(unrotatePoint(p, pivot, 0)).toEqual(p);
  });

  it("round-trips through rotate then unrotate", () => {
    const p = { x: 40, y: -7 };
    const pivot = { x: 3, y: 2 };
    const angle = 0.6;
    const rotated = rotatePoint(p, pivot, angle);
    const back = unrotatePoint(rotated, pivot, angle);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("rotates a point 90° clockwise (y-down) around the origin", () => {
    // (1, 0) rotated by +90° (clockwise in y-down space) lands on (0, 1).
    const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(result.x).toBeCloseTo(0, 9);
    expect(result.y).toBeCloseTo(1, 9);
  });
});

describe("pointerAngle", () => {
  it("is atan2 of the offset from pivot to p", () => {
    expect(pointerAngle({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(pointerAngle({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
  });
});

describe("pivotOfAnnotation", () => {
  it("matches boundsOf's center for rect", () => {
    const r = rect({ x: 0, y: 0 }, { x: 40, y: 20 });
    const b = boundsOf(r, measure);
    expect(pivotOfAnnotation(r, measure)).toEqual(pivotOf(b));
    expect(pivotOfAnnotation(r, measure)).toEqual({ x: 20, y: 10 });
  });

  it("matches boundsOf's center for text", () => {
    const t = text({ x: 5, y: 5 }, "hi", 20); // bounds w=20,h=24
    const b = boundsOf(t, measure);
    expect(pivotOfAnnotation(t, measure)).toEqual(pivotOf(b));
  });

  it("matches boundsOf's center for image", () => {
    const img = image({ x: 10, y: 10 }, 80, 40);
    const b = boundsOf(img, measure);
    expect(pivotOfAnnotation(img, measure)).toEqual(pivotOf(b));
  });

  it("degenerates to `at` for a badge (its box is already centered there)", () => {
    const bd = badge({ x: 50, y: 60 }, 20);
    expect(pivotOfAnnotation(bd, measure)).toEqual({ x: 50, y: 60 });
  });
});

describe("rotationFromDrag", () => {
  const pivot = { x: 0, y: 0 };

  it("no jump on grab: pointer===startPointer returns startAngle unchanged", () => {
    const start = { x: 10, y: 0 };
    expect(rotationFromDrag(pivot, start, start, 0.3, false)).toBeCloseTo(0.3);
  });

  it("is relative: a drag from a non-zero startAngle adds only the pointer's angular delta", () => {
    const startPointer = { x: 10, y: 0 }; // angle 0
    const pointer = { x: 0, y: 10 }; // angle PI/2
    const result = rotationFromDrag(pivot, startPointer, pointer, 0.5, false);
    expect(result).toBeCloseTo(0.5 + Math.PI / 2);
  });

  it("snaps the absolute result to 15° increments when snap is true", () => {
    const startPointer = { x: 10, y: 0 };
    // Drag to just past 20°: relative delta ~20deg off a startAngle of 0 should snap to 15deg.
    const pointer = { x: Math.cos((20 * Math.PI) / 180), y: Math.sin((20 * Math.PI) / 180) };
    const result = rotationFromDrag(pivot, startPointer, pointer, 0, true);
    expect(result).toBeCloseTo((15 * Math.PI) / 180, 5);
  });

  it("snapping can land exactly on 0", () => {
    const startPointer = { x: 10, y: 0 };
    const pointer = { x: Math.cos(0.05), y: Math.sin(0.05) };
    const result = rotationFromDrag(pivot, startPointer, pointer, 0, true);
    expect(result).toBeCloseTo(0);
  });
});

describe("rotatedCorners", () => {
  it("θ=0 returns the box's own corners in nw, ne, se, sw order", () => {
    const b = { x: 0, y: 0, w: 10, h: 20 };
    const [nw, ne, se, sw] = rotatedCorners(b, 0);
    expect(nw).toEqual({ x: 0, y: 0 });
    expect(ne).toEqual({ x: 10, y: 0 });
    expect(se).toEqual({ x: 10, y: 20 });
    expect(sw).toEqual({ x: 0, y: 20 });
  });

  it("rotating 180° swaps nw<->se and ne<->sw", () => {
    const b = { x: 0, y: 0, w: 10, h: 20 };
    const [nw, ne, se, sw] = rotatedCorners(b, Math.PI);
    const [nw0, ne0, se0, sw0] = rotatedCorners(b, 0);
    expect(nw.x).toBeCloseTo(se0.x, 9);
    expect(nw.y).toBeCloseTo(se0.y, 9);
    expect(se.x).toBeCloseTo(nw0.x, 9);
    expect(ne.x).toBeCloseTo(sw0.x, 9);
    expect(sw.x).toBeCloseTo(ne0.x, 9);
  });
});

describe("reanchorDelta", () => {
  const anchor = { x: 100, y: 100 };
  const before: import("./bounds").Bounds = { x: 0, y: 0, w: 100, h: 100 };

  it("is {0,0} at angle 0 regardless of bounds change", () => {
    const after = { x: 0, y: 0, w: 200, h: 50 };
    expect(reanchorDelta(anchor, before, after, 0)).toEqual({ x: 0, y: 0 });
  });

  it("is {0,0} when before/after share a pivot, even at a nonzero angle", () => {
    // before pivot = (50,50); after has the same pivot but different w/h.
    const after = { x: 40, y: 20, w: 20, h: 60 };
    expect(reanchorDelta(anchor, before, after, 0.7)).toEqual({ x: 0, y: 0 });
  });

  it("satisfies rotate(anchor, pivotBefore, θ) === rotate(anchor, pivotAfter, θ) + d", () => {
    const after = { x: 0, y: 0, w: 300, h: 100 }; // pivot moves from (50,50) to (150,50)
    const angle = 0.4;
    const d = reanchorDelta(anchor, before, after, angle);
    const pivotBefore = pivotOf(before);
    const pivotAfter = pivotOf(after);
    const worldBefore = rotatePoint(anchor, pivotBefore, angle);
    const worldAfter = rotatePoint(anchor, pivotAfter, angle);
    expect(worldAfter.x + d.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y + d.y).toBeCloseTo(worldBefore.y, 9);
  });
});

describe("applyRotation", () => {
  it("returns the same reference when the normalized angle is unchanged", () => {
    const r = rect({ x: 0, y: 0 }, { x: 10, y: 10 });
    expect(applyRotation(r, 0)).toBe(r);
    const r2 = { ...r, angle: 0.5 };
    expect(applyRotation(r2, 0.5)).toBe(r2);
  });

  it("returns a new object with the normalized angle when changed", () => {
    const r = rect({ x: 0, y: 0 }, { x: 10, y: 10 });
    const result = applyRotation(r, Math.PI * 3); // normalizes to PI
    expect(result).not.toBe(r);
    expect((result as RectAnnotation & { angle?: number }).angle).toBeCloseTo(Math.PI);
  });

  it("never mutates the input", () => {
    const r = rect({ x: 0, y: 0 }, { x: 10, y: 10 });
    const before = structuredClone(r);
    applyRotation(r, 1.2);
    expect(r).toEqual(before);
  });
});
