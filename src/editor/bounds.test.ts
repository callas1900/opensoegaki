import { describe, it, expect } from "vitest";
import { boundsOf } from "./bounds";
import type { ArrowAnnotation, RectAnnotation, TextAnnotation, HighlighterAnnotation, BadgeAnnotation, MagnifierAnnotation } from "./model";

// Trivial fake 2D context: only `font` (settable) and `measureText` are used
// by boundsOf's text branch, same fixture as hittest.test.ts/resize.test.ts.
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

function magnifier(at: { x: number; y: number }, radius = 40, from = { x: 0, y: 0 }, zoom = 3): MagnifierAnnotation {
  return { id: "magnifier1", kind: "magnifier", color: "#ED107B", strokeWidth: 6, at, radius, zoom, from };
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

  it("highlight: bounding box over all points", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 5, y: 5 }]);
    expect(boundsOf(h, measure)).toEqual({ x: 0, y: 0, w: 10, h: 40 });
  });

  it("badge: bounding box centered on `at` with side 2*radius", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    expect(boundsOf(b, measure)).toEqual({ x: 30, y: 30, w: 40, h: 40 });
  });

  it("magnifier: bounding box is the LENS circle's bounding square, centered on `at` with side 2*radius — the source circle plays no part", () => {
    const m = magnifier({ x: 100, y: 80 }, 40, { x: 900, y: 900 }, 5);
    expect(boundsOf(m, measure)).toEqual({ x: 60, y: 40, w: 80, h: 80 });
  });

  it("magnifier: bounds are unaffected by `from`/`zoom` (the source circle is a satellite, not part of these bounds)", () => {
    const near = magnifier({ x: 100, y: 80 }, 40, { x: 110, y: 90 }, 5);
    const far = magnifier({ x: 100, y: 80 }, 40, { x: -5000, y: 5000 }, 1.5);
    expect(boundsOf(near, measure)).toEqual(boundsOf(far, measure));
  });
});
