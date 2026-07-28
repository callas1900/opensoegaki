import { describe, it, expect } from "vitest";
import {
  resizeHandlesFor,
  handleAt,
  nearestHandle,
  applyResize,
  rotateHandleFor,
  anchorPointFor,
  MIN_RECT_PX,
  MIN_IMAGE_PX,
  MIN_ARROW_LEN,
  MIN_TEXT_FONT_SIZE,
  MAX_TEXT_FONT_SIZE,
  MIN_BADGE_RADIUS,
  MAX_BADGE_RADIUS,
  MAGNIFIER_ZOOM_HANDLE_ANGLE,
  type HandleSpec,
} from "./resize";
import { boundsOf, type Bounds } from "./bounds";
import { pivotOf, reanchorDelta, rotatePoint, unrotatePoint } from "./rotate";
import { translateAnnotation } from "./model";
import type {
  ArrowAnnotation,
  RectAnnotation,
  TextAnnotation,
  HighlighterAnnotation,
  BadgeAnnotation,
  ImageAnnotation,
  MagnifierAnnotation,
} from "./model";
import { magnifierSizeLimits, MIN_MAGNIFIER_ZOOM } from "./magnifier";

// Shared limits for every applyResize call in this file (Addendum B,
// 2026-08-02: applyResize's 6th parameter is required). scale=1 (no CSS
// scaling), 1000x800 canvas -> shortSide=800: minSource = min(16, 120) = 16,
// maxLens = 0.45*800 = 360, minLens = min(28, 360) = 28. Only the magnifier
// tests below actually read these values; every other kind's applyResize
// call ignores the parameter (see applyResize's doc comment).
const TEST_LIMITS = magnifierSizeLimits({ w: 1000, h: 800 }, 1);

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

