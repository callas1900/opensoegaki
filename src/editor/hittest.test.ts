import { describe, it, expect } from "vitest";
import { hitTest } from "./hittest";
import type { ArrowAnnotation, RectAnnotation, TextAnnotation, HighlighterAnnotation, BadgeAnnotation, ImageAnnotation, Annotation } from "./model";
import { HIGHLIGHTER_WIDTH_SCALE } from "./model";
import { pivotOfAnnotation, rotatePoint } from "./rotate";

// Trivial fake 2D context: only `font` (settable) and `measureText` are used
// by hittest.ts, so this is all boundsOf's text branch needs.
const measure = {
  font: "",
  measureText: (t: string) => ({ width: t.length * 10 }),
} as unknown as CanvasRenderingContext2D;

function arrow(from: { x: number; y: number }, to: { x: number; y: number }, strokeWidth = 6): ArrowAnnotation {
  return { id: "arrow1", kind: "arrow", color: "#e8465a", strokeWidth, from, to };
}

function rect(a: { x: number; y: number }, b: { x: number; y: number }, strokeWidth = 4): RectAnnotation {
  return { id: "rect1", kind: "rect", color: "#2f7de1", strokeWidth, a, b };
}

function text(at: { x: number; y: number }, str: string, fontSize = 20): TextAnnotation {
  return { id: "text1", kind: "text", color: "#222222", strokeWidth: 1, at, text: str, fontSize };
}

function highlight(points: { x: number; y: number }[], strokeWidth = 6): HighlighterAnnotation {
  return { id: "highlight1", kind: "highlight", color: "#FBB034", strokeWidth, points };
}

function badge(at: { x: number; y: number }, radius = 20): BadgeAnnotation {
  return { id: "badge1", kind: "badge", color: "#ED107B", strokeWidth: 6, at, number: 1, radius };
}

function image(at: { x: number; y: number }, width: number, height: number): ImageAnnotation {
  return { id: "image1", kind: "image", color: "#000000", strokeWidth: 1, at, width, height };
}

describe("hitTest arrow", () => {
  it("a point on the shaft within tolerance hits", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });
    const result = hitTest([a], { x: 50, y: 1 }, measure, 5);
    expect(result).toBe(a);
  });

  it("a far point misses", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });
    const result = hitTest([a], { x: 50, y: 500 }, measure, 5);
    expect(result).toBeNull();
  });

  it("a point just past an endpoint within tolerance + strokeWidth/2 hits", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    // tolerance 5 + strokeWidth/2 5 = 10 allowed past the endpoint.
    const result = hitTest([a], { x: 108, y: 0 }, measure, 5);
    expect(result).toBe(a);
  });
});

describe("hitTest rect", () => {
  it("a point near the perimeter hits", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const result = hitTest([r], { x: 0, y: 50 }, measure, 5);
    expect(result).toBe(r);
  });

  it("a point in the hollow center misses", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const result = hitTest([r], { x: 50, y: 50 }, measure, 5);
    expect(result).toBeNull();
  });

  it("a degenerate thin rect falls back to a filled hit", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 1 }, 0);
    const result = hitTest([r], { x: 50, y: 0.5 }, measure, 1);
    expect(result).toBe(r);
  });
});

describe("hitTest text", () => {
  it("a point inside the inflated bbox hits", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const result = hitTest([t], { x: 5, y: 10 }, measure, 5);
    expect(result).toBe(t);
  });

  it("a point outside misses", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const result = hitTest([t], { x: 500, y: 500 }, measure, 5);
    expect(result).toBeNull();
  });
});

describe("hitTest highlight", () => {
  const strokeWidth = 6;
  const tol = 5;
  const threshold = tol + (strokeWidth * HIGHLIGHTER_WIDTH_SCALE) / 2; // 5 + 9 = 14

  it("a point on the middle segment hits", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], strokeWidth);
    const result = hitTest([h], { x: 75, y: 0 }, measure, tol);
    expect(result).toBe(h);
  });

  it("a far point misses", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], strokeWidth);
    const result = hitTest([h], { x: 75, y: 1000 }, measure, tol);
    expect(result).toBeNull();
  });

  it("a point offset from a segment by just under tolerance + strokeWidth*3/2 hits", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], strokeWidth);
    const result = hitTest([h], { x: 75, y: threshold - 0.1 }, measure, tol);
    expect(result).toBe(h);
  });
});

