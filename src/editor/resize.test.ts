import { describe, it, expect } from "vitest";
import {
  resizeHandlesFor,
  handleAt,
  applyResize,
  MIN_RECT_PX,
  MIN_IMAGE_PX,
  MIN_ARROW_LEN,
  MIN_TEXT_FONT_SIZE,
  MAX_TEXT_FONT_SIZE,
  MIN_BADGE_RADIUS,
  MAX_BADGE_RADIUS,
  type HandleSpec,
} from "./resize";
import { boundsOf, type Bounds } from "./hittest";
import type {
  ArrowAnnotation,
  RectAnnotation,
  TextAnnotation,
  HighlighterAnnotation,
  BadgeAnnotation,
  ImageAnnotation,
} from "./model";

// Trivial fake 2D context, same pattern as hittest.test.ts: only `font`
// (settable) and `measureText` are used by boundsOf's text branch.
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

function byId(handles: HandleSpec[], id: string): HandleSpec["pos"] {
  const h = handles.find((h) => h.id === id);
  if (!h) throw new Error(`handle ${id} not found`);
  return h.pos;
}

describe("resizeHandlesFor", () => {
  it("rect: 8 handles (4 corners + 4 edge midpoints) at the expected positions", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 50 });
    const b = boundsOf(r, measure);
    const handles = resizeHandlesFor(r, b);
    expect(handles).toHaveLength(8);
    expect(byId(handles, "nw")).toEqual({ x: 0, y: 0 });
    expect(byId(handles, "ne")).toEqual({ x: 100, y: 0 });
    expect(byId(handles, "sw")).toEqual({ x: 0, y: 50 });
    expect(byId(handles, "se")).toEqual({ x: 100, y: 50 });
    expect(byId(handles, "n")).toEqual({ x: 50, y: 0 });
    expect(byId(handles, "s")).toEqual({ x: 50, y: 50 });
    expect(byId(handles, "w")).toEqual({ x: 0, y: 25 });
    expect(byId(handles, "e")).toEqual({ x: 100, y: 25 });
  });

  it("image: 8 handles, same layout as rect", () => {
    const img = image({ x: 10, y: 10 }, 80, 40);
    const b = boundsOf(img, measure);
    const handles = resizeHandlesFor(img, b);
    expect(handles).toHaveLength(8);
    expect(byId(handles, "nw")).toEqual({ x: 10, y: 10 });
    expect(byId(handles, "se")).toEqual({ x: 90, y: 50 });
  });

  it("arrow: 2 handles at from/to, taken from the annotation itself (not normalized bounds)", () => {
    const a = arrow({ x: 30, y: 40 }, { x: 5, y: 2 });
    const b = boundsOf(a, measure);
    const handles = resizeHandlesFor(a, b);
    expect(handles).toHaveLength(2);
    expect(byId(handles, "from")).toEqual({ x: 30, y: 40 });
    expect(byId(handles, "to")).toEqual({ x: 5, y: 2 });
  });

  it("text: 4 corner handles only", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const b = boundsOf(t, measure);
    const handles = resizeHandlesFor(t, b);
    expect(handles.map((h) => h.id).sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect(byId(handles, "nw")).toEqual({ x: b.x, y: b.y });
    expect(byId(handles, "se")).toEqual({ x: b.x + b.w, y: b.y + b.h });
  });

  it("badge: 4 corner handles only, positioned from the bounding box", () => {
    const bd = badge({ x: 50, y: 50 }, 20);
    const b = boundsOf(bd, measure);
    const handles = resizeHandlesFor(bd, b);
    expect(handles.map((h) => h.id).sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect(byId(handles, "nw")).toEqual({ x: 30, y: 30 });
    expect(byId(handles, "se")).toEqual({ x: 70, y: 70 });
  });

  it("highlight: no handles", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const b = boundsOf(h, measure);
    expect(resizeHandlesFor(h, b)).toEqual([]);
  });
});