function magnifier(
  at: { x: number; y: number },
  radius = 60,
  from: { x: number; y: number } = { x: 50, y: 50 },
  zoom = 3,
  strokeWidth = 6,
): MagnifierAnnotation {
  return { id: "magnifier1", kind: "magnifier", color: "#ED107B", strokeWidth, at, radius, zoom, from };
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

  it("magnifier: 6 handles — src-move and src-zoom (circles) FIRST, then the 4 lens corners (squares) on the lens bounding box", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3); // sourceRadius = 20
    const b = boundsOf(m, measure); // lens bounding square: x140 y90 w120 h120
    const handles = resizeHandlesFor(m, b);
    expect(handles.map((h) => h.id)).toEqual(["src-move", "src-zoom", "nw", "ne", "sw", "se"]);

    expect(handles[0]).toEqual({ id: "src-move", pos: { x: 50, y: 50 }, shape: "circle" });
    const srcZoom = handles[1];
    expect(srcZoom.shape).toBe("circle");
    expect(srcZoom.pos.x).toBeCloseTo(50 + 20 * Math.cos(MAGNIFIER_ZOOM_HANDLE_ANGLE));
    expect(srcZoom.pos.y).toBeCloseTo(50 + 20 * Math.sin(MAGNIFIER_ZOOM_HANDLE_ANGLE));

    expect(byId(handles, "nw")).toEqual({ x: 140, y: 90 });
    expect(byId(handles, "se")).toEqual({ x: 260, y: 210 });
    // Corner handles don't opt into the circle shape (default/undefined = square).
    expect(handles.find((h) => h.id === "nw")!.shape).toBeUndefined();
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

// TASK-41 round 2: nearestHandle is the one owner of "nearest handle within
// radius, plus how far" — handleAt (above) is now a thin delegate to it, and
// canvas.ts's knob-vs-resize-handle tie-break (rotateOrResizeTarget) is built
// on it directly.
describe("nearestHandle", () => {
  const r = rect({ x: 100, y: 100 }, { x: 300, y: 250 });
  const b = boundsOf(r, measure);
  const handles = resizeHandlesFor(r, b);
  const HIT_RADIUS = 12;

  it("returns the nearest handle's id and its distance", () => {
    const result = nearestHandle(handles, { x: 103, y: 97 }, HIT_RADIUS);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("nw");
    expect(result!.dist).toBeCloseTo(Math.hypot(3, 3), 5);
  });

  it("returns null outside every handle's radius", () => {
    expect(nearestHandle(handles, { x: 200, y: 175 }, HIT_RADIUS)).toBeNull();
  });

  it("tie-break: the strictly nearer of two in-radius handles wins", () => {
    // Between nw (100,100) and n (200,100) but much closer to nw.
    const result = nearestHandle(handles, { x: 105, y: 100 }, HIT_RADIUS);
    expect(result!.id).toBe("nw");
    expect(result!.dist).toBeCloseTo(5, 5);
  });

  it("a handle exactly at hitRadius is excluded (strict less-than, matches the pre-existing handleAt semantics)", () => {
    expect(nearestHandle(handles, { x: 100 + HIT_RADIUS, y: 100 }, HIT_RADIUS)).toBeNull();
  });

  it("handleAt returns exactly nearestHandle's id (thin-delegate semantics unchanged)", () => {
    expect(handleAt(handles, { x: 103, y: 97 }, HIT_RADIUS)).toBe(nearestHandle(handles, { x: 103, y: 97 }, HIT_RADIUS)?.id ?? null);
    expect(handleAt(handles, { x: 200, y: 175 }, HIT_RADIUS)).toBeNull();
  });

  // Magnifier's `src-move` is deliberately listed FIRST in resizeHandlesFor
  // (design note) so it wins EXACT ties against another handle at the same
  // distance — this pins the underlying nearestHandle property that ordering
  // relies on: iterating in list order with a strict `<` comparison means an
  // exact tie always favors the earlier-listed handle.
  it("exact tie between two handles at equal distance: the earlier-listed one wins", () => {
    const tieHandles: HandleSpec[] = [
      { id: "src-move", pos: { x: 50, y: 50 }, shape: "circle" },
      { id: "nw", pos: { x: 140, y: 90 } },
    ];
    const midpoint = { x: 95, y: 70 }; // equidistant from both by construction
    const result = nearestHandle(tieHandles, midpoint, 60);
    expect(result!.id).toBe("src-move");

    // Reversing the list order flips the winner — confirms the tie-break is
    // purely "first in iteration order", not some position-based rule.
    const reversed: HandleSpec[] = [tieHandles[1], tieHandles[0]];
    expect(nearestHandle(reversed, midpoint, 60)!.id).toBe("nw");
  });
});

describe("applyResize: rect", () => {
  const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 });
  const b: Bounds = boundsOf(r, measure);

  it("se corner drag pins nw, resizes freely", () => {
    const result = applyResize(r, b, "se", { x: 150, y: 80 }, false, TEST_LIMITS) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 150, y: 80 });
  });

  it("nw corner drag pins se", () => {
    const result = applyResize(r, b, "nw", { x: -20, y: 30 }, false, TEST_LIMITS) as RectAnnotation;
    expect(result.a).toEqual({ x: -20, y: 30 });
    expect(result.b).toEqual({ x: 100, y: 100 });
  });

  it("e edge drag moves only the east edge", () => {
    const result = applyResize(r, b, "e", { x: 200, y: 999 }, false, TEST_LIMITS) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 200, y: 100 });
  });

  it("n edge drag moves only the north edge", () => {
    const result = applyResize(r, b, "n", { x: 999, y: -50 }, false, TEST_LIMITS) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: -50 });
    expect(result.b).toEqual({ x: 100, y: 100 });
  });

  it("clamps to MIN_RECT_PX per axis instead of flipping past the pinned corner", () => {
    const result = applyResize(r, b, "se", { x: -500, y: -500 }, false, TEST_LIMITS) as RectAnnotation;
    expect(result.b.x - result.a.x).toBeCloseTo(MIN_RECT_PX);
    expect(result.b.y - result.a.y).toBeCloseTo(MIN_RECT_PX);
    expect(result.a).toEqual({ x: 0, y: 0 });
  });

  it("Shift on a corner locks the pre-drag aspect ratio (2:1 rect stays 2:1)", () => {
    const wide = rect({ x: 0, y: 0 }, { x: 200, y: 100 }); // 2:1
    const wb = boundsOf(wide, measure);
    const result = applyResize(wide, wb, "se", { x: 400, y: 260 }, true, TEST_LIMITS) as RectAnnotation;
    const w = result.b.x - result.a.x;
    const h = result.b.y - result.a.y;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(w / h).toBeCloseTo(2, 5);
  });

  it("Shift on an edge handle is ignored (edges have no aspect concept)", () => {
    const result = applyResize(r, b, "e", { x: 300, y: 0 }, true, TEST_LIMITS) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 300, y: 100 });
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(r);
    applyResize(r, b, "se", { x: 500, y: 500 }, false, TEST_LIMITS);
    expect(r).toEqual(before);
  });
});