// Manual (fixed-number) badge hit-testing/bounds (TASK-38) is not covered
// here: it routes through render.ts's `badgeHalfWidth`, which lazily creates
// a real offscreen <canvas> to measure text — unavailable in this suite's
// `environment: "node"` (vitest.config.ts), and not worth heavy-mocking
// `document`/canvas just for this. Auto badges (below) are unaffected and
// keep the same fake `measure` fixture as every other kind.
describe("hitTest badge", () => {
  it("the center hits", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const result = hitTest([b], { x: 50, y: 50 }, measure, 5);
    expect(result).toBe(b);
  });

  it("a point just inside radius + tolerance hits", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const result = hitTest([b], { x: 50 + 24.9, y: 50 }, measure, 5);
    expect(result).toBe(b);
  });

  it("a point well outside misses", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const result = hitTest([b], { x: 500, y: 500 }, measure, 5);
    expect(result).toBeNull();
  });
});

// TASK-41: hitsAnnotation inverse-rotates the pointer about the pivot before
// the unchanged per-kind test above, for every kind (not just the ones with
// a rotate-handle affordance — see rotate.ts's canRotate). Constructed via
// rotatePoint so these tests don't depend on the exact per-kind bounds math,
// only on the round-trip: a local-frame point that hits at angle 0 must hit
// at its rotated world position for any angle, and the pre-rotation world
// position must miss once the shape has actually rotated away from it.
describe("hitTest with rotation", () => {
  it("rect: a local-frame perimeter point still hits at its rotated world position", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 50 }, 4);
    const angle = Math.PI / 2;
    const pivot = pivotOfAnnotation(r, measure);
    const localHitPoint = { x: 50, y: 0 }; // top-edge midpoint, on the unrotated perimeter
    const worldPoint = rotatePoint(localHitPoint, pivot, angle);
    const rotated: RectAnnotation = { ...r, angle };
    expect(hitTest([rotated], worldPoint, measure, 5)).toBe(rotated);
  });

  it("rect: the pre-rotation world position no longer hits once rotated", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 50 }, 4);
    const localHitPoint = { x: 50, y: 0 };
    const rotated: RectAnnotation = { ...r, angle: Math.PI / 2 };
    expect(hitTest([rotated], localHitPoint, measure, 5)).toBeNull();
  });

  it("text: a local-frame bbox point still hits at its rotated world position", () => {
    const t = text({ x: 0, y: 0 }, "hello", 20); // bounds w=50,h=24
    const angle = Math.PI / 3;
    const pivot = pivotOfAnnotation(t, measure);
    const localHitPoint = { x: 10, y: 10 };
    const worldPoint = rotatePoint(localHitPoint, pivot, angle);
    const rotated: TextAnnotation = { ...t, angle };
    expect(hitTest([rotated], worldPoint, measure, 5)).toBe(rotated);
  });

  it("image: a local-frame bbox point still hits at its rotated world position", () => {
    const img = image({ x: 10, y: 10 }, 80, 40);
    const angle = -0.9;
    const pivot = pivotOfAnnotation(img, measure);
    const localHitPoint = { x: 20, y: 20 };
    const worldPoint = rotatePoint(localHitPoint, pivot, angle);
    const rotated: ImageAnnotation = { ...img, angle };
    expect(hitTest([rotated], worldPoint, measure, 5)).toBe(rotated);
  });

  it("badge: rotation around its own center leaves the circular hit region unchanged", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const rotated: BadgeAnnotation = { ...b, angle: Math.PI / 4 };
    expect(hitTest([rotated], { x: 50, y: 50 }, measure, 5)).toBe(rotated);
    expect(hitTest([rotated], { x: 50 + 24.9, y: 50 }, measure, 5)).toBe(rotated);
  });

  it("angle: 0 explicit behaves identically to angle absent", () => {
    const r1 = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const r2: RectAnnotation = { ...r1, angle: 0 };
    expect(hitTest([r1], { x: 0, y: 50 }, measure, 5)).toBe(r1);
    expect(hitTest([r2], { x: 0, y: 50 }, measure, 5)).toBe(r2);
  });
});

describe("hitTest topmost-first", () => {
  it("returns the last annotation in the list when overlapping", () => {
    const bottom = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const top = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const list: Annotation[] = [bottom, top];
    const result = hitTest(list, { x: 0, y: 50 }, measure, 5);
    expect(result).toBe(top);
  });

  it("empty list returns null", () => {
    expect(hitTest([], { x: 0, y: 0 }, measure, 5)).toBeNull();
  });
});
