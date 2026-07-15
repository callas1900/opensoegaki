import { describe, it, expect } from "vitest";
import { boundsOf, hitTest } from "./hittest";
import type { ArrowAnnotation, RectAnnotation, TextAnnotation, Annotation } from "./model";

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

describe("boundsOf", () => {
  it("arrow: normalized bounds regardless of corner order", () => {
    const a1 = arrow({ x: 10, y: 20 }, { x: 30, y: 5 });
    const a2 = arrow({ x: 30, y: 5 }, { x: 10, y: 20 });
    expect(boundsOf(a1, measure)).toEqual({ x: 10, y: 5, w: 20, h: 15 });
    expect(boundsOf(a2, measure)).toEqual(boundsOf(a1, measure));
  });

  it("rect: normalized bounds regardless of corner order", () => {
    const r1 = rect({ x: 0, y: 0 }, { x: 40, y: 25 });
    const r2 = rect({ x: 40, y: 25 }, { x: 0, y: 0 });
    expect(boundsOf(r1, measure)).toEqual({ x: 0, y: 0, w: 40, h: 25 });
    expect(boundsOf(r2, measure)).toEqual(boundsOf(r1, measure));
  });

  it("text: x/y === at, w === text.length*10, h === fontSize*1.2", () => {
    const t = text({ x: 5, y: 7 }, "hello", 20);
    const b = boundsOf(t, measure);
    expect(b.x).toBe(5);
    expect(b.y).toBe(7);
    expect(b.w).toBe(50);
    expect(b.h).toBe(24);
  });
});

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