describe("applyResize: image", () => {
  const img = image({ x: 0, y: 0 }, 200, 100); // 2:1
  const b = boundsOf(img, measure);

  it("corner drag is aspect-locked by default", () => {
    const result = applyResize(img, b, "se", { x: 500, y: 260 }, false, TEST_LIMITS) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width / result.height).toBeCloseTo(2, 5);
  });

  it("Shift on a corner frees the aspect ratio", () => {
    const result = applyResize(img, b, "se", { x: 400, y: 500 }, true, TEST_LIMITS) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width).toBeCloseTo(400);
    expect(result.height).toBeCloseTo(500);
  });

  it("edge drag is single-axis regardless of Shift", () => {
    const result = applyResize(img, b, "s", { x: 999, y: 400 }, false, TEST_LIMITS) as ImageAnnotation;
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
    const result = applyResize(img, b, "se", { x: -500, y: -500 }, false, TEST_LIMITS) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.height).toBeCloseTo(MIN_IMAGE_PX);
    expect(result.width).toBeCloseTo(MIN_IMAGE_PX * 2);
    expect(result.width / result.height).toBeCloseTo(2, 5);
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(img);
    applyResize(img, b, "se", { x: 500, y: 500 }, true, TEST_LIMITS);
    expect(img).toEqual(before);
  });
});

describe("applyResize: arrow", () => {
  const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });

  it("dragging 'to' follows the pointer, leaving 'from' fixed", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 40, y: 80 }, false, TEST_LIMITS) as ArrowAnnotation;
    expect(result.from).toEqual({ x: 0, y: 0 });
    expect(result.to).toEqual({ x: 40, y: 80 });
  });

  it("dragging 'from' follows the pointer, leaving 'to' fixed", () => {
    const result = applyResize(a, boundsOf(a, measure), "from", { x: -30, y: -10 }, false, TEST_LIMITS) as ArrowAnnotation;
    expect(result.to).toEqual({ x: 100, y: 0 });
    expect(result.from).toEqual({ x: -30, y: -10 });
  });

  it("Shift snaps the dragged endpoint's angle to 45° increments, keeping magnitude", () => {
    // Pointer near-horizontal-ish but slightly off (dist=100 from origin at ~5.7deg) should snap to 0deg (100,0).
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 99.5, y: 10 }, true, TEST_LIMITS) as ArrowAnnotation;
    expect(result.to.y).toBeCloseTo(0, 5);
    expect(result.to.x).toBeGreaterThan(90);
  });

  it("Shift snaps a diagonal-ish drag to exactly 45°, preserving the pointer's own distance from the fixed endpoint", () => {
    // Angle slightly off 45deg; magnitude is the pointer's distance from
    // `from` (0,0), not the original arrow's length.
    const dist = Math.hypot(72, 68);
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 72, y: 68 }, true, TEST_LIMITS) as ArrowAnnotation;
    expect(result.to.x).toBeCloseTo(dist * Math.SQRT1_2, 5);
    expect(result.to.y).toBeCloseTo(dist * Math.SQRT1_2, 5);
  });

  it("clamps an update that would make the endpoints closer than MIN_ARROW_LEN", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 1, y: 0 }, false, TEST_LIMITS) as ArrowAnnotation;
    const dist = Math.hypot(result.to.x - result.from.x, result.to.y - result.from.y);
    expect(dist).toBeCloseTo(MIN_ARROW_LEN, 5);
  });

  it("rejects an update where the pointer lands exactly on the fixed endpoint", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 0, y: 0 }, false, TEST_LIMITS) as ArrowAnnotation;
    expect(result.to).toEqual({ x: 100, y: 0 }); // unchanged (pre-drag position)
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(a);
    applyResize(a, boundsOf(a, measure), "to", { x: 500, y: 500 }, true, TEST_LIMITS);
    expect(a).toEqual(before);
  });
});

