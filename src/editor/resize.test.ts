import { describe, it, expect } from "vitest";
import {
  resizeHandlesFor,
  handleAt,
  nearestHandle,
  applyResize,
  rotateHandleFor,
  anchorPointFor,
  deleteButtonCornerFor,
  magnifierSourceBodyWins,
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
import { magnifierHitPart } from "./hittest";
import { pivotOf, reanchorDelta, rotatePoint, unrotatePoint } from "./rotate";
import { translateAnnotation } from "./model";
import type {
  ArrowAnnotation,
  RectAnnotation,
  TextAnnotation,
  HighlighterAnnotation,
  BadgeAnnotation,
  ImageAnnotation,
  CircleMagnifierAnnotation,
  RectMagnifierAnnotation,
  Point,
} from "./model";
import { magnifierSizeLimits, magnifierSourceRect, MIN_MAGNIFIER_ZOOM, MAX_MAGNIFIER_ZOOM } from "./magnifier";

// Shared canvas size for every applyResize call in this file — both
// `TEST_LIMITS` (below) and applyResize's 7th parameter (`canvasSize`, added
// alongside the rect magnifier variant, D5) are derived from/pass this same
// 1000x800 canvas, so the two stay consistent.
const TEST_CANVAS = { w: 1000, h: 800 };

// Shared limits for every applyResize call in this file (Addendum B,
// 2026-08-02: applyResize's 6th parameter is required). scale=1 (no CSS
// scaling), 1000x800 canvas -> shortSide=800: minSource = min(16, 120) = 16,
// maxLens = 0.45*800 = 360, minLens = min(28, 360) = 28. Only the magnifier
// tests below actually read these values; every other kind's applyResize
// call ignores the parameter (see applyResize's doc comment).
const TEST_LIMITS = magnifierSizeLimits(TEST_CANVAS, 1);

// Shared source-handle-ring outset for every non-rect-magnifier-box-handle
// `resizeHandlesFor`/`applyResize` call in this file (Addendum I, 2026-08-09
// — both functions' new required param). 0 for every kind/gesture that
// doesn't read it (every kind but a rect magnifier's 8 box handles) so their
// pre-existing pointer/expected-position arithmetic stays untouched; the rect
// magnifier box-handle tests (below) use a nonzero outset instead, since a
// nonzero outset is production reality (`canvas.ts`'s `srcHandleOutset()`).
const TEST_OUTSET = 0;

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
): CircleMagnifierAnnotation {
  return { id: "magnifier1", kind: "magnifier", color: "#ED107B", strokeWidth, at, radius, zoom, from };
}

function rectMagnifier(
  at: { x: number; y: number },
  width = 120,
  height = 60,
  from: { x: number; y: number } = { x: 50, y: 50 },
  zoom = 3,
  strokeWidth = 6,
): RectMagnifierAnnotation {
  return { id: "magnifier1", kind: "magnifier", shape: "rect", color: "#ED107B", strokeWidth, at, width, height, zoom, from };
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
    const handles = resizeHandlesFor(r, b, TEST_OUTSET);
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
    const handles = resizeHandlesFor(img, b, TEST_OUTSET);
    expect(handles).toHaveLength(8);
    expect(byId(handles, "nw")).toEqual({ x: 10, y: 10 });
    expect(byId(handles, "se")).toEqual({ x: 90, y: 50 });
  });

  it("arrow: 2 handles at from/to, taken from the annotation itself (not normalized bounds)", () => {
    const a = arrow({ x: 30, y: 40 }, { x: 5, y: 2 });
    const b = boundsOf(a, measure);
    const handles = resizeHandlesFor(a, b, TEST_OUTSET);
    expect(handles).toHaveLength(2);
    expect(byId(handles, "from")).toEqual({ x: 30, y: 40 });
    expect(byId(handles, "to")).toEqual({ x: 5, y: 2 });
  });

  it("text: 4 corner handles only", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const b = boundsOf(t, measure);
    const handles = resizeHandlesFor(t, b, TEST_OUTSET);
    expect(handles.map((h) => h.id).sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect(byId(handles, "nw")).toEqual({ x: b.x, y: b.y });
    expect(byId(handles, "se")).toEqual({ x: b.x + b.w, y: b.y + b.h });
  });

  it("badge: 4 corner handles only, positioned from the bounding box", () => {
    const bd = badge({ x: 50, y: 50 }, 20);
    const b = boundsOf(bd, measure);
    const handles = resizeHandlesFor(bd, b, TEST_OUTSET);
    expect(handles.map((h) => h.id).sort()).toEqual(["ne", "nw", "se", "sw"]);
    expect(byId(handles, "nw")).toEqual({ x: 30, y: 30 });
    expect(byId(handles, "se")).toEqual({ x: 70, y: 70 });
  });

  it("highlight: no handles", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const b = boundsOf(h, measure);
    expect(resizeHandlesFor(h, b, TEST_OUTSET)).toEqual([]);
  });

  it("magnifier: 5 handles — src-zoom (grip) FIRST, then the 4 lens corners (squares) on the lens bounding box", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3); // sourceRadius = 20
    const b = boundsOf(m, measure); // lens bounding square: x140 y90 w120 h120
    const handles = resizeHandlesFor(m, b, TEST_OUTSET);
    expect(handles.map((h) => h.id)).toEqual(["src-zoom", "nw", "ne", "sw", "se"]);

    const srcZoom = handles[0];
    expect(srcZoom.shape).toBe("grip");
    expect(srcZoom.pos.x).toBeCloseTo(50 + 20 * Math.cos(MAGNIFIER_ZOOM_HANDLE_ANGLE));
    expect(srcZoom.pos.y).toBeCloseTo(50 + 20 * Math.sin(MAGNIFIER_ZOOM_HANDLE_ANGLE));

    expect(byId(handles, "nw")).toEqual({ x: 140, y: 90 });
    expect(byId(handles, "se")).toEqual({ x: 260, y: 210 });
    // Corner handles don't opt into the grip shape (default/undefined = square).
    expect(handles.find((h) => h.id === "nw")!.shape).toBeUndefined();
  });

  it("magnifier rect (Addendum I, 2026-08-09): 9 handles — src-zoom (grip) FIRST at the LENS's own SE corner, then all 8 box handles ringing the SOURCE rect at `srcHandleOutset`", () => {
    const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3); // sourceRect: (w/zoom)x(h/zoom) = 40x20, centered on from -> x30 y40 w40 h20
    const b = boundsOf(m, measure); // lens bounding box: x140 y120 w120 h60
    const outset = 5;
    const handles = resizeHandlesFor(m, b, outset);
    expect(handles.map((h) => h.id)).toEqual(["src-zoom", "nw", "ne", "sw", "se", "n", "e", "s", "w"]);

    // I5: grip relocated to the LENS's own SE corner (== bounds's SE corner,
    // no `magnifierSourceRect` involved anymore).
    const srcZoom = handles[0];
    expect(srcZoom.shape).toBe("grip");
    expect(srcZoom.pos).toEqual({ x: b.x + b.w, y: b.y + b.h });
    expect(srcZoom.pos).toEqual({ x: 260, y: 180 });

    // I2: the 8 box handles ring magnifierSourceRect(m) inflated by `outset`
    // — NOT the lens's bounding box anymore.
    const sourceRect = magnifierSourceRect(m);
    expect(sourceRect).toEqual({ x: 30, y: 40, w: 40, h: 20 });
    expect(byId(handles, "nw")).toEqual({ x: 25, y: 35 });
    expect(byId(handles, "se")).toEqual({ x: 75, y: 65 });
    expect(byId(handles, "n")).toEqual({ x: 50, y: 35 });
    expect(byId(handles, "e")).toEqual({ x: 75, y: 50 });
    // Corner/edge handles don't opt into the grip shape (default/undefined = square).
    expect(handles.find((h) => h.id === "nw")!.shape).toBeUndefined();
  });

  it("magnifier rect: at outset 0 the box handles sit exactly on the bare source rect (arithmetic clarity)", () => {
    const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const handles = resizeHandlesFor(m, b, 0);
    expect(byId(handles, "nw")).toEqual({ x: 30, y: 40 });
    expect(byId(handles, "se")).toEqual({ x: 70, y: 60 });
  });
});