describe("handleAt", () => {
  const r = rect({ x: 100, y: 100 }, { x: 300, y: 250 });
  const b = boundsOf(r, measure);
  const handles = resizeHandlesFor(r, b);
  const HIT_RADIUS = 12;

  it("finds a corner handle within radius", () => {
    expect(handleAt(handles, { x: 103, y: 97 }, HIT_RADIUS)).toBe("nw");
  });

  it("finds an edge handle within radius", () => {
    expect(handleAt(handles, { x: 200, y: 103 }, HIT_RADIUS)).toBe("n");
  });

  it("returns null outside every handle's radius", () => {
    expect(handleAt(handles, { x: 200, y: 175 }, HIT_RADIUS)).toBeNull();
  });

  it("returns the nearest handle when two are within radius", () => {
    // Between nw (100,100) and n (200,100) but much closer to nw.
    expect(handleAt(handles, { x: 105, y: 100 }, HIT_RADIUS)).toBe("nw");
  });
});

describe("applyResize: rect", () => {
  const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 });
  const b: Bounds = boundsOf(r, measure);

  it("se corner drag pins nw, resizes freely", () => {
    const result = applyResize(r, b, "se", { x: 150, y: 80 }, false) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 150, y: 80 });
  });

  it("nw corner drag pins se", () => {
    const result = applyResize(r, b, "nw", { x: -20, y: 30 }, false) as RectAnnotation;
    expect(result.a).toEqual({ x: -20, y: 30 });
    expect(result.b).toEqual({ x: 100, y: 100 });
  });

  it("e edge drag moves only the east edge", () => {
    const result = applyResize(r, b, "e", { x: 200, y: 999 }, false) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 200, y: 100 });
  });

  it("n edge drag moves only the north edge", () => {
    const result = applyResize(r, b, "n", { x: 999, y: -50 }, false) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: -50 });
    expect(result.b).toEqual({ x: 100, y: 100 });
  });

  it("clamps to MIN_RECT_PX per axis instead of flipping past the pinned corner", () => {
    const result = applyResize(r, b, "se", { x: -500, y: -500 }, false) as RectAnnotation;
    expect(result.b.x - result.a.x).toBeCloseTo(MIN_RECT_PX);
    expect(result.b.y - result.a.y).toBeCloseTo(MIN_RECT_PX);
    expect(result.a).toEqual({ x: 0, y: 0 });
  });

  it("Shift on a corner locks the pre-drag aspect ratio (2:1 rect stays 2:1)", () => {
    const wide = rect({ x: 0, y: 0 }, { x: 200, y: 100 }); // 2:1
    const wb = boundsOf(wide, measure);
    const result = applyResize(wide, wb, "se", { x: 400, y: 260 }, true) as RectAnnotation;
    const w = result.b.x - result.a.x;
    const h = result.b.y - result.a.y;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(w / h).toBeCloseTo(2, 5);
  });

  it("Shift on an edge handle is ignored (edges have no aspect concept)", () => {
    const result = applyResize(r, b, "e", { x: 300, y: 0 }, true) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 300, y: 100 });
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(r);
    applyResize(r, b, "se", { x: 500, y: 500 }, false);
    expect(r).toEqual(before);
  });
});