describe("applyResize: text", () => {
  const t = text({ x: 0, y: 0 }, "hello", 20); // bounds: x0 y0 w50 h24

  it("se corner drag scales fontSize by vertical ratio from the pinned nw corner", () => {
    const b = boundsOf(t, measure);
    // pointer.y = 48 => scale = |48 - 0| / 24 = 2 => fontSize' = 40
    const result = applyResize(t, b, "se", { x: 999, y: 48 }, false, TEST_LIMITS) as TextAnnotation;
    expect(result.fontSize).toBe(40);
    // pinned corner (nw) stays fixed.
    expect(result.at).toEqual({ x: 0, y: 0 });
  });

  it("nw corner drag scales relative to the pinned se corner and repositions `at`", () => {
    const b = boundsOf(t, measure); // se = (50, 24)
    // pointer.y = 0 => scale = |0 - 24| / 24 = 1 (no-op scale)
    const result = applyResize(t, b, "nw", { x: 0, y: 0 }, false, TEST_LIMITS) as TextAnnotation;
    expect(result.fontSize).toBe(20);
    expect(result.at).toEqual({ x: 0, y: 0 });
  });

  it("clamps fontSize to MIN_TEXT_FONT_SIZE and recomputes at from the pinned corner", () => {
    const b = boundsOf(t, measure);
    // pointer.y very close to pinned corner => tiny scale, fontSize clamps to MIN_TEXT_FONT_SIZE.
    const result = applyResize(t, b, "se", { x: 999, y: 0.1 }, false, TEST_LIMITS) as TextAnnotation;
    expect(result.fontSize).toBe(MIN_TEXT_FONT_SIZE);
  });

  it("clamps fontSize to MAX_TEXT_FONT_SIZE", () => {
    const b = boundsOf(t, measure);
    const result = applyResize(t, b, "se", { x: 999, y: 100000 }, false, TEST_LIMITS) as TextAnnotation;
    expect(result.fontSize).toBe(MAX_TEXT_FONT_SIZE);
  });

  it("clamps to MIN_TEXT_FONT_SIZE (not growing again) when the pointer crosses back past the pinned corner", () => {
    const b = boundsOf(t, measure); // pinned corner for "se" is nw = (0, 0)
    // pointer.y = -50 is on the far side of the pinned nw corner (y < 0): the
    // outward (south) distance is negative, so this must clamp to the
    // minimum, not grow fontSize via an unsigned |pointer.y - pinnedY|.
    const result = applyResize(t, b, "se", { x: 999, y: -50 }, false, TEST_LIMITS) as TextAnnotation;
    expect(result.fontSize).toBe(MIN_TEXT_FONT_SIZE);
    expect(result.at).toEqual({ x: 0, y: 0 }); // pinned nw corner still fixed
  });

  it("Shift has no special effect on text resize", () => {
    const b = boundsOf(t, measure);
    const withShift = applyResize(t, b, "se", { x: 999, y: 48 }, true, TEST_LIMITS) as TextAnnotation;
    const withoutShift = applyResize(t, b, "se", { x: 999, y: 48 }, false, TEST_LIMITS) as TextAnnotation;
    expect(withShift).toEqual(withoutShift);
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(t, measure);
    const before = structuredClone(t);
    applyResize(t, b, "se", { x: 999, y: 999 }, false, TEST_LIMITS);
    expect(t).toEqual(before);
  });
});

describe("applyResize: badge", () => {
  const bd = badge({ x: 50, y: 50 }, 20);

  it("radius tracks the max axis distance from the fixed center", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 90, y: 66 }, false, TEST_LIMITS) as BadgeAnnotation;
    expect(result.radius).toBe(40); // max(|90-50|, |66-50|) = 40
    expect(result.at).toEqual({ x: 50, y: 50 });
    expect(result.number).toBe(1);
  });

  it("clamps radius to MIN_BADGE_RADIUS", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 51, y: 50 }, false, TEST_LIMITS) as BadgeAnnotation;
    expect(result.radius).toBe(MIN_BADGE_RADIUS);
  });

  it("clamps radius to MAX_BADGE_RADIUS", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 5000, y: 50 }, false, TEST_LIMITS) as BadgeAnnotation;
    expect(result.radius).toBe(MAX_BADGE_RADIUS);
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(bd, measure);
    const before = structuredClone(bd);
    applyResize(bd, b, "se", { x: 500, y: 500 }, false, TEST_LIMITS);
    expect(bd).toEqual(before);
  });
});