describe("handleAt", () => {
  const r = rect({ x: 100, y: 100 }, { x: 300, y: 250 });
  const b = boundsOf(r, measure);
  const handles = resizeHandlesFor(r, b, TEST_OUTSET);
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
  const handles = resizeHandlesFor(r, b, TEST_OUTSET);
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

  // Magnifier's `src-zoom` is deliberately listed FIRST in resizeHandlesFor
  // (design note) so it wins EXACT ties against another handle at the same
  // distance — this pins the underlying nearestHandle property that ordering
  // relies on: iterating in list order with a strict `<` comparison means an
  // exact tie always favors the earlier-listed handle.
  it("exact tie between two handles at equal distance: the earlier-listed one wins", () => {
    const tieHandles: HandleSpec[] = [
      { id: "src-zoom", pos: { x: 50, y: 50 }, shape: "grip" },
      { id: "nw", pos: { x: 140, y: 90 } },
    ];
    const midpoint = { x: 95, y: 70 }; // equidistant from both by construction
    const result = nearestHandle(tieHandles, midpoint, 60);
    expect(result!.id).toBe("src-zoom");

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
    const result = applyResize(r, b, "se", { x: 150, y: 80 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 150, y: 80 });
  });

  it("nw corner drag pins se", () => {
    const result = applyResize(r, b, "nw", { x: -20, y: 30 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    expect(result.a).toEqual({ x: -20, y: 30 });
    expect(result.b).toEqual({ x: 100, y: 100 });
  });

  it("e edge drag moves only the east edge", () => {
    const result = applyResize(r, b, "e", { x: 200, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 200, y: 100 });
  });

  it("n edge drag moves only the north edge", () => {
    const result = applyResize(r, b, "n", { x: 999, y: -50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: -50 });
    expect(result.b).toEqual({ x: 100, y: 100 });
  });

  it("clamps to MIN_RECT_PX per axis instead of flipping past the pinned corner", () => {
    const result = applyResize(r, b, "se", { x: -500, y: -500 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    expect(result.b.x - result.a.x).toBeCloseTo(MIN_RECT_PX);
    expect(result.b.y - result.a.y).toBeCloseTo(MIN_RECT_PX);
    expect(result.a).toEqual({ x: 0, y: 0 });
  });

  it("Shift on a corner locks the pre-drag aspect ratio (2:1 rect stays 2:1)", () => {
    const wide = rect({ x: 0, y: 0 }, { x: 200, y: 100 }); // 2:1
    const wb = boundsOf(wide, measure);
    const result = applyResize(wide, wb, "se", { x: 400, y: 260 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    const w = result.b.x - result.a.x;
    const h = result.b.y - result.a.y;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(w / h).toBeCloseTo(2, 5);
  });

  it("Shift on an edge handle is ignored (edges have no aspect concept)", () => {
    const result = applyResize(r, b, "e", { x: 300, y: 0 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation;
    expect(result.a).toEqual({ x: 0, y: 0 });
    expect(result.b).toEqual({ x: 300, y: 100 });
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(r);
    applyResize(r, b, "se", { x: 500, y: 500 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(r).toEqual(before);
  });
});

describe("applyResize: image", () => {
  const img = image({ x: 0, y: 0 }, 200, 100); // 2:1
  const b = boundsOf(img, measure);

  it("corner drag is aspect-locked by default", () => {
    const result = applyResize(img, b, "se", { x: 500, y: 260 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width / result.height).toBeCloseTo(2, 5);
  });

  it("Shift on a corner frees the aspect ratio", () => {
    const result = applyResize(img, b, "se", { x: 400, y: 500 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.width).toBeCloseTo(400);
    expect(result.height).toBeCloseTo(500);
  });

  it("edge drag is single-axis regardless of Shift", () => {
    const result = applyResize(img, b, "s", { x: 999, y: 400 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ImageAnnotation;
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
    const result = applyResize(img, b, "se", { x: -500, y: -500 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ImageAnnotation;
    expect(result.at).toEqual({ x: 0, y: 0 });
    expect(result.height).toBeCloseTo(MIN_IMAGE_PX);
    expect(result.width).toBeCloseTo(MIN_IMAGE_PX * 2);
    expect(result.width / result.height).toBeCloseTo(2, 5);
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(img);
    applyResize(img, b, "se", { x: 500, y: 500 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(img).toEqual(before);
  });
});

describe("applyResize: arrow", () => {
  const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });

  it("dragging 'to' follows the pointer, leaving 'from' fixed", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 40, y: 80 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ArrowAnnotation;
    expect(result.from).toEqual({ x: 0, y: 0 });
    expect(result.to).toEqual({ x: 40, y: 80 });
  });

  it("dragging 'from' follows the pointer, leaving 'to' fixed", () => {
    const result = applyResize(a, boundsOf(a, measure), "from", { x: -30, y: -10 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ArrowAnnotation;
    expect(result.to).toEqual({ x: 100, y: 0 });
    expect(result.from).toEqual({ x: -30, y: -10 });
  });

  it("Shift snaps the dragged endpoint's angle to 45° increments, keeping magnitude", () => {
    // Pointer near-horizontal-ish but slightly off (dist=100 from origin at ~5.7deg) should snap to 0deg (100,0).
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 99.5, y: 10 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ArrowAnnotation;
    expect(result.to.y).toBeCloseTo(0, 5);
    expect(result.to.x).toBeGreaterThan(90);
  });

  it("Shift snaps a diagonal-ish drag to exactly 45°, preserving the pointer's own distance from the fixed endpoint", () => {
    // Angle slightly off 45deg; magnitude is the pointer's distance from
    // `from` (0,0), not the original arrow's length.
    const dist = Math.hypot(72, 68);
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 72, y: 68 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ArrowAnnotation;
    expect(result.to.x).toBeCloseTo(dist * Math.SQRT1_2, 5);
    expect(result.to.y).toBeCloseTo(dist * Math.SQRT1_2, 5);
  });

  it("clamps an update that would make the endpoints closer than MIN_ARROW_LEN", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 1, y: 0 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ArrowAnnotation;
    const dist = Math.hypot(result.to.x - result.from.x, result.to.y - result.from.y);
    expect(dist).toBeCloseTo(MIN_ARROW_LEN, 5);
  });

  it("rejects an update where the pointer lands exactly on the fixed endpoint", () => {
    const result = applyResize(a, boundsOf(a, measure), "to", { x: 0, y: 0 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as ArrowAnnotation;
    expect(result.to).toEqual({ x: 100, y: 0 }); // unchanged (pre-drag position)
  });

  it("does not mutate the input annotation", () => {
    const before = structuredClone(a);
    applyResize(a, boundsOf(a, measure), "to", { x: 500, y: 500 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(a).toEqual(before);
  });
});

describe("applyResize: text", () => {
  const t = text({ x: 0, y: 0 }, "hello", 20); // bounds: x0 y0 w50 h24

  it("se corner drag scales fontSize by vertical ratio from the pinned nw corner", () => {
    const b = boundsOf(t, measure);
    // pointer.y = 48 => scale = |48 - 0| / 24 = 2 => fontSize' = 40
    const result = applyResize(t, b, "se", { x: 999, y: 48 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    expect(result.fontSize).toBe(40);
    // pinned corner (nw) stays fixed.
    expect(result.at).toEqual({ x: 0, y: 0 });
  });

  it("nw corner drag scales relative to the pinned se corner and repositions `at`", () => {
    const b = boundsOf(t, measure); // se = (50, 24)
    // pointer.y = 0 => scale = |0 - 24| / 24 = 1 (no-op scale)
    const result = applyResize(t, b, "nw", { x: 0, y: 0 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    expect(result.fontSize).toBe(20);
    expect(result.at).toEqual({ x: 0, y: 0 });
  });

  it("clamps fontSize to MIN_TEXT_FONT_SIZE and recomputes at from the pinned corner", () => {
    const b = boundsOf(t, measure);
    // pointer.y very close to pinned corner => tiny scale, fontSize clamps to MIN_TEXT_FONT_SIZE.
    const result = applyResize(t, b, "se", { x: 999, y: 0.1 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    expect(result.fontSize).toBe(MIN_TEXT_FONT_SIZE);
  });

  it("clamps fontSize to MAX_TEXT_FONT_SIZE", () => {
    const b = boundsOf(t, measure);
    const result = applyResize(t, b, "se", { x: 999, y: 100000 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    expect(result.fontSize).toBe(MAX_TEXT_FONT_SIZE);
  });

  it("clamps to MIN_TEXT_FONT_SIZE (not growing again) when the pointer crosses back past the pinned corner", () => {
    const b = boundsOf(t, measure); // pinned corner for "se" is nw = (0, 0)
    // pointer.y = -50 is on the far side of the pinned nw corner (y < 0): the
    // outward (south) distance is negative, so this must clamp to the
    // minimum, not grow fontSize via an unsigned |pointer.y - pinnedY|.
    const result = applyResize(t, b, "se", { x: 999, y: -50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    expect(result.fontSize).toBe(MIN_TEXT_FONT_SIZE);
    expect(result.at).toEqual({ x: 0, y: 0 }); // pinned nw corner still fixed
  });

  it("Shift has no special effect on text resize", () => {
    const b = boundsOf(t, measure);
    const withShift = applyResize(t, b, "se", { x: 999, y: 48 }, true, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    const withoutShift = applyResize(t, b, "se", { x: 999, y: 48 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as TextAnnotation;
    expect(withShift).toEqual(withoutShift);
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(t, measure);
    const before = structuredClone(t);
    applyResize(t, b, "se", { x: 999, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(t).toEqual(before);
  });
});

describe("applyResize: badge", () => {
  const bd = badge({ x: 50, y: 50 }, 20);

  it("radius tracks the max axis distance from the fixed center", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 90, y: 66 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as BadgeAnnotation;
    expect(result.radius).toBe(40); // max(|90-50|, |66-50|) = 40
    expect(result.at).toEqual({ x: 50, y: 50 });
    expect(result.number).toBe(1);
  });

  it("clamps radius to MIN_BADGE_RADIUS", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 51, y: 50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as BadgeAnnotation;
    expect(result.radius).toBe(MIN_BADGE_RADIUS);
  });

  it("clamps radius to MAX_BADGE_RADIUS", () => {
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 5000, y: 50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as BadgeAnnotation;
    expect(result.radius).toBe(MAX_BADGE_RADIUS);
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(bd, measure);
    const before = structuredClone(bd);
    applyResize(bd, b, "se", { x: 500, y: 500 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(bd).toEqual(before);
  });
});

describe("applyResize: magnifier", () => {
  it("lens corner drag: center-pinned radius resize at fixed zoom (at/zoom/from unchanged)", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 260, y: 210 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation;
    expect(result.radius).toBe(60); // max(|260-200|,|210-150|) = 60
    expect(result.at).toEqual({ x: 200, y: 150 });
    expect(result.zoom).toBe(3);
    expect(result.from).toEqual({ x: 50, y: 50 });
  });

  it("lens corner drag clamps to lo = max(limits.minLens, zoom * limits.minSource) — limits.minLens dominates at low zoom", () => {
    // TEST_LIMITS: minLens=28, minSource=20 -> zoom*minSource = MIN_MAGNIFIER_ZOOM(1.2)*20 = 24 < minLens(28).
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 1.2);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 205, y: 155 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation; // max(5,5)=5, below the floor
    expect(result.radius).toBe(TEST_LIMITS.minLens);
  });

  it("lens corner drag clamps to lo — the zoom*minSource term dominates at high zoom", () => {
    // zoom*minSource = 10*20 = 200 > minLens(28).
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 10);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 201, y: 151 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation;
    expect(result.radius).toBe(10 * TEST_LIMITS.minSource);
  });

  it("lens corner drag clamps to limits.maxLens", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 500000, y: 150 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation;
    expect(result.radius).toBe(TEST_LIMITS.maxLens);
  });

  it("src-zoom: zoom = clampZoom(radius / dist(pointer, from), a); from/at/radius unchanged", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    // pointer at distance 30 from `from` (80,50): zoom = 60/30 = 2, within [MIN,MAX] range for this radius.
    const result = applyResize(m, b, "src-zoom", { x: 80, y: 50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation;
    expect(result.zoom).toBeCloseTo(2);
    expect(result.from).toEqual({ x: 50, y: 50 });
    expect(result.at).toEqual({ x: 200, y: 150 });
    expect(result.radius).toBe(60);
  });

  it("src-zoom: a zero-distance drag (pointer exactly on `from`) is absorbed by the clamp, not a division-by-zero crash", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-zoom", { x: 50, y: 50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation;
    // radius/EPSILON is astronomically large -> clamped at the ceiling: min(MAX_MAGNIFIER_ZOOM, radius/limits.minSource) = min(16, 60/16) = 3.75.
    expect(result.zoom).toBeCloseTo(60 / TEST_LIMITS.minSource);
    expect(Number.isFinite(result.zoom)).toBe(true);
  });

  it("src-zoom respects the MIN_MAGNIFIER_ZOOM floor for a very long drag", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-zoom", { x: 50 + 100000, y: 50 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as CircleMagnifierAnnotation;
    expect(result.zoom).toBe(MIN_MAGNIFIER_ZOOM);
  });

  it("does not mutate the input annotation", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    const before = structuredClone(m);
    applyResize(m, b, "se", { x: 999, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    applyResize(m, b, "src-zoom", { x: 999, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(m).toEqual(before);
  });
});

describe("applyResize: magnifier rect (Addendum I, 2026-08-09 — box handles rebased onto the SOURCE, zoom fixed, lens follows)", () => {
  // m: at(200,150) width120 height60 from(50,50) zoom3.
  // source = magnifierSourceRect(m) = (width/zoom)x(height/zoom) = 40x20,
  // centered on from(50,50) -> x30 y40 w40 h20.
  // minSrcPx = 2*max(limits.minLens(28)/zoom(3), limits.minRectSource(4))
  //          = 2*max(9.333, 4) = 18.667 (== the pre-Addendum-I `minPx`(56),
  //          divided by zoom(3) — 56/3 = 18.667).
  const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3);
  // Nonzero on purpose (production reality — canvas.ts's `srcHandleOutset()`
  // is never 0); every pointer below is the RAW (pre-deflation) position, so
  // it adds `OUTSET` back on top of the intended deflated SOURCE-space target
  // — see applyMagnifierBoxResize's §I2 doc comment for the inversion this
  // exercises.
  const OUTSET = 6;

  it("se corner drag: opposite (nw) SOURCE corner pinned, free per-axis resize; zoom and `at` unchanged", () => {
    const b = boundsOf(m, measure);
    // Deflated target: source's se corner -> (230,180); nw stays at (30,40).
    const result = applyResize(m, b, "se", { x: 230 + OUTSET, y: 180 + OUTSET }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    expect(result.from).toEqual({ x: 130, y: 110 }); // new source center: nw(30,40) pinned, se(230,180)
    expect(result.width).toBe(600); // source w(200) * zoom(3)
    expect(result.height).toBe(420); // source h(140) * zoom(3)
    expect(result.at).toEqual({ x: 200, y: 150 }); // I3: the lens center never moves under a box-handle drag
    expect(result.zoom).toBe(3); // I1: zoom stays fixed for the whole gesture
  });

  it("nw corner drag: opposite (se) SOURCE corner pinned", () => {
    const b = boundsOf(m, measure);
    // Deflated target: source's nw corner -> (-40,-20); se stays at (70,60).
    const result = applyResize(m, b, "nw", { x: -40 - OUTSET, y: -20 - OUTSET }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    expect(result.from).toEqual({ x: 15, y: 20 }); // se(70,60) pinned, nw moved to (-40,-20)
    expect(result.width).toBe(330); // source w(110) * zoom(3)
    expect(result.height).toBe(240); // source h(80) * zoom(3)
    expect(result.at).toEqual({ x: 200, y: 150 });
    expect(result.zoom).toBe(3);
  });

  it("e edge drag moves only the SOURCE's east edge (height untouched)", () => {
    // Local fixture with a source half-extent already comfortably in-range on
    // BOTH axes (source h=80, well above minSrcPx=18.667) — Addendum D
    // §D10's both-axes clamp still re-checks the untouched axis every drag,
    // but a value already in range clamps to itself, so it stays genuinely
    // unchanged, which is what this test is actually about.
    const tall = rectMagnifier({ x: 200, y: 150 }, 120, 240, { x: 50, y: 50 }, 3); // source: x30 y10 w40 h80
    const b = boundsOf(tall, measure);
    const result = applyResize(tall, b, "e", { x: 230 + OUTSET, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    expect(result.width).toBe(600); // source w(200) * zoom(3)
    expect(result.height).toBe(240); // unchanged — the "e" handle never touches the vertical axis
    expect(result.from).toEqual({ x: 130, y: 50 });
    expect(result.at).toEqual({ x: 200, y: 150 });
  });

  it("min clamp: minSrcPx = 2*max(limits.minLens/zoom, limits.minRectSource) applies per axis instead of flipping past the pinned SOURCE corner", () => {
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: -5000 + OUTSET, y: -5000 + OUTSET }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    const minSrcPx = 2 * Math.max(TEST_LIMITS.minLens / m.zoom, TEST_LIMITS.minRectSource);
    expect(result.width / result.zoom).toBeCloseTo(minSrcPx);
    expect(result.height / result.zoom).toBeCloseTo(minSrcPx);
    // Re-expressed in LENS units, this is exactly the pre-Addendum-I `minPx`.
    expect(result.width).toBeCloseTo(2 * Math.max(TEST_LIMITS.minLens, m.zoom * TEST_LIMITS.minRectSource));
  });

  it("min clamp: limits.minLens dominates at low zoom", () => {
    // low-zoom fixture: minLens/zoom = 28/1.2 = 23.33 > minRectSource(4) -> minLens wins.
    const lowZoom = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, MIN_MAGNIFIER_ZOOM);
    const b = boundsOf(lowZoom, measure);
    const result = applyResize(lowZoom, b, "se", { x: -5000 + OUTSET, y: -5000 + OUTSET }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    expect(result.width).toBeCloseTo(2 * TEST_LIMITS.minLens);
    expect(result.height).toBeCloseTo(2 * TEST_LIMITS.minLens);
  });

  it("per-axis max clamp: caps the dragged SOURCE axis at 2*MAGNIFIER_MAX_LENS_FRACTION*canvasSize.{w,h}/zoom, keeping the SOURCE's anchored edge fixed and `at` unchanged", () => {
    const tall = rectMagnifier({ x: 200, y: 150 }, 120, 240, { x: 50, y: 50 }, 3); // source: x30 y10 w40 h80
    const b = boundsOf(tall, measure);
    const result = applyResize(tall, b, "e", { x: 500000 + OUTSET, y: 150 }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    const maxW = 2 * 0.45 * TEST_CANVAS.w; // MAGNIFIER_MAX_LENS_FRACTION, LENS units
    expect(result.width).toBeCloseTo(maxW);
    expect(result.height).toBe(240); // untouched axis stays at its pre-drag size (already in-range)
    expect(result.from.x - result.width / result.zoom / 2).toBeCloseTo(30); // SOURCE's west edge stays anchored
    expect(result.at).toEqual({ x: 200, y: 150 }); // I3: never touched by a box-handle drag
  });

  it("Shift on a corner locks the pre-drag SOURCE aspect ratio (2:1, same as the lens's), pinning the opposite SOURCE corner", () => {
    const b = boundsOf(m, measure);
    // Deflated target: source se -> (230,140), preserving the 2:1 (40x20) source aspect at 5x scale.
    const result = applyResize(m, b, "se", { x: 230 + OUTSET, y: 140 + OUTSET }, true, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
    expect(result.width / result.height).toBeCloseTo(2, 5);
    const srcW = result.width / result.zoom;
    const srcH = result.height / result.zoom;
    expect(result.from.x - srcW / 2).toBeCloseTo(30); // pinned source nw.x
    expect(result.from.y - srcH / 2).toBeCloseTo(40); // pinned source nw.y
    expect(result.at).toEqual({ x: 200, y: 150 });
  });

  // Exact (`toBe`/`toEqual`), not `toBeCloseTo` (reviewer round 2, SHOULD-FIX
  // #3): a naive `width: w * a.zoom` write-back is NOT reliably bit-exact
  // even when the geometry round-trips perfectly (the `(width/zoom)*zoom`
  // divide-then-multiply is lossy in general FP arithmetic). This "friendly"
  // (dyadic-ish) fixture happens to pass even under a weaker mechanism —
  // see the fractional fixture test right below for the one that actually
  // discriminates between a real fix and a coincidence.
  it("grabbing a box handle without moving is an EXACT (bit-identical) no-op, for every handle, including with Shift held (I2 outset inversion)", () => {
    const b = boundsOf(m, measure);
    const handles = resizeHandlesFor(m, b, OUTSET);
    for (const h of handles) {
      if (h.shape === "grip") continue;
      for (const shiftKey of [false, true]) {
        const result = applyResize(m, b, h.id, h.pos, shiftKey, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
        expect(result.width).toBe(m.width);
        expect(result.height).toBe(m.height);
        expect(result.from).toEqual(m.from);
        expect(result.at).toEqual(m.at);
      }
    }
  });

  // REQUIRED regression fixture (reviewer round 3, 2026-08-09 — BLOCKING).
  // The friendly fixture above (120x60, zoom 3, from(50,50), integer OUTSET)
  // is dyadic-friendly: every intermediate FP operation happens to round-trip
  // exactly, so it would still pass even with the exactness guard deleted
  // entirely. This fixture is deliberately NOT dyadic-friendly (fractional
  // at/from/dims, non-integer zoom, the real production outset) — against
  // the round-2 code (deflate the pointer, trust `resizeBox` to reconstruct
  // `src.w`/`src.h` bit-exactly) it fails on all 8 handles x both Shift
  // states, because `resizeBox`'s own edge-difference reconstruction
  // (`(src.y + src.h) - src.y`) alone drifts by 1 ulp in the large majority
  // of such fixtures. `applyMagnifierBoxResize`'s pointer-identity
  // short-circuit (recomputing the handle's own ring position via the exact
  // same `resizeHandlesFor` call, before any deflation/`resizeBox` math
  // runs) fixes this unconditionally — the returned annotation is the
  // identical object reference, not merely field-equal.
  it("grabbing a box handle without moving is an EXACT no-op on a fractional, non-dyadic-friendly fixture", () => {
    const PROD_OUTSET = 14; // canvas.ts's MAGNIFIER_SRC_HANDLE_OUTSET_PX (unscaled)
    const fractional = rectMagnifier({ x: 500.3, y: 400.7 }, 257, 97, { x: 200.5, y: 200.25 }, 3.3);
    const fb = boundsOf(fractional, measure);
    const handles = resizeHandlesFor(fractional, fb, PROD_OUTSET);
    for (const h of handles) {
      if (h.shape === "grip") continue;
      for (const shiftKey of [false, true]) {
        const result = applyResize(fractional, fb, h.id, h.pos, shiftKey, TEST_LIMITS, TEST_CANVAS, PROD_OUTSET) as RectMagnifierAnnotation;
        // The short-circuit returns `a` itself — the strongest possible
        // no-op assertion, and one a "close enough" reconstruction could
        // never satisfy.
        expect(result).toBe(fractional);
      }
    }
  });

  // REQUIRED grip case (reviewer round 4, 2026-08-09 — SHOULD-FIX). The
  // grip's short-circuit used to re-derive its own position as `a.at.x +
  // a.width/2` — algebraically identical to, but NOT bit-identical to,
  // `resizeHandlesFor`'s own `bounds.x + bounds.w` (`bounds` being the lens
  // rect `{x: at.x - width/2, ..., width, ...}`): the subtract-then-add
  // round trip drifts by 1 ulp on ~32% of fractional fixtures. This fixture
  // (`at.x = 400.37`, `width = 63.71`) is one of them — `at.x + width/2 ===
  // 432.225` but `bounds.x + bounds.w === 432.22499999999997` — so it
  // discriminates the fix from the bug: this test FAILS against the old
  // `at.x + width/2` check and passes once the short-circuit reads `bounds`
  // (the same parameter `resizeHandlesFor` was given) directly instead.
  it("src-zoom: grabbing the grip without moving is an EXACT no-op on a fractional fixture that discriminates `bounds.x + bounds.w` from `at.x + width/2`", () => {
    const fractional = rectMagnifier({ x: 400.37, y: 300.53 }, 63.71, 41.23, { x: 150.15, y: 120.85 }, 2.7);
    const fb = boundsOf(fractional, measure);
    const handles = resizeHandlesFor(fractional, fb, TEST_OUTSET);
    const grip = handles.find((h) => h.id === "src-zoom")!;
    const result = applyResize(fractional, fb, "src-zoom", grip.pos, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(result).toBe(fractional);
  });

  it("lens === source * zoom exactly after every box-handle drag", () => {
    const b = boundsOf(m, measure);
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const) {
      const result = applyResize(m, b, handle, { x: 90 + OUTSET, y: 65 + OUTSET }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
      const src = magnifierSourceRect(result);
      expect(result.width).toBeCloseTo(src.w * result.zoom);
      expect(result.height).toBeCloseTo(src.h * result.zoom);
    }
  });

  it("src-zoom (§I5): relocated to the LENS's SE corner, mapping inverted — SOURCE (from/width/height ratio) stays fixed, LENS follows", () => {
    const b = boundsOf(m, measure);
    const src = magnifierSourceRect(m); // (30,40,40,20)
    const srcHalfDiag = Math.hypot(src.w, src.h) / 2;
    const dist = 5 * srcHalfDiag; // targets zoom = 5, inside [lo,hi] for this fixture
    const result = applyResize(m, b, "src-zoom", { x: m.at.x + dist, y: m.at.y }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(result.zoom).toBeCloseTo(5);
    expect(result.width).toBeCloseTo(src.w * 5);
    expect(result.height).toBeCloseTo(src.h * 5);
    expect(result.at).toEqual({ x: 200, y: 150 }); // the grip's own anchor point — unchanged
    expect(result.from).toEqual({ x: 50, y: 50 }); // I5: source held fixed
  });

  // Exact, not `toBeCloseTo` (reviewer round 2, SHOULD-FIX #3): reconstructing
  // zoom via `dist/srcHalfDiag` is not reliably bit-exact even at zero motion
  // (two independent `Math.hypot` calls, not an algebraic inverse of each
  // other) — `applyRectMagnifierResize`'s `src-zoom` branch instead detects
  // "didn't move" via a direct pointer-vs-grip-position identity check and
  // short-circuits to `a` itself, which is trivially bit-identical.
  it("src-zoom: grabbing the grip without moving is an EXACT (bit-identical) no-op", () => {
    const b = boundsOf(m, measure);
    const handles = resizeHandlesFor(m, b, TEST_OUTSET);
    const grip = handles.find((h) => h.id === "src-zoom")!;
    const result = applyResize(m, b, "src-zoom", grip.pos, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(result.zoom).toBe(m.zoom);
    expect(result.width).toBe(m.width);
    expect(result.height).toBe(m.height);
    expect(result.from).toEqual(m.from);
    expect(result.at).toEqual(m.at);
  });

  it("src-zoom: a zero-distance drag (pointer exactly on `at`) is absorbed by the clamp, not a division-by-zero crash", () => {
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-zoom", { x: m.at.x, y: m.at.y }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(Number.isFinite(result.zoom)).toBe(true);
    const src = magnifierSourceRect(m);
    const lo = Math.max(MIN_MAGNIFIER_ZOOM, (2 * TEST_LIMITS.minLens) / Math.min(src.w, src.h));
    expect(result.zoom).toBeCloseTo(lo);
  });

  it("src-zoom: a very long drag saturates at the per-axis lens cap (hi), not an unbounded zoom", () => {
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "src-zoom", { x: m.at.x + 100000, y: m.at.y }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectMagnifierAnnotation;
    const src = magnifierSourceRect(m);
    const hi = Math.min(MAX_MAGNIFIER_ZOOM, (2 * 0.45 * TEST_CANVAS.w) / src.w, (2 * 0.45 * TEST_CANVAS.h) / src.h);
    expect(result.zoom).toBeCloseTo(hi);
  });

  it("`at` is unchanged after every magnifier-rect resize gesture (box handles and the grip alike)", () => {
    const b = boundsOf(m, measure);
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w", "src-zoom"] as const) {
      const result = applyResize(m, b, handle, { x: 300 + OUTSET, y: 220 + OUTSET }, false, TEST_LIMITS, TEST_CANVAS, OUTSET) as RectMagnifierAnnotation;
      expect(result.at).toEqual(m.at);
    }
  });

  it("does not mutate the input annotation", () => {
    const b = boundsOf(m, measure);
    const before = structuredClone(m);
    applyResize(m, b, "se", { x: 999, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, OUTSET);
    applyResize(m, b, "src-zoom", { x: 999, y: 999 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    expect(m).toEqual(before);
  });
});

// Addendum I §I6 (2026-08-09): with 8 handles now ringing a source whose
// short half-extent can be a few CSS px, the handles' touch hit discs can
// swallow the source's own fingertip-floored hit region entirely — this
// predicate is the tie-break that keeps the source-body (aiming) drag
// reachable in that regime.
describe("magnifierSourceBodyWins", () => {
  const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3); // from (50,50), source rect x30 y40 w40 h20

  it("true at the source center, competing against a distant handle", () => {
    const nearest = { id: "se" as const, dist: 40 }; // some handle 40 units away
    expect(magnifierSourceBodyWins(m, { x: 50, y: 50 }, nearest)).toBe(true); // dist 0 <= 40
  });

  it("true on a tie (dist to `from` exactly equals the nearest handle's distance) — winning ties matches the nearest-wins SHAPE elsewhere in this module", () => {
    const nearest = { id: "se" as const, dist: 10 };
    expect(magnifierSourceBodyWins(m, { x: 60, y: 50 }, nearest)).toBe(true); // dist(60,50 -> 50,50) = 10
  });

  it("false when the press is nearer a handle than the source center", () => {
    const nearest = { id: "se" as const, dist: 5 };
    expect(magnifierSourceBodyWins(m, { x: 200, y: 200 }, nearest)).toBe(false); // dist to `from` is ~180, far > 5
  });

  it("false when there is no nearest handle at all (nothing to fall through from)", () => {
    expect(magnifierSourceBodyWins(m, { x: 50, y: 50 }, null)).toBe(false);
  });

  it("always false for a circle magnifier — its grip sits well clear of the source center (TASK-49 behavior preserved)", () => {
    const circle = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const nearest = { id: "src-zoom" as const, dist: 1000 }; // even an absurdly generous nearest still loses
    expect(magnifierSourceBodyWins(circle, { x: 50, y: 50 }, nearest)).toBe(false);
  });

  it("always false for a non-magnifier annotation", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 });
    const nearest = { id: "se" as const, dist: 1000 };
    expect(magnifierSourceBodyWins(r, { x: 50, y: 50 }, nearest)).toBe(false);
  });

  // §I6 property 1 (reviewer round 2, SHOULD-FIX #2 — the original version
  // of this test was a tautology: `magnifierSourceBodyWins(a, a.from, ...)`
  // is `true` for ANY non-null `nearest`, since `dist(from, from) === 0`
  // always. This version instead pins the actual RADIUS of the non-empty
  // body core at the source's floor size, so a silent reduction of
  // `MAGNIFIER_SRC_HANDLE_OUTSET_PX` (or of `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX`)
  // would fail it.
  //
  // At the floor, the source is a `2*floorSrcHalf` square (`floorSrcHalf =
  // limits.minRectSource`), so the nearest ring handle in ANY cardinal
  // direction (n/e/s/w — an edge midpoint) sits exactly `floorSrcHalf +
  // outset` from `from`; along that direction, `magnifierSourceBodyWins`'s
  // own `dist(p, from) <= dist(p, nearest handle)` flips exactly at the
  // midpoint, `r = (floorSrcHalf + outset) / 2` — `(4 + 14) / 2 = 9` for this
  // fixture's floor/production-outset values, confirmed numerically (a
  // corner handle sits further out, at `hypot(floorSrcHalf+outset,
  // floorSrcHalf+outset)`, so its own boundary radius is strictly LARGER —
  // 9 is the minimum over every direction, i.e. the guaranteed non-empty
  // core's radius, not just a per-direction figure).
  it("property 1: the non-empty body core has radius (floorSrcHalf + outset) / 2 at the source's floor size — a ring just inside wins everywhere, and moving out along the nearest-handle direction loses", () => {
    const limits = magnifierSizeLimits(TEST_CANVAS, 1);
    const floorSrcHalf = limits.minRectSource; // smallest legal source half-extent (4 for this fixture)
    const outset = 14; // production-realistic (canvas.ts's MAGNIFIER_SRC_HANDLE_OUTSET_PX, unscaled)
    const tiny = rectMagnifier({ x: 200, y: 150 }, 2 * floorSrcHalf * 3, 2 * floorSrcHalf * 3, { x: 50, y: 50 }, 3);
    const b = boundsOf(tiny, measure);
    const boxHandles = resizeHandlesFor(tiny, b, outset).filter((h) => h.shape !== "grip");
    const bodyWinsAt = (p: Point) => magnifierSourceBodyWins(tiny, p, nearestHandle(boxHandles, p, 1000));

    const boundaryRadius = (floorSrcHalf + outset) / 2; // == 9 for this fixture
    const eps = 0.01;

    // A ring of points at radius (boundary - eps), swept over every angle,
    // must ALL win — this is the "never empty" claim, not just a single
    // point on one axis.
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const p = { x: tiny.from.x + (boundaryRadius - eps) * Math.cos(rad), y: tiny.from.y + (boundaryRadius - eps) * Math.sin(rad) };
      expect(bodyWinsAt(p)).toBe(true);
    }

    // Just past the boundary, ALONG the nearest-handle (cardinal) direction
    // specifically, the tie-break flips to the handle.
    const justPast = { x: tiny.from.x + boundaryRadius + eps, y: tiny.from.y };
    expect(bodyWinsAt(justPast)).toBe(false);
  });

  // §I6 property 2 (reviewer round 2, BLOCKING #1 — the original version of
  // this test only asserted `distFromFrom >= shortHalf`, which never
  // consulted `magnifierHitPart` at all and was trivially true by
  // construction (handles ring OUTSIDE the source). This version actually
  // exercises the claim in resize.ts's own doc comment ("asserted in
  // resize.test.ts"): sweep a pointer grid around `from` over a range of
  // source sizes, and wherever `magnifierSourceBodyWins` fires, confirm
  // `magnifierHitPart` really does resolve to `"source"` — for BOTH
  // production parameter pairs (mouse and touch), which differ in the
  // handles' own hit radius and the source's minimum hit half-extent
  // (`canvas.ts`'s `handleHitRadius`/`magnifierSourceMinHit`, touch 2x'd;
  // `srcHandleOutset` itself is NOT touch-multiplied, so it stays 14 for
  // both). `tolerance` is production's `BASE_TOL_PX` (6, at `cropScale() ===
  // 1`) — `magnifierHitPart` adds `markerStroke/2` to it internally, exactly
  // as `canvas.ts`'s call site relies on.
  it("property 2: every point where the body-wins tie-break fires lands inside the source's own hit region, swept over a range of source sizes and pointer offsets", () => {
    const OUTSET = 14; // production MAGNIFIER_SRC_HANDLE_OUTSET_PX, never touch-multiplied
    const TOLERANCE = 6; // production BASE_TOL_PX at cropScale() === 1
    const PARAM_SETS = [
      { name: "mouse", handleHitRadius: 12, sourceMinHit: 11 }, // HANDLE_HIT_PX, MAGNIFIER_SOURCE_MIN_HIT_HALF_PX
      { name: "touch", handleHitRadius: 24, sourceMinHit: 22 }, // both x TOUCH_HIT_MULTIPLIER(2)
    ];
    // The reviewer's own verification swept srcHalf in [4,200]^2 with a
    // +-60px pointer grid; this mirrors that (a coarser step to stay fast —
    // still exercises every qualitatively different regime: floor-sized,
    // small, medium, and large sources on both axes).
    const srcHalves = [4, 10, 25, 60, 120, 200];

    let checked = 0;
    for (const { name, handleHitRadius, sourceMinHit } of PARAM_SETS) {
      for (const srcHalfW of srcHalves) {
        for (const srcHalfH of srcHalves) {
          // Lens parked far away so it can never overlap the swept pointer
          // grid around `from` (which would otherwise let `magnifierHitPart`
          // resolve to `"lens"` first, contaminating the property).
          const zoom = 3;
          const tiny = rectMagnifier({ x: 5200, y: 5200 }, 2 * srcHalfW * zoom, 2 * srcHalfH * zoom, { x: 50, y: 50 }, zoom);
          const b = boundsOf(tiny, measure);
          const boxHandles = resizeHandlesFor(tiny, b, OUTSET).filter((h) => h.shape !== "grip");

          for (let dx = -60; dx <= 60; dx += 4) {
            for (let dy = -60; dy <= 60; dy += 4) {
              const p = { x: tiny.from.x + dx, y: tiny.from.y + dy };
              const nearest = nearestHandle(boxHandles, p, handleHitRadius);
              if (magnifierSourceBodyWins(tiny, p, nearest)) {
                checked++;
                expect(magnifierHitPart(tiny, p, TOLERANCE, sourceMinHit), `${name} srcHalf(${srcHalfW},${srcHalfH}) offset(${dx},${dy})`).toBe(
                  "source",
                );
              }
            }
          }
        }
      }
    }
    // Sanity: the sweep actually exercised the body-wins branch many times —
    // an empty sweep (e.g. from a broken fixture) would vacuously "pass".
    expect(checked).toBeGreaterThan(100);
  });
});

// Addendum D §D9/§D10 (2026-08-08, reviewer nits N1/N2/N7): a box-handle
// resize used to (N1) silently break a Shift-locked aspect ratio if a cap
// tripped, since each axis was pulled back independently instead of scaled
// together, and (N2) only clamped the axis the dragged handle actually
// touched, so the OTHER axis could stay out of range after the drag — a
// TASK-48 AC#6 regression ("annotations below the current operability floor
// snap into range on their first size-affecting edit"). BOTH rulings survive
// Addendum I (2026-08-09) verbatim — only their UNITS changed (SOURCE, not
// LENS) since the box handles were re-based onto the source. Every case below
// also checks the source-min invariant this whole clamp exists to protect
// (N7): `width/zoom >= 2*minRectSource` and `height/zoom >= 2*minRectSource`.
// TEST_OUTSET (0) is used throughout this describe block for arithmetic
// clarity — the outset inversion itself has its own dedicated no-op coverage
// in the "magnifier rect (Addendum I...)" describe block above.
describe("applyResize: magnifier rect box handle — uniform scale-back under Shift and two-axis clamping, re-expressed in SOURCE units (Addendum D §D9/§D10 rulings survive verbatim; Addendum I §I4 re-bases them)", () => {
  it("D9: Shift+corner drag on a canvas where the height cap trips scales BOTH SOURCE axes uniformly, preserving the pre-drag aspect ratio exactly", () => {
    // maxSrcH = 2*0.45*200/3 = 60 is far tighter than maxSrcW = 2*0.45*2000/3 = 600,
    // so an aspect-locked (2:1) se-corner drag toward a huge pointer trips the
    // height cap first; D9 requires the width to scale back by the SAME
    // factor rather than being independently re-clamped.
    const canvas = { w: 2000, h: 200 };
    const limits = magnifierSizeLimits(canvas, 1);
    const m = rectMagnifier({ x: 200, y: 150 }, 100, 50, { x: 50, y: 50 }, 3); // 2:1 aspect
    const src = magnifierSourceRect(m);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "se", { x: 2000, y: 1000 }, true, limits, canvas, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(result.width / result.height).toBeCloseTo(2, 9); // pre-drag aspect survives exactly
    expect(result.height).toBeCloseTo(2 * 0.45 * canvas.h); // pinned at the tripped cap (LENS units)
    const srcW = result.width / result.zoom;
    const srcH = result.height / result.zoom;
    expect(result.from.x - srcW / 2).toBeCloseTo(src.x); // pinned SOURCE nw.x
    expect(result.from.y - srcH / 2).toBeCloseTo(src.y); // pinned SOURCE nw.y
    expect(result.at).toEqual({ x: 200, y: 150 }); // I3: `at` never moves under a box-handle drag
    expect(result.zoom).toBe(3);
    // N7: source-min invariant.
    expect(srcW).toBeGreaterThanOrEqual(2 * limits.minRectSource - 1e-9);
    expect(srcH).toBeGreaterThanOrEqual(2 * limits.minRectSource - 1e-9);
  });

  it("D10/TASK-48 AC#6: an out-of-range SOURCE dragged 1px east snaps BOTH axes into range, not just the dragged one — the untouched axis re-centers on its pre-drag `from.y`", () => {
    // A pre-existing annotation somehow above both caps (legal — resize only
    // clamps on edit, per the module's own "clamps are edit-time only" policy).
    const canvas = { w: 1000, h: 800 };
    const limits = magnifierSizeLimits(canvas, 1); // maxSrcW=300, maxSrcH=240 (LENS caps 900/720, / zoom(3))
    const m = rectMagnifier({ x: 500, y: 400 }, 1000, 800, { x: 50, y: 50 }, 3); // source 333.3x266.7, already above both caps
    const src = magnifierSourceRect(m);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "e", { x: src.x + src.w + 1, y: 400 }, false, limits, canvas, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(result.width).toBeCloseTo(2 * 0.45 * canvas.w); // 900, capped
    expect(result.height).toBeCloseTo(2 * 0.45 * canvas.h); // 720, capped even though "e" never touched this axis
    expect(result.from.y).toBeCloseTo(m.from.y); // re-centered on the pre-drag SOURCE center, not left out of range
    expect(result.at).toEqual({ x: 500, y: 400 }); // I3: `at` never moves under a box-handle drag
    // N7.
    expect(result.width / result.zoom).toBeGreaterThanOrEqual(2 * limits.minRectSource - 1e-9);
    expect(result.height / result.zoom).toBeGreaterThanOrEqual(2 * limits.minRectSource - 1e-9);
  });

  it("D10/TASK-48 AC#6: an under-floor SOURCE height snaps up to minSrcPx, centre-pinned on its pre-drag `from.y`, on a `w` (west-edge) drag", () => {
    const canvas = { w: 1000, h: 800 };
    const limits = magnifierSizeLimits(canvas, 1);
    const m = rectMagnifier({ x: 500, y: 400 }, 200, 10, { x: 50, y: 50 }, 3); // source height well under minSrcPx
    const src = magnifierSourceRect(m);
    const b = boundsOf(m, measure);
    const result = applyResize(m, b, "w", { x: src.x - 20, y: src.y }, false, limits, canvas, TEST_OUTSET) as RectMagnifierAnnotation;
    const minSrcPx = 2 * Math.max(limits.minLens / m.zoom, limits.minRectSource);
    expect(result.height / result.zoom).toBeCloseTo(minSrcPx);
    expect(result.height).toBeCloseTo(2 * Math.max(limits.minLens, m.zoom * limits.minRectSource)); // == the pre-Addendum-I lens-unit minPx
    expect(result.from.y).toBeCloseTo(m.from.y); // re-centered on the pre-drag SOURCE center
    expect(result.at).toEqual({ x: 500, y: 400 }); // I3: `at` never moves under a box-handle drag
    expect(result.width).toBeCloseTo((src.w + 20) * m.zoom); // the touched (west) axis reflects the drag directly
    // N7.
    expect(result.width / result.zoom).toBeGreaterThanOrEqual(2 * limits.minRectSource - 1e-9);
    expect(result.height / result.zoom).toBeGreaterThanOrEqual(2 * limits.minRectSource - 1e-9);
  });
});

// Addendum G (2026-08-08, user request (1) — "the rect magnifier's source
// must shrink much further"), restated by Addendum I (2026-08-09) for the
// grip's inverted mapping: the SHRINK now happens via the box handles, not
// the grip (which holds the source fixed) — so the regression contract this
// block protects becomes "a small source can still be magnified to zoom >= 8
// before the per-axis lens cap binds", exercised via the grip alone.
describe("applyResize: magnifier rect src-zoom on a phone-scale fixture (Addendum G's regression contract, restated for Addendum I's inverted grip mapping)", () => {
  it("a small SOURCE can still be magnified to zoom >= 8 before the per-axis lens cap binds, on a 2532x1170 canvas at cropScale 7", () => {
    const canvas = { w: 2532, h: 1170 };
    const scale = 7;
    const limits = magnifierSizeLimits(canvas, scale);
    const from = { x: 600, y: 300 };
    // A phone-scale SOURCE (100x100 bitmap px, comfortably above
    // minRectSource at this scale) — the scenario Addendum G's "shrink the
    // source further" request was about, now reached via the box handles
    // rather than the grip.
    const m = rectMagnifier({ x: 700, y: 400 }, 200, 200, from, 2);
    const src = magnifierSourceRect(m);
    expect(Math.max(src.w, src.h)).toBeLessThanOrEqual(120); // phone-scale, not a full-screen source
    const b = boundsOf(m, measure);
    // Drag the grip (now on the LENS's SE corner) far from `at` — a large
    // radial distance requests a large ratio, absorbed by
    // `clampRectZoomForSource`'s own per-axis lens-cap ceiling.
    const result = applyResize(m, b, "src-zoom", { x: m.at.x + 100000, y: m.at.y }, false, limits, canvas, TEST_OUTSET) as RectMagnifierAnnotation;
    expect(result.zoom).toBeGreaterThanOrEqual(8);
    // Sanity: still within the documented [MIN,MAX] range, not a runaway value.
    expect(result.zoom).toBeLessThanOrEqual(16);
    // Source held fixed under the grip's gesture (§I5) — the shrink happens
    // via the box handles, not this grip.
    expect(result.from).toEqual(from);
  });
});

describe("applyResize: highlight", () => {
  it("returns the original annotation unchanged (resize-exempt)", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const b = boundsOf(h, measure);
    const result = applyResize(h, b, "se" as never, { x: 500, y: 500 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
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
    const result = applyResize(r, b, "se", { x: 150, y: 80 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation & { angle?: number };
    expect(result.angle).toBe(0.3);
  });

  it("badge", () => {
    const bd = { ...badge({ x: 50, y: 50 }, 20), angle: -0.5 };
    const b = boundsOf(bd, measure);
    const result = applyResize(bd, b, "se", { x: 90, y: 66 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as BadgeAnnotation & { angle?: number };
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

describe("deleteButtonCornerFor", () => {
  const padded: Bounds = { x: 100, y: 100, w: 80, h: 80 };
  const btn = { w: 30, h: 30 };
  const margin = 8;
  const stage = { w: 400, h: 400 };

  it("avoid circle far away: NE, byte-identical to the pre-existing NE formula (left 188, top 62)", () => {
    const result = deleteButtonCornerFor(padded, btn, margin, stage, { center: { x: 50, y: 350 }, radius: 40 });
    expect(result).toEqual({ corner: "ne", left: 188, top: 62 });
  });

  it("avoid circle over the NE candidate: falls back to NW, and the NW rect clears the circle", () => {
    const avoid = { center: { x: 200, y: 80 }, radius: 50 };
    const result = deleteButtonCornerFor(padded, btn, margin, stage, avoid);
    expect(result?.corner).toBe("nw");
    const { left, top } = result!;
    const dx = Math.max(left - avoid.center.x, 0, avoid.center.x - (left + btn.w));
    const dy = Math.max(top - avoid.center.y, 0, avoid.center.y - (top + btn.h));
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(avoid.radius);
  });

  it("wide circle spanning the whole top edge: both NE and NW are covered, falls through to SE", () => {
    const result = deleteButtonCornerFor(padded, btn, margin, stage, { center: { x: 200, y: 0 }, radius: 150 });
    expect(result).toEqual({ corner: "se", left: 188, top: 188 });
  });

  it("huge circle engulfing all four candidates: null (caller falls back to the legacy path)", () => {
    const result = deleteButtonCornerFor(padded, btn, margin, stage, { center: { x: 150, y: 150 }, radius: 1000 });
    expect(result).toBeNull();
  });

  it("stage-fit precedence: NE overflows a narrow stage even with a far-away avoid circle, so NW wins", () => {
    const narrowStage = { w: 200, h: 400 };
    const result = deleteButtonCornerFor(padded, btn, margin, narrowStage, { center: { x: 50, y: 350 }, radius: 40 });
    expect(result?.corner).toBe("nw");
  });

  it("boundary exactness: nearest-point distance exactly equal to the radius still qualifies (pins >=)", () => {
    // NE rect is [188,218] x [62,92]; center (158,77) is vertically inside that
    // y-range, so the nearest point is purely horizontal: dx = 188-158 = 30.
    const avoid = { center: { x: 158, y: 77 }, radius: 30 };
    const result = deleteButtonCornerFor(padded, btn, margin, stage, avoid);
    expect(result).toEqual({ corner: "ne", left: 188, top: 62 });
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

  it("magnifier circle: always the lens center `at`, for every handle (lens corners and src-zoom alike)", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    expect(anchorPointFor(m, b, "se")).toEqual({ x: 200, y: 150 });
    expect(anchorPointFor(m, b, "nw")).toEqual({ x: 200, y: 150 });
    expect(anchorPointFor(m, b, "src-zoom")).toEqual({ x: 200, y: 150 });
  });

  // Addendum I (2026-08-09): now EXACT for the rect too — the box handles
  // moved to the SOURCE (I2/I3), so `at` is invariant under every rect
  // magnifier gesture as well, not just the circle's. The pre-Addendum-I "at"
  // used to move under a box resize (D5); this is a correctness fix, not
  // just a comment update (though `angle` can never be nonzero for a
  // magnifier in the running app, so it was never actually exercised there).
  it("magnifier rect: always the lens center `at`, for every handle (box handles and src-zoom alike)", () => {
    const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3);
    const b = boundsOf(m, measure);
    expect(anchorPointFor(m, b, "se")).toEqual({ x: 200, y: 150 });
    expect(anchorPointFor(m, b, "nw")).toEqual({ x: 200, y: 150 });
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
    const resized = applyResize(original, boundsPredrag, handle, localPointer, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET) as RectAnnotation & {
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
    const resized = applyResize(original, b, "se", { x: 150, y: 80 }, false, TEST_LIMITS, TEST_CANVAS, TEST_OUTSET);
    const bAfter = boundsOf(resized, measure);
    const d = reanchorDelta(anchorLocal, b, bAfter, 0);
    expect(d).toEqual({ x: 0, y: 0 });
  });
});