describe("applyResize: image", () => {
  const img = image({ x: 0, y: 0 }, 200, 100); // 2:1
  const b = boundsOf(img, measure);

  it("corner drag is aspect-locked by default", () => {
    const result = applyResize(img, b, "se", { x: 500, y: 260 }, false) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width / result.height).toBeCloseTo(2, 5);
  });

  it("Shift on a corner frees the aspect ratio", () => {
    const result = applyResize(img, b, "se", { x: 400, y: 500 }, true) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width).toBeCloseTo(400);
    expect(result.height).toBeCloseTo(500);
  });

  it("edge drag is single-axis regardless of Shift", () => {
    const result = applyResize(img, b, "s", { x: 999, y: 400 }, false) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width).toBe(200);
    expect(result.height).toBe(400);
  });

  it("clamps to at least MIN_IMAGE_PX per axis when dragged back past the anchor, keeping aspect and the pinned corner fixed", () => {
    // img is 2:1; dragging se past the nw anchor should shrink toward the
    // minimum, not grow in the wrong direction. Aspect-locked, so the axis
    // requiring the larger scale to reach MIN_IMAGE_PX (height, 1:1 vs
    // width's 2:1) wins: height clamps exactly to MIN_IMAGE_PX, width is
    // proportionally larger.
    const result = applyResize(img, b, "se", { x: -500, y: -500 }, false) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.height).toBeCloseTo(MIN_IMAGE_PX);
    expect(result.width).toBeCloseTo(MIN_IMAGE_PX * 2);
    expect(result.width / result.height).toBeCloseTo(2, 5);
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(img);
    applyResize(img, b, "se", { x: 500, y: 500 }, true);
    expect(img).toEqual(before);
  });
});

describe("applyResize: arrow", () => {
  const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });

  it("dragging 'to' follows the pointer, leaving 'from' fixed", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 40, y: 80 }, false) as ArrowAnnotation;
    expect(result.from).toEqual({ x: 0, y: 0 });
    expect(result.to).toEqual({ x: 40, y: 80 });
  });

  it("dragging 'from' follows the pointer, leaving 'to' fixed", () => {
    const result = applyResize(a, boundsOf(a, measure), "from", { x: -30, y: -10 }, false) as ArrowAnnotation;
    expect(result.to).toEqual({ x: 100, y: 0 });
    expect(result.from).toEqual({ x: -30, y: -10 });
  });

  it("Shift snaps the dragged endpoint's angle to 45° increments, keeping magnitude", () => {
    // Pointer near-horizontal-ish but slightly off (dist=100 from origin at ~5.7deg) should snap to 0deg (100,0).
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 99.5, y: 10 }, true) as ArrowAnnotation;
    expect(result.to.y).toBeCloseTo(0, 5);
    expect(result.to.x).toBeGreaterThan(90);
  });

  it("Shift snaps a diagonal-ish drag to exactly 45°, preserving the pointer's own distance from the fixed endpoint", () => {
    // Angle slightly off 45deg; magnitude is the pointer's distance from
    // `from` (0,0), not the original arrow's length.
    const dist = Math.hypot(72, 68);
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 72, y: 68 }, true) as ArrowAnnotation;
    expect(result.to.x).toBeCloseTo(dist * Math.SQRT1_2, 5);
    expect(result.to.y).toBeCloseTo(dist * Math.SQRT1_2, 5);
  });

  it("clamps an update that would make the endpoints closer than MIN_ARROW_LEN", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 1, y: 0 }, false) as ArrowAnnotation;
    const dist = Math.hypot(result.to.x - result.from.x, result.to.y - result.from.y);
    expect(dist).toBeCloseTo(MIN_ARROW_LEN, 5);
  });

  it("rejects an update where the pointer lands exactly on the fixed endpoint", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 0, y: 0 }, false) as ArrowAnnotation;
    expect(result.to).toEqual({ x: 100, y: 0 }); // unchanged (pre-drag position)
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(a);
    applyResize(a, boundsOf(a, measure), "to", { x: 500, y: 500 }, true);
    expect(a).toEqual(before);
  });
});