describe("applyResize: magnifier", () => {
  it("lens corner drag: center-pinned radius resize at fixed zoom (at/zoom/from unchanged)", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 260, y: 210 }, false, TEST_LIMITS) as MagnifierAnnotation;
    expect(result.radius).toBe(60); // max(|260-200|,|210-150|) = 60
    expect(result.at).toEqual({ x: 200, y: 150 });
    expect(result.zoom).toBe(3);
    expect(result.from).toEqual({ x: 50, y: 50 });
  });

  it("lens corner drag clamps to lo = max(limits.minLens, zoom * limits.minSource) — limits.minLens dominates at low zoom", () => {
    // TEST_LIMITS: minLens=28, minSource=16 -> zoom*minSource = 1.5*16 = 24 < minLens(28).
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 1.5);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 205, y: 155 }, false, TEST_LIMITS) as MagnifierAnnotation; // max(5,5)=5, below the floor
    expect(result.radius).toBe(TEST_LIMITS.minLens);
  });

  it("lens corner drag clamps to lo — the zoom*minSource term dominates at high zoom", () => {
    // zoom*minSource = 10*16 = 160 > minLens(28).
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 10);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 201, y: 151 }, false, TEST_LIMITS) as MagnifierAnnotation;
    expect(result.radius).toBe(10 * TEST_LIMITS.minSource);
  });

  it("lens corner drag clamps to limits.maxLens", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 500000, y: 150 }, false, TEST_LIMITS) as MagnifierAnnotation;
    expect(result.radius).toBe(TEST_LIMITS.maxLens);
  });

  it("src-move: from snaps to the pointer; at/radius/zoom unchanged", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-move", { x: 999, y: 888 }, false, TEST_LIMITS) as MagnifierAnnotation;
    expect(result.from).toEqual({ x: 999, y: 888 });
    expect(result.at).toEqual({ x: 200, y: 150 });
    expect(result.radius).toBe(60);
    expect(result.zoom).toBe(3);
  });

  it("src-zoom: zoom = clampZoom(radius / dist(pointer, from), a); from/at/radius unchanged", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    // pointer at distance 30 from `from` (80,50): zoom = 60/30 = 2, within [MIN,MAX] range for this radius.
    const result = applyResize(m, b, "src-zoom", { x: 80, y: 50 }, false, TEST_LIMITS) as MagnifierAnnotation;
    expect(result.zoom).toBeCloseTo(2);
    expect(result.from).toEqual({ x: 50, y: 50 });
    expect(result.at).toEqual({ x: 200, y: 150 });
    expect(result.radius).toBe(60);
  });

  it("src-zoom: a zero-distance drag (pointer exactly on `from`) is absorbed by the clamp, not a division-by-zero crash", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-zoom", { x: 50, y: 50 }, false, TEST_LIMITS) as MagnifierAnnotation;
    // radius/EPSILON is astronomically large -> clamped at the ceiling: min(MAX_MAGNIFIER_ZOOM, radius/limits.minSource) = min(16, 60/16) = 3.75.
    expect(result.zoom).toBeCloseTo(60 / TEST_LIMITS.minSource);
    expect(Number.isFinite(result.zoom)).toBe(true);
  });

  it("src-zoom respects the MIN_MAGNIFIER_ZOOM floor for a very long drag", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-zoom", { x: 50 + 100000, y: 50 }, false, TEST_LIMITS) as MagnifierAnnotation;
    expect(result.zoom).toBe(MIN_MAGNIFIER_ZOOM);
  });

  it("does not mutate the input annotation", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const before = structuredClone(m);
    applyResize(m, b, "se", { x: 999, y: 999 }, false, TEST_LIMITS);
    applyResize(m, b, "src-move", { x: 999, y: 999 }, false, TEST_LIMITS);
    applyResize(m, b, "src-zoom", { x: 999, y: 999 }, false, TEST_LIMITS);
    expect(m).toEqual(before);
  });
});

describe("applyResize: highlight", () => {
  it("returns the original annotation unchanged (resize-exempt)", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const b = boundsOf(h, measure);
    const result = applyResize(h, b, "se" as never, { x: 500, y: 500 }, false, TEST_LIMITS);
    expect(result).toBe(h);
  });
});

// TASK-41: angle survives applyResize (spread-through — every per-kind
// transform builds its result via `{ ...a, ... }`), for both an unchanged
// and a resize-touched field.
describe("applyResize: angle survives", () => {
  it("rect", () => {
    const r = { ...rect({ x: 0, y: 0 }, { x: 100, y: 100 }), angle: 0.3 };
    const b = boundsOf(r, measure);
    const result = applyResize(r, b, "se", { x: 150, y: 80 }, false, TEST_LIMITS) as RectAnnotation & { angle?: number };
    expect(result.angle).toBe(0.3);
  });

  it("badge", () => {
    const bd = { ...badge({ x: 50, y: 50 }, 20), angle: -0.5 };
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 90, y: 66 }, false, TEST_LIMITS) as BadgeAnnotation & { angle?: number };
    expect(result.angle).toBe(-0.5);
  });
});

// TASK-41 round 2: three placements ("north"/"south"/"clamped"), each tested
// against an INSET rect (canvasSize shrunk by `margin` on every side) rather
// than the old flip-to-south-else-north-wins rule.
describe("rotateHandleFor", () => {
  const canvasSize = { w: 200, h: 200 };
  const margin = 5;

  it("north placement at angle 0: local === world, offset outside the north edge", () => {
    const b: Bounds = { x: 0, y: 100, w: 100, h: 50 }; // far enough from the top edge that north stays in-inset
    const result = rotateHandleFor(b, 0, 24, canvasSize, margin);
    expect(result).toEqual({ local: { x: 50, y: 76 }, world: { x: 50, y: 76 }, placement: "north" });
  });

  it("rotates the local knob position into world space (still north placement)", () => {
    const b: Bounds = { x: 75, y: 75, w: 50, h: 50 }; // pivot (100,100)
    const result = rotateHandleFor(b, Math.PI / 2, 10, canvasSize, margin);
    expect(result.local).toEqual({ x: 100, y: 65 });
    expect(result.world.x).toBeCloseTo(135, 9);
    expect(result.world.y).toBeCloseTo(100, 9);
    expect(result.placement).toBe("north");
  });

  it("south placement when the north-side world position falls outside the inset rect", () => {
    const b: Bounds = { x: 0, y: 10, w: 100, h: 50 }; // north world y = 10-24 = -14, outside [margin, h-margin]
    const result = rotateHandleFor(b, 0, 24, canvasSize, margin);
    expect(result.placement).toBe("south");
    expect(result.local).toEqual({ x: 50, y: 84 }); // south: y0+h+offset = 10+50+24
    expect(result.world).toEqual({ x: 50, y: 84 });
  });

  it("clamped placement (angle 0) when both sides fall outside the inset rect", () => {
    const tinyCanvas = { w: 200, h: 60 }; // inset y range [5, 55]
    const b: Bounds = { x: 0, y: 10, w: 100, h: 50 }; // north y=-14, south y=84 — both outside [5,55]
    const result = rotateHandleFor(b, 0, 24, tinyCanvas, margin);
    expect(result.placement).toBe("clamped");
    // Component-wise clamp of the NORTH world position (50, -14) into [5,195]x[5,55].
    expect(result.world).toEqual({ x: 50, y: 5 });
    // angle 0: unrotate is the identity, so local === world here.
    expect(result.local).toEqual({ x: 50, y: 5 });
  });

  it("clamped placement (rotated): local recomputed via unrotate still rotates forward to the clamped world position", () => {
    const tinyCanvas = { w: 200, h: 60 }; // inset y range [5, 55]
    const b: Bounds = { x: 75, y: 75, w: 50, h: 50 }; // pivot (100,100)
    const angle = Math.PI / 2;
    const result = rotateHandleFor(b, angle, 10, tinyCanvas, margin);
    expect(result.placement).toBe("clamped");
    // north world (135,100) and south world (65,100) both have y=100, outside
    // [5,55]; clamped world is the NORTH one with y pulled to the inset edge.
    expect(result.world.x).toBeCloseTo(135, 9);
    expect(result.world.y).toBeCloseTo(55, 9);
    // Round-trip: rotating `local` forward by `angle` about the shape's pivot
    // must land exactly back on `world` — this is what makes it safe for the
    // connector line (drawn in local coordinates) to use `local` directly.
    const roundTrip = rotatePoint(result.local, pivotOf(b), angle);
    expect(roundTrip.x).toBeCloseTo(result.world.x, 9);
    expect(roundTrip.y).toBeCloseTo(result.world.y, 9);
  });

  // TASK-41 round 5: canvas.ts's knobMargin() derives its margin from
  // ROTATE_GLYPH_OUTER_RATIO (0.80 as of round 5, up from round 4's 0.71 —
  // the arrowhead's true max extent was underestimated), evaluating to
  // 16 * 0.80 + 2 = 14.8 CSS px at the production ROTATE_HANDLE_DRAW_PX (16).
  // `knobMargin()` itself is a private Editor method and untestable from
  // here, so this pins the *boundary value* directly against `rotateHandleFor`:
  // a shape whose north position sits between the old and new margins must
  // flip placement exactly at the new constant's threshold.
  it("pins the round-5 production margin (14.8 CSS px @ D=16): a north position that fit under the old margin no longer fits under the new one", () => {
    const canvasSizeLocal = { w: 200, h: 200 };
    const b: Bounds = { x: 0, y: 38, w: 100, h: 50 }; // north world y = 38 - 24 = 14
    const NEW_MARGIN = 14.8; // 16 * ROTATE_GLYPH_OUTER_RATIO(0.80) + 2
    const OLD_MARGIN = 13.36; // 16 * round-4's ROTATE_GLYPH_OUTER_RATIO(0.71) + 2

    const atNewMargin = rotateHandleFor(b, 0, 24, canvasSizeLocal, NEW_MARGIN);
    expect(atNewMargin.placement).toBe("south"); // 14 < 14.8: north no longer fits

    const atOldMargin = rotateHandleFor(b, 0, 24, canvasSizeLocal, OLD_MARGIN);
    expect(atOldMargin.placement).toBe("north"); // 14 >= 13.36: north used to fit here
  });
});