describe("applyResize: text", () => {
  const t = text({ x: 0, y: 0 }, "hello", 20); // bounds: x0 y0 w50 h24

  it("se corner drag scales fontSize by vertical ratio from the pinned nw corner", () => {
    const b = boundsOf(t, measure);
    // pointer.y = 48 => scale = |48 - 0| / 24 = 2 => fontSize' = 40
    const result = applyResize(t, b, "se", { x: 999, y: 48 }, false) as TextAnnotation;
    expect(result.fontSize).toBe(40);
    // pinned corner (nw) stays fixed.
    expect(result.at).toEqual({ x: 0, y: 0 });
  });

  it("nw corner drag scales relative to the pinned se corner and repositions `at`", () => {
    const b = boundsOf(t, measure); // se = (50, 24)
    // pointer.y = 0 => scale = |0 - 24| / 24 = 1 (no-op scale)
    const result = applyResize(t, b, "nw", { x: 0, y: 0 }, false) as TextAnnotation;
    expect(result.fontSize).toBe(20);
    expect(result.at).toEqual({ x: 0, y: 0 });
  });

  it("clamps fontSize to MIN_TEXT_FONT_SIZE and recomputes at from the pinned corner", () => {
    const b = boundsOf(t, measure);
    // pointer.y very close to pinned corner => tiny scale, fontSize clamps to MIN_TEXT_FONT_SIZE.
    const result = applyResize(t, b, "se", { x: 999, y: 0.1 }, false) as TextAnnotation;
    expect(result.fontSize).toBe(MIN_TEXT_FONT_SIZE);
  });

  it("clamps fontSize to MAX_TEXT_FONT_SIZE", () => {
    const b = boundsOf(t, measure);
    const result = applyResize(t, b, "se", { x: 999, y: 100000 }, false) as TextAnnotation;
    expect(result.fontSize).toBe(MAX_TEXT_FONT_SIZE);
  });

  it("clamps to MIN_TEXT_FONT_SIZE (not growing again) when the pointer crosses back past the pinned corner", () => {
    const b = boundsOf(t, measure); // pinned corner for "se" is nw = (0, 0)
    // pointer.y = -50 is on the far side of the pinned nw corner (y < 0): the
    // outward (south) distance is negative, so this must clamp to the
    // minimum, not grow fontSize via an unsigned |pointer.y - pinnedY|.
    const result = applyResize(t, b, "se", { x: 999, y: -50 }, false) as TextAnnotation;
    expect(result.fontSize).toBe(MIN_TEXT_FONT_SIZE);
    expect(result.at).toEqual({ x: 0, y: 0 }); // pinned nw corner still fixed
  });

  it("Shift has no special effect on text resize", () => {
    const b = boundsOf(t, measure);
    const withShift = applyResize(t, b, "se", { x: 999, y: 48 }, true) as TextAnnotation;
    const withoutShift = applyResize(t, b, "se", { x: 999, y: 48 }, false) as TextAnnotation;
    expect(withShift).toEqual(withoutShift);
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(t, measure);
    const before = structuredClone(t);
    applyResize(t, b, "se", { x: 999, y: 999 }, false);
    expect(t).toEqual(before);
  });
});

describe("applyResize: badge", () => {
  const bd = badge({ x: 50, y: 50 }, 20);

  it("radius tracks the max axis distance from the fixed center", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 90, y: 66 }, false) as BadgeAnnotation;
    expect(result.radius).toBe(40); // max(|90-50|, |66-50|) = 40
    expect(result.at).toEqual({ x: 50, y: 50 });
    expect(result.number).toBe(1);
  });

  it("clamps radius to MIN_BADGE_RADIUS", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 51, y: 50 }, false) as BadgeAnnotation;
    expect(result.radius).toBe(MIN_BADGE_RADIUS);
  });

  it("clamps radius to MAX_BADGE_RADIUS", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 5000, y: 50 }, false) as BadgeAnnotation;
    expect(result.radius).toBe(MAX_BADGE_RADIUS);
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(bd, measure);
    const before = structuredClone(bd);
    applyResize(bd, b, "se", { x: 500, y: 500 }, false);
    expect(bd).toEqual(before);
  });
});

describe("applyResize: highlight", () => {
  it("returns the original annotation unchanged (resize-exempt)", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const b = boundsOf(h, measure);
    const result = applyResize(h, b, "se" as never, { x: 500, y: 500 }, false);
    expect(result).toBe(h);
  });
});