describe("anchorPointFor", () => {
  it("rect: opposite corner for each of the 4 corner handles", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 50 });
    const b = boundsOf(r, measure);
    expect(anchorPointFor(r, b, "se")).toEqual({ x: 0, y: 0 });
    expect(anchorPointFor(r, b, "nw")).toEqual({ x: 100, y: 50 });
    expect(anchorPointFor(r, b, "ne")).toEqual({ x: 0, y: 50 });
    expect(anchorPointFor(r, b, "sw")).toEqual({ x: 100, y: 0 });
  });

  it("rect: the two fixed corners for an edge handle both stay put — anchorPointFor picks the nw-ward one", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 50 });
    const b = boundsOf(r, measure);
    expect(anchorPointFor(r, b, "e")).toEqual({ x: 0, y: 0 });
    expect(anchorPointFor(r, b, "n")).toEqual({ x: 0, y: 50 });
  });

  it("image: same box formula as rect", () => {
    const img = image({ x: 10, y: 10 }, 80, 40);
    const b = boundsOf(img, measure);
    expect(anchorPointFor(img, b, "sw")).toEqual({ x: 90, y: 10 });
  });

  it("text: same box formula, 4 corner handles only", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const b = boundsOf(t, measure);
    expect(anchorPointFor(t, b, "ne")).toEqual({ x: b.x, y: b.y + b.h });
  });

  it("badge: always the center, regardless of handle", () => {
    const bd = badge({ x: 50, y: 50 }, 20);
    const b = boundsOf(bd, measure);
    expect(anchorPointFor(bd, b, "se")).toEqual({ x: 50, y: 50 });
    expect(anchorPointFor(bd, b, "nw")).toEqual({ x: 50, y: 50 });
  });

  it("arrow: the endpoint NOT being dragged", () => {
    const a = arrow({ x: 30, y: 40 }, { x: 5, y: 2 });
    const b = boundsOf(a, measure);
    expect(anchorPointFor(a, b, "to")).toEqual({ x: 30, y: 40 });
    expect(anchorPointFor(a, b, "from")).toEqual({ x: 5, y: 2 });
  });

  it("highlight: the center of its bounding box", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 40 }]);
    const b = boundsOf(h, measure);
    expect(anchorPointFor(h, b, "se" as never)).toEqual(pivotOf(b));
  });

  it("magnifier: always the lens center `at`, for every handle (lens corners and both source handles alike)", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    expect(anchorPointFor(m, b, "se")).toEqual({ x: 200, y: 150 });
    expect(anchorPointFor(m, b, "nw")).toEqual({ x: 200, y: 150 });
    expect(anchorPointFor(m, b, "src-move")).toEqual({ x: 200, y: 150 });
    expect(anchorPointFor(m, b, "src-zoom")).toEqual({ x: 200, y: 150 });
  });
});

/**
 * TASK-41 resize/rotation composition contract (design doc "Geometry
 * contract"): resizing operates in the shape's unrotated local frame
 * (pointer inverse-rotated about the PRE-DRAG pivot), reuses `applyResize`
 * verbatim, then a re-anchor translation keeps the handle's pinned point
 * world-fixed. This is the provably-drift-free composition `canvas.ts` wires
 * up for real pointer drags; here it's exercised directly against
 * resize.ts/rotate.ts, with no DOM involved.
 */
describe("resize composed with rotation (drift-free by construction)", () => {
  it("45°-rotated rect: the pinned (nw) world corner is unchanged after resizing from se and re-anchoring", () => {
    const original = { ...rect({ x: 0, y: 0 }, { x: 100, y: 100 }), angle: Math.PI / 4 };
    const boundsPredrag = boundsOf(original, measure);
    const pivot0 = pivotOf(boundsPredrag);
    const handle = "se" as const;
    const anchorLocal = anchorPointFor(original, boundsPredrag, handle); // nw corner, (0,0)
    const worldAnchorBefore = rotatePoint(anchorLocal, pivot0, original.angle);

    // Pick an arbitrary world-space pointer position and drive the gesture
    // through the same steps canvas.ts's onMove resize branch performs.
    const worldPointer = { x: 220, y: 60 };
    const localPointer = unrotatePoint(worldPointer, pivot0, original.angle);
    const resized = applyResize(original, boundsPredrag, handle, localPointer, false, TEST_LIMITS) as RectAnnotation & {
      angle?: number;
    };
    const boundsAfter = boundsOf(resized, measure);
    const d = reanchorDelta(anchorLocal, boundsPredrag, boundsAfter, original.angle);
    // translateAnnotation, not a hand-rolled translation — exercises the
    // exact call canvas.ts's onMove resize branch makes.
    const final = translateAnnotation(resized, d.x, d.y) as RectAnnotation & { angle?: number };

    const boundsFinal = boundsOf(final, measure);
    const pivotFinal = pivotOf(boundsFinal);
    const worldAnchorAfter = rotatePoint({ x: boundsFinal.x, y: boundsFinal.y }, pivotFinal, final.angle!);

    expect(worldAnchorAfter.x).toBeCloseTo(worldAnchorBefore.x, 9);
    expect(worldAnchorAfter.y).toBeCloseTo(worldAnchorBefore.y, 9);
    // Angle itself is untouched by the resize+re-anchor composition.
    expect(final.angle).toBeCloseTo(Math.PI / 4);
  });

  it("is an exact no-op at angle 0 (reanchorDelta is always {0,0})", () => {
    const original = rect({ x: 0, y: 0 }, { x: 100, y: 100 });
    const b = boundsOf(original, measure);
    const anchorLocal = anchorPointFor(original, b, "se");
    const resized = applyResize(original, b, "se", { x: 150, y: 80 }, false, TEST_LIMITS);
    const bAfter = boundsOf(resized, measure);
    const d = reanchorDelta(anchorLocal, b, bAfter, 0);
    expect(d).toEqual({ x: 0, y: 0 });
  });
});
