import { describe, it, expect } from "vitest";
import {
  magnifierSourceRadius,
  magnifierSourceRect,
  magnifierLensRect,
  clampSampleRect,
  connectorShape,
  placeLens,
  clampLensCenter,
  clampPointToCanvas,
  deriveLensSizeForSource,
  defaultSourceRadius,
  magnifierSlideUpdate,
  magnifierSizeLimits,
  clampZoom,
  MIN_MAGNIFIER_ZOOM,
  MAX_MAGNIFIER_ZOOM,
  MIN_MAGNIFIER_SOURCE_RADIUS_PX,
  MIN_MAGNIFIER_RECT_SOURCE_CSS_PX,
  MAGNIFIER_SOURCE_RADIUS_FRACTION,
  MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO,
  magnifierRectConnectorLines,
  type MagnifierConnectorLine,
  placeRectLens,
  clampRectLensCenter,
  clampRectZoom,
  clampRectZoomForSource,
  deriveRectLensSize,
  magnifierRectSlideUpdate,
  MAGNIFIER_RECT_ASPECT,
  MAGNIFIER_GAP_PX,
  MAGNIFIER_MAX_LENS_FRACTION,
  type MagnifierSizeLimits,
} from "./magnifier";
import { magnifierMarkerStroke, MAGNIFIER_LENS_STROKE_RATIO } from "./render";
import { computeAnnotationScale, STROKE_PRESETS, ANNOTATION_SCALE_BASELINE } from "./model";
import type { CircleMagnifierAnnotation, RectMagnifierAnnotation, Point } from "./model";

function magnifier(overrides: Partial<CircleMagnifierAnnotation> = {}): CircleMagnifierAnnotation {
  return {
    id: "m1",
    kind: "magnifier",
    color: "#ED107B",
    strokeWidth: 6,
    at: { x: 200, y: 150 },
    radius: 60,
    zoom: 3,
    from: { x: 50, y: 50 },
    ...overrides,
  };
}

function rectMagnifier(overrides: Partial<RectMagnifierAnnotation> = {}): RectMagnifierAnnotation {
  return {
    id: "m1",
    kind: "magnifier",
    shape: "rect",
    color: "#ED107B",
    strokeWidth: 6,
    at: { x: 200, y: 150 },
    width: 120,
    height: 60,
    zoom: 3,
    from: { x: 50, y: 50 },
    ...overrides,
  };
}

describe("magnifierSourceRadius", () => {
  it("is radius / zoom", () => {
    expect(magnifierSourceRadius(magnifier({ radius: 60, zoom: 3 }))).toBeCloseTo(20);
  });
});

describe("magnifierSourceRect / magnifierLensRect", () => {
  it("source rect is the bounding square of the source circle, centered on from", () => {
    const a = magnifier({ from: { x: 50, y: 40 }, radius: 60, zoom: 3 }); // sourceRadius = 20
    expect(magnifierSourceRect(a)).toEqual({ x: 30, y: 20, w: 40, h: 40 });
  });

  it("lens rect is the bounding square of the lens circle, centered on at", () => {
    const a = magnifier({ at: { x: 200, y: 150 }, radius: 60 });
    expect(magnifierLensRect(a)).toEqual({ x: 140, y: 90, w: 120, h: 120 });
  });

  it("rect: source rect is (width/zoom) x (height/zoom), centered on from (D2)", () => {
    const a = rectMagnifier({ from: { x: 50, y: 40 }, width: 120, height: 60, zoom: 3 }); // (40 x 20)
    expect(magnifierSourceRect(a)).toEqual({ x: 30, y: 30, w: 40, h: 20 });
  });

  it("rect: lens rect is width x height, centered on at (D2)", () => {
    const a = rectMagnifier({ at: { x: 200, y: 150 }, width: 120, height: 60 });
    expect(magnifierLensRect(a)).toEqual({ x: 140, y: 120, w: 120, h: 60 });
  });
});

describe("clampSampleRect", () => {
  const dest = { x: 100, y: 100, w: 50, h: 50 };

  it("fully inside: passes src/dest through unchanged", () => {
    const src = { x: 10, y: 10, w: 20, h: 20 };
    const result = clampSampleRect(src, 100, 100, dest);
    expect(result).toEqual({ src, dest });
  });

  it("partly outside: clips src and maps the same fraction onto dest", () => {
    // src spans x:[-10,10] (half outside on the left), y:[0,20] (fully inside).
    const src = { x: -10, y: 0, w: 20, h: 20 };
    const result = clampSampleRect(src, 100, 100, dest);
    expect(result).not.toBeNull();
    // Clipped src: x:[0,10] -> w=10 (half of the original 20).
    expect(result!.src).toEqual({ x: 0, y: 0, w: 10, h: 20 });
    // Clipped fraction: x offset 0.5, width fraction 0.5; y offset 0, height fraction 1.
    expect(result!.dest.x).toBeCloseTo(125); // 100 + 0.5*50
    expect(result!.dest.y).toBeCloseTo(100);
    expect(result!.dest.w).toBeCloseTo(25); // 0.5*50
    expect(result!.dest.h).toBeCloseTo(50);
  });

  it("fully outside: returns null", () => {
    const src = { x: -50, y: -50, w: 20, h: 20 };
    expect(clampSampleRect(src, 100, 100, dest)).toBeNull();
  });

  it("zero-area src: returns null", () => {
    expect(clampSampleRect({ x: 10, y: 10, w: 0, h: 20 }, 100, 100, dest)).toBeNull();
    expect(clampSampleRect({ x: 10, y: 10, w: 20, h: 0 }, 100, 100, dest)).toBeNull();
  });

  it("zero-area clip result (touching the bitmap edge only): returns null", () => {
    // src touches the right edge of the bitmap at a single line -> zero-width intersection.
    const src = { x: 100, y: 0, w: 20, h: 20 };
    expect(clampSampleRect(src, 100, 100, dest)).toBeNull();
  });
});

// hypot(p - c) - r ~= 0, i.e. p lies on the circle centered at c with radius r.
function expectOnCircle(p: Point, c: Point, r: number) {
  expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(r, 5);
}

// Midpoint of the two corners belonging to one end edge — equals the
// trimmed axis point (`p1`/`p2`) that edge is centered on, by construction
// (corner = axisPoint +- n*w/2, so the average cancels the +-n*w/2 term).
function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// A point on `lens`'s circle at a given angle — used to turn the returned
// `{startAngle, endAngle}` back into Cartesian points for assertions,
// mirroring what `ctx.arc()`/`path.arc()` actually trace.
function pointOnArc(lens: { center: Point; radius: number }, angle: number): Point {
  return { x: lens.center.x + lens.radius * Math.cos(angle), y: lens.center.y + lens.radius * Math.sin(angle) };
}

describe("connectorShape", () => {
  it("source edge: two points symmetric about p1 (which lies on the source rim), perpendicular to the axis, separated by w1", () => {
    const c1 = { x: 0, y: 0 };
    const r1 = 10;
    const c2 = { x: 100, y: 40 };
    const r2 = 30;
    const w1 = 4;
    const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    const u = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d };
    const shape = connectorShape(c1, r1, c2, r2, w1, 8)!;
    expect(shape).not.toBeNull();
    const [s0, s1] = shape.source;
    const p1 = midpoint(s0, s1);
    expectOnCircle(p1, c1, r1);
    const edge = { x: s0.x - s1.x, y: s0.y - s1.y };
    expect(edge.x * u.x + edge.y * u.y).toBeCloseTo(0, 5); // perpendicular to the axis
    expect(Math.hypot(edge.x, edge.y)).toBeCloseTo(w1, 5);
  });

  it("the arc's two endpoints lie exactly on the lens rim, and lens.center/lens.radius match c2/r2 directly", () => {
    const c2 = { x: 100, y: 40 };
    const r2 = 30;
    const shape = connectorShape({ x: 0, y: 0 }, 10, c2, r2, 4, 8)!;
    expect(shape.lens.center).toEqual(c2);
    expect(shape.lens.radius).toBe(r2);
    expectOnCircle(pointOnArc(shape.lens, shape.lens.startAngle), c2, r2);
    expectOnCircle(pointOnArc(shape.lens, shape.lens.endAngle), c2, r2);
  });

  it("the arc endpoints' separation (chord length) equals w2, when w2 is not saturated by the geometric cap", () => {
    const c2 = { x: 100, y: 40 };
    const r2 = 30;
    const w2 = 8; // well under MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO(1.0) * r2 = 30
    const shape = connectorShape({ x: 0, y: 0 }, 10, c2, r2, 4, w2)!;
    const p0 = pointOnArc(shape.lens, shape.lens.startAngle);
    const p1e = pointOnArc(shape.lens, shape.lens.endAngle);
    expect(Math.hypot(p0.x - p1e.x, p0.y - p1e.y)).toBeCloseTo(w2, 5);
  });

  it("theta = asin(w2 / (2*r2)): the arc's angular span (endAngle - startAngle) equals 2*theta", () => {
    const r2 = 30;
    const w2 = 8;
    const shape = connectorShape({ x: 0, y: 0 }, 10, { x: 100, y: 40 }, r2, 4, w2)!;
    const theta = Math.asin(w2 / (2 * r2));
    expect(shape.lens.endAngle - shape.lens.startAngle).toBeCloseTo(2 * theta, 5);
  });

  it("the arc's angular bisector points along -u (back toward the source), i.e. (startAngle + endAngle) / 2 === atan2(-u.y, -u.x)", () => {
    const c1 = { x: 5, y: 5 };
    const r1 = 8;
    const c2 = { x: 90, y: 60 };
    const r2 = 25;
    const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    const u = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d };
    const beta = Math.atan2(-u.y, -u.x);
    const shape = connectorShape(c1, r1, c2, r2, 4, 8)!;
    const bisector = (shape.lens.startAngle + shape.lens.endAngle) / 2;
    expect(bisector).toBeCloseTo(beta, 5);
  });

  it("startAngle sits on the same (+n) side as source[0] while endAngle sits on the same (-n) side as source[1]", () => {
    const c1 = { x: 0, y: 0 };
    const r1 = 10;
    const c2 = { x: 100, y: 40 };
    const r2 = 30;
    const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    const u = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d };
    const shape = connectorShape(c1, r1, c2, r2, 4, 8)!;

    const p1 = midpoint(shape.source[0], shape.source[1]);
    const beta = (shape.lens.startAngle + shape.lens.endAngle) / 2;
    const p2 = pointOnArc(shape.lens, beta); // the un-widened rim point the arc is centered on
    const startPoint = pointOnArc(shape.lens, shape.lens.startAngle);
    const endPoint = pointOnArc(shape.lens, shape.lens.endAngle);
    // Same 2D cross-product side-test as the earlier flat-quad tests used.
    const side = (p: Point, axisPoint: Point) => u.x * (p.y - axisPoint.y) - u.y * (p.x - axisPoint.x);
    expect(Math.sign(side(shape.source[0], p1))).toBe(Math.sign(side(startPoint, p2)));
    expect(Math.sign(side(shape.source[1], p1))).toBe(Math.sign(side(endPoint, p2)));
    expect(Math.sign(side(shape.source[0], p1))).not.toBe(Math.sign(side(shape.source[1], p1)));
  });

  it("invariant: the arc endpoints never retreat past p1 along the axis (design note §8.2's 'axial extent d - r2*cos(theta) >= d - r2' claim) — checked for a normal case and the saturated short-wedge case", () => {
    const cases: Array<{ c1: Point; r1: number; c2: Point; r2: number; w1: number; w2: number }> = [
      { c1: { x: 0, y: 0 }, r1: 10, c2: { x: 100, y: 40 }, r2: 30, w1: 4, w2: 8 }, // normal, unsaturated
      { c1: { x: 0, y: 0 }, r1: 10, c2: { x: 22.001, y: 0 }, r2: 10, w1: 4, w2: 50 }, // short-wedge, w2 saturates
    ];
    for (const { c1, r1, c2, r2, w1, w2 } of cases) {
      const d = Math.hypot(c2.x - c1.x, c2.y - c1.y);
      const u = { x: (c2.x - c1.x) / d, y: (c2.y - c1.y) / d };
      const p1 = { x: c1.x + r1 * u.x, y: c1.y + r1 * u.y };
      const projOntoU = (p: Point) => (p.x - c1.x) * u.x + (p.y - c1.y) * u.y; // signed distance from c1 along u
      const projP1 = projOntoU(p1);
      const shape = connectorShape(c1, r1, c2, r2, w1, w2)!;
      const arcStart = pointOnArc(shape.lens, shape.lens.startAngle);
      const arcEnd = pointOnArc(shape.lens, shape.lens.endAngle);
      expect(projOntoU(arcStart)).toBeGreaterThanOrEqual(projP1 - 1e-9);
      expect(projOntoU(arcEnd)).toBeGreaterThanOrEqual(projP1 - 1e-9);
    }
  });

  it("saturates w2 at MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO * r2 when the requested w2 exceeds it", () => {
    const r2 = 10;
    const w2 = 100; // far exceeds MAX_LENS_WIDTH_RATIO(1.0) * r2 = 10
    const shape = connectorShape({ x: 0, y: 0 }, 10, { x: 100, y: 40 }, r2, 4, w2)!;
    const p0 = pointOnArc(shape.lens, shape.lens.startAngle);
    const p1e = pointOnArc(shape.lens, shape.lens.endAngle);
    const chord = Math.hypot(p0.x - p1e.x, p0.y - p1e.y);
    expect(chord).toBeCloseTo(MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO * r2, 5);
    expect(chord).toBeLessThan(w2);
  });

  it("w2 = 0 (passed directly, r2 > 0): degenerates to a zero-width arc — a single point ON THE RIM, finite, no NaN", () => {
    const c2 = { x: 100, y: 40 };
    const r2 = 30;
    const shape = connectorShape({ x: 0, y: 0 }, 10, c2, r2, 4, 0)!;
    expect(shape).not.toBeNull();
    expect(shape.lens.startAngle).toBeCloseTo(shape.lens.endAngle, 10);
    expect(Number.isFinite(shape.lens.startAngle)).toBe(true);
    expectOnCircle(pointOnArc(shape.lens, shape.lens.startAngle), c2, r2);
  });

  it("degenerate r2 = 0: the geometric cap forces the effective w2 to 0 and theta to 0 without a NaN from asin(0/0) — the 'arc' collapses to a single point AT THE LENS CENTER", () => {
    const c2 = { x: 100, y: 40 };
    const shape = connectorShape({ x: 0, y: 0 }, 10, c2, 0, 4, 8)!;
    expect(shape).not.toBeNull();
    expect(shape.lens.radius).toBe(0);
    expect(shape.lens.startAngle).toBeCloseTo(shape.lens.endAngle, 10);
    expect(Number.isFinite(shape.lens.startAngle)).toBe(true);
    expect(Number.isFinite(shape.lens.endAngle)).toBe(true);
    expect(pointOnArc(shape.lens, shape.lens.startAngle)).toEqual(c2);
  });

  it("null when circles overlap", () => {
    expect(connectorShape({ x: 0, y: 0 }, 20, { x: 10, y: 0 }, 20, 4, 8)).toBeNull();
  });

  it("null when circles are touching exactly (d === r1+r2)", () => {
    expect(connectorShape({ x: 0, y: 0 }, 10, { x: 20, y: 0 }, 10, 4, 8)).toBeNull();
  });

  it("null when one circle contains the other", () => {
    expect(connectorShape({ x: 0, y: 0 }, 50, { x: 5, y: 5 }, 5, 4, 8)).toBeNull();
  });

  it("null when centers coincide (d === 0)", () => {
    expect(connectorShape({ x: 10, y: 10 }, 5, { x: 10, y: 10 }, 20, 4, 8)).toBeNull();
  });

  it("null when rim gap is smaller than MAGNIFIER_CONNECTOR_MIN_GAP_PX", () => {
    // d = 21, r1+r2 = 20 -> gap = 1 < MAGNIFIER_CONNECTOR_MIN_GAP_PX (2).
    expect(connectorShape({ x: 0, y: 0 }, 10, { x: 21, y: 0 }, 10, 4, 8)).toBeNull();
  });

  it("non-null once the rim gap clears MAGNIFIER_CONNECTOR_MIN_GAP_PX", () => {
    // d = 23, r1+r2 = 20 -> gap = 3 >= 2.
    expect(connectorShape({ x: 0, y: 0 }, 10, { x: 23, y: 0 }, 10, 4, 8)).not.toBeNull();
  });

  it("degenerate short-wedge case (gap just past MIN_GAP, huge requested w2) still returns a finite, well-formed shape", () => {
    // d = 22.001, r1+r2 = 20 -> gap = 2.001, barely past MAGNIFIER_CONNECTOR_MIN_GAP_PX (2).
    const c1 = { x: 0, y: 0 };
    const r1 = 10;
    const c2 = { x: 22.001, y: 0 };
    const r2 = 10;
    const shape = connectorShape(c1, r1, c2, r2, 4, 50); // w2=50 saturates to MAX_RATIO(1.0)*r2=10
    expect(shape).not.toBeNull();
    const { source, lens } = shape!;
    for (const p of [source[0], source[1]]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(Number.isFinite(lens.startAngle)).toBe(true);
    expect(Number.isFinite(lens.endAngle)).toBe(true);
    expect(lens.startAngle).not.toBeCloseTo(lens.endAngle, 3); // a real, non-zero arc span
  });
});

describe("placeLens", () => {
  const canvasSize = { w: 1000, h: 800 };

  it("picks E (first candidate) when it fits fully on-canvas", () => {
    const from = { x: 500, y: 400 };
    const result = placeLens(from, 20, 50, canvasSize, 10);
    // E candidate: from + (sourceRadius+gap+lensRadius, 0) = from + (80, 0)
    expect(result).toEqual({ x: 580, y: 400 });
  });

  it("falls back to W when E would fall off the canvas", () => {
    const from = { x: 970, y: 400 }; // near the right edge: E candidate's lens would overflow
    const result = placeLens(from, 20, 50, canvasSize, 10);
    // W candidate: from - (80, 0)
    expect(result).toEqual({ x: 890, y: 400 });
  });

  it("falls back to S when both E and W are blocked", () => {
    // Canvas width exactly 2*lensRadius: from sits dead-center on x, so E/W
    // (which shift x by +-80) both overflow, but S (which keeps x = from.x
    // and only shifts y) fits exactly.
    const from = { x: 50, y: 400 };
    const narrowCanvas = { w: 100, h: 800 };
    const result = placeLens(from, 20, 50, narrowCanvas, 10);
    expect(result).toEqual({ x: 50, y: 480 });
  });

  it("clamp fallback: when no candidate fits fully, returns the farthest-from-`from` candidate after clamping, ties broken toward the earlier candidate", () => {
    // Height (60) is too narrow for the lens (R=50) on any candidate, so
    // every candidate's y collapses to the canvas's vertical center (30).
    // Width (300) is wide enough for x to vary, so E/W (dist 80 from `from`)
    // tie for farthest; E is checked first and wins the tie.
    const from = { x: 150, y: 30 };
    const wideShortCanvas = { w: 300, h: 60 };
    const result = placeLens(from, 20, 50, wideShortCanvas, 10);
    expect(result).toEqual({ x: 230, y: 30 });
  });

  it("clamp fallback degenerate case: both axes too narrow, every candidate collapses to the canvas center", () => {
    const tinyCanvas = { w: 60, h: 60 };
    const from = { x: 30, y: 30 };
    const result = placeLens(from, 5, 50, tinyCanvas, 5);
    expect(result).toEqual({ x: 30, y: 30 });
  });
});

describe("clampLensCenter", () => {
  const canvasSize = { w: 200, h: 150 };

  it("passes a center that's already fully on-canvas through unchanged", () => {
    expect(clampLensCenter({ x: 100, y: 75 }, 30, canvasSize)).toEqual({ x: 100, y: 75 });
  });

  it("clamps an out-of-range x down to W - R", () => {
    expect(clampLensCenter({ x: 500, y: 75 }, 30, canvasSize)).toEqual({ x: 170, y: 75 });
  });

  it("clamps an out-of-range x up to R", () => {
    expect(clampLensCenter({ x: -500, y: 75 }, 30, canvasSize)).toEqual({ x: 30, y: 75 });
  });

  it("clamps each axis independently", () => {
    expect(clampLensCenter({ x: -500, y: 500 }, 30, canvasSize)).toEqual({ x: 30, y: 120 }); // y: H-R = 150-30 = 120
  });

  it("falls back to the canvas-center coordinate on an axis too narrow to hold the lens (size - R < R)", () => {
    const narrow = { w: 40, h: 150 }; // R=30: hi = 40-30 = 10 < R(30)
    expect(clampLensCenter({ x: 500, y: 75 }, 30, narrow)).toEqual({ x: 20, y: 75 }); // x -> w/2 = 20
  });
});

describe("magnifierSizeLimits", () => {
  it("CSS-px minima scale linearly with `scale` when neither canvas cap bites", () => {
    // shortSide=4000: SOURCE_SHORT_SIDE_CAP*shortSide=600, maxLens=0.45*4000=1800 —
    // both caps are far above the CSS-scaled minima below, so they don't bite.
    const limits = magnifierSizeLimits({ w: 5000, h: 4000 }, 2);
    expect(limits.minSource).toBeCloseTo(20 * 2); // MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX * scale
    expect(limits.minLens).toBeCloseTo(28 * 2); // MIN_MAGNIFIER_LENS_RADIUS_CSS_PX * scale
    expect(limits.maxLens).toBeCloseTo(1800);
  });

  it("both canvas caps bite on a small canvas at a large scale (finger-sized floor kept from becoming absurd)", () => {
    // shortSide=80: SOURCE_SHORT_SIDE_CAP*shortSide=12, maxLens=0.45*80=36.
    // At scale=10 the CSS-scaled minima (160, 280) would exceed both, so the
    // canvas-relative caps win instead.
    const limits = magnifierSizeLimits({ w: 100, h: 80 }, 10);
    expect(limits.minSource).toBeCloseTo(12); // MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide
    expect(limits.maxLens).toBeCloseTo(36); // MAGNIFIER_MAX_LENS_FRACTION * shortSide
    expect(limits.minLens).toBeCloseTo(36); // capped down to maxLens ("hi wins")
  });

  it("MIN_MAGNIFIER_SOURCE_RADIUS_PX is an absolute backstop below which minSource never falls", () => {
    // shortSide=10, scale=0.01: CSS term = 16*0.01=0.16, short-side-cap term = 0.15*10=1.5 -> min=0.16,
    // which is below the MIN_MAGNIFIER_SOURCE_RADIUS_PX(2) backstop, so the backstop wins.
    const limits = magnifierSizeLimits({ w: 10, h: 10 }, 0.01);
    expect(limits.minSource).toBe(MIN_MAGNIFIER_SOURCE_RADIUS_PX);
  });

  it("non-emptiness invariant: minLens >= MIN_MAGNIFIER_ZOOM * minSource, across a table of canvas sizes and scales", () => {
    // Covers the three regimes the design note's proof sketch analyzes: the
    // CSS-scaled terms uncapped by either canvas cap, both canvas caps
    // binding (minSource=SHORT_SIDE_CAP*short, minLens=maxLens), and mixed
    // cases where only one term is canvas-capped. See the DEDICATED test
    // below for the one regime the note's sketch does NOT cover (the
    // absolute MIN_MAGNIFIER_SOURCE_RADIUS_PX backstop with a still-small,
    // scale-proportional minLens) — an accepted exception, not a bug here.
    const table: Array<{ w: number; h: number; scale: number }> = [
      { w: 1000, h: 800, scale: 1 }, // typical desktop window
      { w: 1170, h: 2532, scale: 3.55 }, // iPhone screenshot, ~330 CSS px wide (design note's sanity check)
      { w: 2560, h: 1440, scale: 2.13 }, // desktop capture in a smaller window
      { w: 100, h: 80, scale: 10 }, // pathologically small canvas, huge scale (both caps bind)
      { w: 4000, h: 3000, scale: 0.1 }, // huge canvas shown zoomed far out (minSource backstop-bound, but minLens still clears it)
    ];
    for (const { w, h, scale } of table) {
      const limits = magnifierSizeLimits({ w, h }, scale);
      expect(limits.minLens).toBeGreaterThanOrEqual(MIN_MAGNIFIER_ZOOM * limits.minSource);
    }
  });

  // This test's scale (0.01) is intentionally below 1 to exercise the
  // exception at all: in the running app, `scale` (canvas.ts's cropScale())
  // is never below 1 (fitCanvasToStage clamps its own scale factor via
  // Math.min(1, ...) and never upscales), so with scale >= 1 this failure can
  // only arise when the canvas's short side is under
  // 2.4 / MAGNIFIER_MAX_LENS_FRACTION ~= 5.33 bitmap px — provably
  // unreachable outside a pathological, near-zero-pixel document.
  it("degenerate exception (NOT covered by the design note's non-emptiness proof sketch): on an extremely tiny canvas at an extremely small scale, minSource hits the absolute MIN_MAGNIFIER_SOURCE_RADIUS_PX backstop while minLens stays scale-proportional and small, so minLens >= MIN_MAGNIFIER_ZOOM * minSource can fail — an accepted degenerate-canvas outcome (\"may sit under the operability floor. Documented, tested, not special-cased\" per the design note), not a crash: the limits stay finite, non-negative, and internally well-formed (minLens <= maxLens)", () => {
    const limits = magnifierSizeLimits({ w: 10, h: 10 }, 0.01);
    expect(limits.minSource).toBe(MIN_MAGNIFIER_SOURCE_RADIUS_PX); // backstop-bound, decoupled from `scale`
    expect(limits.minLens).toBeLessThan(MIN_MAGNIFIER_ZOOM * limits.minSource); // the invariant fails here, by design
    expect(limits.minLens).toBeLessThanOrEqual(limits.maxLens); // but the limits remain well-formed
    expect(Number.isFinite(limits.minSource)).toBe(true);
    expect(Number.isFinite(limits.minLens)).toBe(true);
    expect(Number.isFinite(limits.maxLens)).toBe(true);
  });

  it("shortSide-driven: swapping w/h yields the same limits (depends on short/long side, not literal width/height)", () => {
    expect(magnifierSizeLimits({ w: 800, h: 1000 }, 1.5)).toEqual(magnifierSizeLimits({ w: 1000, h: 800 }, 1.5));
  });
});

// Addendum G (2026-08-08, §G1): minRectSource is the rect's own legibility
// floor (MIN_MAGNIFIER_RECT_SOURCE_CSS_PX = 4, vs minSource's fingertip-sized
// 20) — same clamp SHAPE as minSource (CSS-scaled, canvas-relative cap,
// absolute backstop), different CSS-px input, so this suite mirrors the
// circle's own magnifierSizeLimits tests above one-for-one rather than
// re-deriving the shape from scratch.
describe("magnifierSizeLimits: minRectSource (Addendum G §G1)", () => {
  it("scales linearly with `scale` when neither canvas cap bites", () => {
    // Same canvas as the minSource sibling test above: shortSide=4000 puts
    // both canvas caps (600, 1800) far above the CSS-scaled minimum.
    const limits = magnifierSizeLimits({ w: 5000, h: 4000 }, 2);
    expect(limits.minRectSource).toBeCloseTo(MIN_MAGNIFIER_RECT_SOURCE_CSS_PX * 2);
  });

  it("the canvas cap bites on a small canvas at a large scale, and lands on the SAME value as minSource's cap (both floors share MAGNIFIER_SOURCE_SHORT_SIDE_CAP)", () => {
    const limits = magnifierSizeLimits({ w: 100, h: 80 }, 10);
    expect(limits.minRectSource).toBeCloseTo(12); // MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide(80)
    expect(limits.minRectSource).toBeCloseTo(limits.minSource);
  });

  it("MIN_MAGNIFIER_SOURCE_RADIUS_PX is the same absolute backstop minRectSource shares with minSource", () => {
    const limits = magnifierSizeLimits({ w: 10, h: 10 }, 0.01);
    expect(limits.minRectSource).toBe(MIN_MAGNIFIER_SOURCE_RADIUS_PX);
  });

  it("non-emptiness invariant: minLens >= MIN_MAGNIFIER_ZOOM * minRectSource, across the same canvas/scale table used for minSource above", () => {
    const table: Array<{ w: number; h: number; scale: number }> = [
      { w: 1000, h: 800, scale: 1 },
      { w: 1170, h: 2532, scale: 3.55 },
      { w: 2560, h: 1440, scale: 2.13 },
      { w: 100, h: 80, scale: 10 },
      { w: 4000, h: 3000, scale: 0.1 },
    ];
    for (const { w, h, scale } of table) {
      const limits = magnifierSizeLimits({ w, h }, scale);
      expect(limits.minLens).toBeGreaterThanOrEqual(MIN_MAGNIFIER_ZOOM * limits.minRectSource);
    }
  });

  // Mirrors the circle's own degenerate-exception test: at this pathological
  // scale (< 1, unreachable in the running app per magnifierSizeLimits's own
  // doc comment), minRectSource shares minSource's absolute backstop while
  // minLens stays scale-proportional and small, so the invariant above can
  // fail here by design — not a crash, the limits stay finite and well-formed.
  it("degenerate exception (mirrors minSource's own): at scale=0.01 on a 10x10 canvas, minLens < MIN_MAGNIFIER_ZOOM * minRectSource", () => {
    const limits = magnifierSizeLimits({ w: 10, h: 10 }, 0.01);
    expect(limits.minRectSource).toBe(MIN_MAGNIFIER_SOURCE_RADIUS_PX);
    expect(limits.minLens).toBeLessThan(MIN_MAGNIFIER_ZOOM * limits.minRectSource);
    expect(limits.minLens).toBeLessThanOrEqual(limits.maxLens);
  });
});

describe("defaultSourceRadius", () => {
  // scale=1 canvases large enough that the operability floor never bites,
  // so these mirror the pre-Addendum-B expectations exactly.
  const limitsFor = (canvasSize: { w: number; h: number }) => magnifierSizeLimits(canvasSize, 1);

  it("uses the long-side term when the aspect ratio is within ~2.5:1", () => {
    // 0.06*1000=60; 0.15*800=120; min=60 (long-side term is the binding minimum);
    // limits.minSource (16) is well below 60, so the floor doesn't bite.
    const canvasSize = { w: 1000, h: 800 };
    expect(defaultSourceRadius(canvasSize, limitsFor(canvasSize))).toBeCloseTo(60);
  });

  it("uses the short-side guard for an extreme panorama beyond ~2.5:1", () => {
    // 0.06*3000=180; 0.15*400=60; min=60 (short-side term wins); floor (16) doesn't bite.
    const canvasSize = { w: 3000, h: 400 };
    expect(defaultSourceRadius(canvasSize, limitsFor(canvasSize))).toBeCloseTo(60);
  });

  it("is symmetric under swapped w/h (depends on long/short side, not literal width/height)", () => {
    const a = { w: 800, h: 1000 };
    const b = { w: 1000, h: 800 };
    expect(defaultSourceRadius(a, limitsFor(a))).toBeCloseTo(defaultSourceRadius(b, limitsFor(b)));
  });

  it("equals MAGNIFIER_SOURCE_RADIUS_FRACTION * longSide for a square canvas (long-side term always wins there)", () => {
    const canvasSize = { w: 500, h: 500 };
    expect(defaultSourceRadius(canvasSize, limitsFor(canvasSize))).toBeCloseTo(MAGNIFIER_SOURCE_RADIUS_FRACTION * 500);
  });

  it("the operability floor (limits.minSource) wins when the CSS-scaled minimum exceeds the nominal fraction — e.g. a large photo shown small on a phone", () => {
    // canvasSize {w:2000,h:1600}: 0.06*2000=120, 0.15*1600=240 -> nominal = 120.
    // At scale=10, limits.minSource = max(2, min(20*10=200, 0.15*1600=240)) = 200 > 120.
    const canvasSize = { w: 2000, h: 1600 };
    const limits = magnifierSizeLimits(canvasSize, 10);
    expect(limits.minSource).toBeCloseTo(200);
    expect(defaultSourceRadius(canvasSize, limits)).toBeCloseTo(200);
  });
});

describe("deriveLensSizeForSource", () => {
  const canvasSize = { w: 1000, h: 800 }; // longSide=1000, shortSide=800
  const limits = magnifierSizeLimits(canvasSize, 1); // minSource=20, minLens=28, maxLens=360

  it("first pass (no radius clamp): targetRadius derives zoom and radius directly", () => {
    // targetRadius = min(0.30 * 1000/2, limits.maxLens=360) = min(150, 360) = 150
    // sourceRadius = 30 -> zoom = 150/30 = 5 (within [1.2,16]) -> radius = 150,
    // which is within [limits.minLens=28, limits.maxLens=360], so no second pass.
    const result = deriveLensSizeForSource(30, "M", canvasSize, limits);
    expect(result.zoom).toBeCloseTo(5);
    expect(result.radius).toBeCloseTo(150);
  });

  it("zoom clamps to MAX_MAGNIFIER_ZOOM when the source is tiny relative to the target radius, then the resulting radius trips limits.minLens and zoom is re-derived from the re-clamped radius", () => {
    // targetRadius = 150 (as above); sourceRadius = 1 -> raw zoom = 150, clamped to MAX (16),
    // -> radius = 1*16 = 16, which is BELOW limits.minLens (28), so radius clamps up to 28
    // and zoom is re-derived once: 28/1 = 28, clamped back down to MAX_MAGNIFIER_ZOOM (16).
    const result = deriveLensSizeForSource(1, "M", canvasSize, limits);
    expect(result.radius).toBeCloseTo(limits.minLens);
    expect(result.zoom).toBeCloseTo(MAX_MAGNIFIER_ZOOM);
  });

  it("second pass: zoom floored to MIN_MAGNIFIER_ZOOM (huge source) pushes radius past limits.maxLens, which wins, and zoom is re-derived from the capped radius", () => {
    // targetRadius = 150; sourceRadius huge (500) -> raw zoom = 150/500 = 0.3, clamped up to MIN_MAGNIFIER_ZOOM (1.2)
    // -> radius = 500*1.2 = 600, which exceeds limits.maxLens (360), so radius clamps down to 360,
    // and zoom is re-derived once: 360/500 = 0.72, clamped to MIN_MAGNIFIER_ZOOM (1.2).
    const result = deriveLensSizeForSource(500, "M", canvasSize, limits);
    expect(result.radius).toBeCloseTo(limits.maxLens);
    expect(result.zoom).toBeCloseTo(MIN_MAGNIFIER_ZOOM);
  });

  it("degenerate tiny canvas: radius clamps to limits.maxLens ('hi wins'); limits.minLens can never itself exceed limits.maxLens (magnifierSizeLimits caps minLens by maxLens), so this is an ordinary ceiling hit, not an inverted lo>hi range", () => {
    const tinyCanvas = { w: 20, h: 16 };
    const tinyLimits = magnifierSizeLimits(tinyCanvas, 1); // maxLens=0.45*16=7.2; minLens=min(28,7.2)=7.2
    expect(tinyLimits.minLens).toBeCloseTo(tinyLimits.maxLens);
    const result = deriveLensSizeForSource(1, "S", tinyCanvas, tinyLimits);
    expect(result.radius).toBeCloseTo(tinyLimits.maxLens);
    expect(result.zoom).toBeCloseTo(tinyLimits.maxLens); // zoom re-derived: maxLens/sourceRadius(1) = maxLens, within [1.2,16] here
  });

  it("post-condition: radius stays within [minLens, maxLens] and radius/zoom (the derived source radius) never falls below minSource, over a table of presets/source radii/canvas sizes/scales", () => {
    // Every row's sourceRadius is >= that row's limits.minSource — the real
    // precondition every call site actually provides, since the only production
    // caller (canvas.ts's magnifierGeometry) always derives sourceRadius via
    // defaultSourceRadius(canvasSize, limits), which itself floors at
    // limits.minSource. A sourceRadius fed in below the floor is a caller bug,
    // not something this function is asked to compensate for, and IS able to
    // break this postcondition (deriveLensSizeForSource's second-pass zoom
    // re-derivation doesn't itself consult limits.minSource — see the
    // dedicated "degenerate tiny canvas" test above for that unclamped case).
    const table: Array<{ sourceRadius: number; size: "S" | "M" | "L"; canvasSize: { w: number; h: number }; scale: number }> = [
      { sourceRadius: 30, size: "M", canvasSize: { w: 1000, h: 800 }, scale: 1 },
      { sourceRadius: 20, size: "S", canvasSize: { w: 1000, h: 800 }, scale: 1 },
      { sourceRadius: 500, size: "L", canvasSize: { w: 1000, h: 800 }, scale: 1 },
      { sourceRadius: 72, size: "M", canvasSize: { w: 1170, h: 2532 }, scale: 3.55 }, // design note's iPhone sanity check (minSource = 20*3.55 = 71)
      { sourceRadius: 15, size: "S", canvasSize: { w: 100, h: 80 }, scale: 10 },
      { sourceRadius: 2000, size: "L", canvasSize: { w: 4000, h: 3000 }, scale: 0.1 },
    ];
    for (const { sourceRadius, size, canvasSize, scale } of table) {
      const lim = magnifierSizeLimits(canvasSize, scale);
      expect(sourceRadius).toBeGreaterThanOrEqual(lim.minSource); // sanity-check the precondition itself
      const result = deriveLensSizeForSource(sourceRadius, size, canvasSize, lim);
      expect(result.radius).toBeGreaterThanOrEqual(lim.minLens - 1e-9);
      expect(result.radius).toBeLessThanOrEqual(lim.maxLens + 1e-9);
      expect(result.radius / result.zoom).toBeGreaterThanOrEqual(lim.minSource - 1e-9);
    }
  });
});

describe("clampZoom", () => {
  it("clamps below MIN_MAGNIFIER_ZOOM up to the floor", () => {
    const a = magnifier({ radius: 100 });
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampZoom(0.5, a, limits)).toBeCloseTo(MIN_MAGNIFIER_ZOOM);
  });

  it("clamps above MAX_MAGNIFIER_ZOOM down to the ceiling when radius is large enough relative to limits.minSource", () => {
    const a = magnifier({ radius: 1000 }); // radius/minSource = 500, so MAX_ZOOM (16) is the binding ceiling
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampZoom(100, a, limits)).toBeCloseTo(MAX_MAGNIFIER_ZOOM);
  });

  it("limits.minSource caps zoom below MAX_MAGNIFIER_ZOOM when radius is small relative to it", () => {
    // radius = 10 -> radius / minSource (2) = 5, which is below MAX_MAGNIFIER_ZOOM (16).
    const a = magnifier({ radius: 10 });
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampZoom(100, a, limits)).toBeCloseTo(10 / MIN_MAGNIFIER_SOURCE_RADIUS_PX);
  });

  it("a larger limits.minSource (e.g. from a small on-screen display scale) lowers the reachable zoom ceiling for the same radius", () => {
    const a = magnifier({ radius: 100 });
    const limits: MagnifierSizeLimits = { minSource: 20, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampZoom(100, a, limits)).toBeCloseTo(100 / 20); // 5, well below MAX_MAGNIFIER_ZOOM
  });

  it("passes an in-range value through unchanged", () => {
    const a = magnifier({ radius: 100 });
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampZoom(4, a, limits)).toBeCloseTo(4);
  });
});

describe("clampPointToCanvas", () => {
  const canvasSize = { w: 200, h: 150 };

  it("passes a point already inside [0,W]x[0,H] through unchanged", () => {
    expect(clampPointToCanvas({ x: 100, y: 75 }, canvasSize)).toEqual({ x: 100, y: 75 });
  });

  it("clamps a negative x up to 0", () => {
    expect(clampPointToCanvas({ x: -50, y: 75 }, canvasSize)).toEqual({ x: 0, y: 75 });
  });

  it("clamps an x beyond W down to W", () => {
    expect(clampPointToCanvas({ x: 500, y: 75 }, canvasSize)).toEqual({ x: 200, y: 75 });
  });

  it("clamps both axes at once for an off-corner point", () => {
    expect(clampPointToCanvas({ x: -50, y: 500 }, canvasSize)).toEqual({ x: 0, y: 150 });
  });

  it("boundary values (exactly 0 and exactly W/H) pass through unchanged", () => {
    expect(clampPointToCanvas({ x: 0, y: 0 }, canvasSize)).toEqual({ x: 0, y: 0 });
    expect(clampPointToCanvas({ x: 200, y: 150 }, canvasSize)).toEqual({ x: 200, y: 150 });
  });
});

describe("magnifierSlideUpdate", () => {
  const canvasSize = { w: 1000, h: 800 };

  it("on-canvas slide: from equals the pointer unchanged (the clamp is a no-op); at follows at the frozen offset", () => {
    const frozen = { offset: { x: 50, y: -30 }, radius: 40, zoom: 3 };
    const result = magnifierSlideUpdate({ x: 200, y: 150 }, frozen, canvasSize);
    expect(result.from).toEqual({ x: 200, y: 150 });
    expect(result.at).toEqual({ x: 250, y: 120 });
  });

  // Review round 2 ruling: from IS clamped during a slide (clampPointToCanvas),
  // unlike a committed magnifier's source-body drag (canvas.ts's onMove, via
  // translateAnnotation(a, dx, dy, "source")), which stays unclamped — see
  // magnifierSlideUpdate's doc comment for the create-vs-edit distinction.
  // Per-axis clamping is already covered directly
  // by clampPointToCanvas's own tests above; this integration test keeps only
  // the off-corner case, which additionally pins that this wrapper applies
  // the clamp on both axes at once, not just delegates to it.
  it("off-corner slide: clamps both axes", () => {
    const frozen = { offset: { x: 0, y: 0 }, radius: 40, zoom: 3 };
    const result = magnifierSlideUpdate({ x: -500, y: -500 }, frozen, canvasSize);
    expect(result.from).toEqual({ x: 0, y: 0 });
  });

  it("at derives from the CLAMPED from, not the raw off-canvas pointer", () => {
    const frozen = { offset: { x: 50, y: 20 }, radius: 40, zoom: 3 };
    const result = magnifierSlideUpdate({ x: 1500, y: 150 }, frozen, canvasSize);
    // from clamps to (1000, 150); raw at = (1000+50, 150+20) = (1050, 170),
    // which clampLensCenter then clamps x to W - R = 960.
    expect(result.from).toEqual({ x: 1000, y: 150 });
    expect(result.at.x).toBeCloseTo(canvasSize.w - frozen.radius);
    expect(result.at.y).toBeCloseTo(170);
  });

  it("clamps `at` back on-canvas when the frozen offset alone pushes it off the edge, even with an on-canvas pointer (from stays unclamped here)", () => {
    const frozen = { offset: { x: 900, y: 0 }, radius: 40, zoom: 3 };
    const result = magnifierSlideUpdate({ x: 200, y: 150 }, frozen, canvasSize);
    expect(result.from).toEqual({ x: 200, y: 150 });
    expect(result.at.x).toBeCloseTo(canvasSize.w - frozen.radius); // clamped to W - R = 960
    expect(result.at.y).toBeCloseTo(150);
  });

  it("radius/zoom are not part of the return value — they cannot change mid-slide by construction", () => {
    const frozen = { offset: { x: 0, y: 0 }, radius: 40, zoom: 3 };
    const result = magnifierSlideUpdate({ x: 10, y: 10 }, frozen, canvasSize);
    expect(result).not.toHaveProperty("radius");
    expect(result).not.toHaveProperty("zoom");
  });
});

// ---- Rect ("cube mode") twins, D1-D5 -----------------------------------

function rectCornersOf(r: { x: number; y: number; w: number; h: number }): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x, y: r.y + r.h },
    { x: r.x + r.w, y: r.y + r.h },
  ];
}

function normalize(v: Point): Point {
  const d = Math.hypot(v.x, v.y);
  return { x: v.x / d, y: v.y / d };
}

/** True iff segments p1-p2 and p3-p4 properly intersect (cross at an interior point of both — shared-endpoint "touching" is not a crossing). Standard orientation-sign test. */
function segmentsProperlyIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const orient = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Liang-Barsky parametric clip of segment `p1 -> p2` (`t in [0,1]`) against
 * the CLOSED axis-aligned rect `rect`. Returns the clipped parameter range
 * `[t0, t1]` (both in `[0,1]`) if the segment meets the rect at all, or
 * `null` if it never does. Standard algorithm — four half-plane clips (one
 * per rect edge, extended to an infinite line), each narrowing `[t0, t1]`
 * or rejecting outright for a segment parallel to and outside that edge.
 *
 * Used by `assertConnectorSane`'s T1' (Addendum H, 2026-08-08) to state "this
 * segment meets that rect only at a single endpoint point" directly, in
 * terms independent of how the production code (`magnifierRectConnectorLines`)
 * constructs its answer — unlike the deleted `convexHull`/`liesOnHullEdge`
 * pair this replaces, which mirrored the production code's own "supporting
 * line" reasoning closely enough that a shared bug could have slipped past
 * both (and, after Addendum H, would have been flatly WRONG regardless: a
 * facing-edge segment is deliberately not a supporting line or hull edge of
 * either rect, so a hull-edge check now fails on every correct result).
 */
function liangBarskyClip(p1: Point, p2: Point, rect: { x: number; y: number; w: number; h: number }): [number, number] | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [p1.x - rect.x, rect.x + rect.w - p1.x, p1.y - rect.y, rect.y + rect.h - p1.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null; // parallel to this edge and entirely outside it
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * B1-regression assertion, rewritten for the facing-edge model (Addendum H,
 * 2026-08-08 — replaces Addendum G's hull-bridge contract, specifically T1
 * and the reviewer's T1b, wholesale: a facing-edge segment is deliberately
 * NOT a supporting line of both rects and NOT a joint-convex-hull edge, so
 * both of those checks would now fail on every correct result rather than
 * merely being redundant).
 *
 * For a non-null `magnifierRectConnectorLines` result, asserts, per segment:
 *
 * - **T1' (replaces T1/T1b — the B1 regression contract, exact and
 *   algorithm-independent).** For each segment x each of the two rects:
 *   `liangBarskyClip` the segment against the CLOSED rect. The clip must be
 *   `null` (the segment never touches that rect at all) OR degenerate at an
 *   endpoint (`t1 - t0 <= 1e-12` and `t0` within `1e-12` of `0` or of `1`) —
 *   i.e. the segment meets that rect, if at all, only at a single point
 *   coinciding with one of the segment's own endpoints. This states "meets
 *   the rect only at an endpoint" directly, in terms independent of how the
 *   production code builds its answer (Addendum G's T1 mirrored the
 *   production code's own "supporting line" reasoning closely enough that a
 *   shared bug could slip past both; this doesn't).
 * - **T2 (unchanged).** The segment's first point is exactly a member of
 *   `rectCornersOf(sourceRect)` and its second exactly a member of
 *   `rectCornersOf(lensRect)` (strict equality — always a real corner, never
 *   an interpolated point).
 *
 * Across the two segments together:
 *
 * - **T3 (unchanged).** The two segments do not properly intersect
 *   (`segmentsProperlyIntersect`).
 * - **T4 (unchanged).** The two segments are distinct pairs.
 * - **T8 (new, Addendum H §H5 — replaces T1b's role as the independent
 *   structural check, expressing the user's own request directly).** The
 *   two SOURCE endpoints share one coordinate (they are the two ends of a
 *   single source edge) and the two LENS endpoints share one coordinate
 *   (likewise, a single lens edge); and those two edges FACE each other:
 *   the source's shared coordinate sits on the lens's side of the source's
 *   own centre, and the lens's shared coordinate sits on the source's side
 *   of the lens's own centre.
 *
 * **F5(b) (Addendum F, carried through Addendum G and Addendum H
 * unchanged): a `null` input PASSES VACUOUSLY** — a suppressed
 * configuration is legitimate, so this function makes no assertion at all
 * in that case; callers that need to confirm non-null do so themselves.
 * This is exactly why a bulk sweep built on this helper (e.g. the dense
 * angular sweep below, E5.4) additionally needs its OWN floor on how many
 * of its cases actually drew something — otherwise a future guard
 * regression that suppresses every single configuration would make the
 * sweep pass trivially (green, but testing nothing).
 *
 * Returns the lines (or `null`) so callers can layer further assertions
 * (an explicit expected corner pair, e.g.) on the same result without
 * recomputing it.
 */
function assertConnectorSane(
  sourceRect: { x: number; y: number; w: number; h: number },
  lensRect: { x: number; y: number; w: number; h: number },
  w1: number,
): [MagnifierConnectorLine, MagnifierConnectorLine] | null {
  const lines = magnifierRectConnectorLines(sourceRect, lensRect, w1);
  if (lines === null) return null;
  const sourceCorners = rectCornersOf(sourceRect);
  const lensCorners = rectCornersOf(lensRect);

  for (const [a, b] of lines) {
    for (const rect of [sourceRect, lensRect]) {
      const clip = liangBarskyClip(a, b, rect);
      if (clip !== null) {
        const [t0, t1] = clip;
        const degenerateAtEndpoint = t1 - t0 <= 1e-12 && (t0 <= 1e-12 || t0 >= 1 - 1e-12);
        expect(degenerateAtEndpoint).toBe(true); // T1'
      }
    }
    expect(sourceCorners.some((c) => c.x === a.x && c.y === a.y)).toBe(true); // T2 (source end)
    expect(lensCorners.some((c) => c.x === b.x && c.y === b.y)).toBe(true); // T2 (lens end)
  }

  const [line1, line2] = lines;
  expect(segmentsProperlyIntersect(line1[0], line1[1], line2[0], line2[1])).toBe(false); // T3
  expect(line1).not.toEqual(line2); // T4

  // T8: the two source endpoints and the two lens endpoints each form a
  // single edge, and those two edges face each other.
  const [sA, lA] = line1;
  const [sB, lB] = line2;
  const sourceShareX = sA.x === sB.x;
  const sourceShareY = sA.y === sB.y;
  const lensShareX = lA.x === lB.x;
  const lensShareY = lA.y === lB.y;
  expect(sourceShareX || sourceShareY).toBe(true); // T8 (source edge)
  expect(lensShareX || lensShareY).toBe(true); // T8 (lens edge)
  const sourceCenter = { x: sourceRect.x + sourceRect.w / 2, y: sourceRect.y + sourceRect.h / 2 };
  const lensCenter = { x: lensRect.x + lensRect.w / 2, y: lensRect.y + lensRect.h / 2 };
  if (sourceShareX) {
    const facing = lensCenter.x > sourceCenter.x ? sA.x > sourceCenter.x : sA.x < sourceCenter.x;
    expect(facing).toBe(true); // T8 (source edge faces the lens)
  } else {
    const facing = lensCenter.y > sourceCenter.y ? sA.y > sourceCenter.y : sA.y < sourceCenter.y;
    expect(facing).toBe(true); // T8 (source edge faces the lens)
  }
  if (lensShareX) {
    const facing = sourceCenter.x > lensCenter.x ? lA.x > lensCenter.x : lA.x < lensCenter.x;
    expect(facing).toBe(true); // T8 (lens edge faces the source)
  } else {
    const facing = sourceCenter.y > lensCenter.y ? lA.y > lensCenter.y : lA.y < lensCenter.y;
    expect(facing).toBe(true); // T8 (lens edge faces the source)
  }

  return lines;
}

// Addendum E (2026-08-08, reviewer bug B1, round 2): the D8 corner-selection
// rule (`cross(u, corner - from)`, an extreme PERPENDICULAR OFFSET FROM THE
// AXIS LINE) is not the same thing as a tangent corner (an ANGULAR EXTREME
// about a VIEWPOINT) — the two coincide only in the far field, so D8's own
// far-field-only test suite passed while near-field and off-cardinal
// placements could pick a FAR lens corner, drawing a chord straight across
// the lens interior.
//
// Addendum G (2026-08-08, user requests (2)/(3), live iPhone testing): the
// wedge/pentagon `magnifierRectConnectorShape` this became (Addendum E
// §E1/§E2/§E3) is REPLACED WHOLESALE by `magnifierRectConnectorLines` — two
// independent corner-to-corner LINES (no fill, no shared apex), each a
// supporting line of both rects, found by a brute-force 4x4 tangent-pair
// scan (`connectorBridge`) with a shortest-pair tie-break. The suppression
// guard (Addendum E §E4, `w1/2`-inflated source half-extents) is KEPT AS-IS
// and RE-JUSTIFIED under the new geometry (magnifier.ts's own doc comment)
// — it was never about the polygon shape, only about the rim-to-rim gap
// being large enough for a connector to mean anything. Every test below
// that encoded the old shape (length, interior-grid, polygon-simplicity) is
// replaced by `assertConnectorSane`'s T1-T4 above; fixture SETS (which
// source/lens/direction/distance combinations get exercised) are kept
// unchanged from Addendum E/F wherever the underlying scenario still makes
// sense, since the near-field/off-cardinal placements that caught B1 remain
// exactly as relevant to the new construction.
//
// Addendum H (2026-08-08, live iPhone feedback on Addendum G's own result):
// the hull-bridge SELECTION above (`connectorBridge`, its 4x4 scan and
// shortest-pair tie-break) is REPLACED WHOLESALE — it connects the pair's
// SILHOUETTE, not the FACING edges a zoom callout is expected to bridge
// (both segments could run top-corner-to-top-corner for a wide lens sitting
// below a narrow source). `magnifierRectConnectorLines` now picks the
// dominant separation axis from the guard's own per-axis gaps and connects
// the two rects' FACING edges on that axis, same-side (top-top/bottom-
// bottom or left-left/right-right) — see that function's own doc comment
// (magnifier.ts) for the full rule and proofs. The suppression guard ITSELF
// is untouched (byte-identical) by this addendum — every test in THIS
// describe block stays valid unchanged, mechanically unaffected. Only
// `assertConnectorSane`'s contract changed (T1/T1b -> T1'/T8, above); the
// fixture sets below are kept from Addendum G/E/F wherever still relevant.

describe("magnifierRectConnectorLines: suppression guard, w1-inflated (Addendum E §E4, kept unchanged into Addendum G and Addendum H)", () => {
  const sourceRect = { x: -10, y: -10, w: 20, h: 20 }; // center (0,0), half-extents 10x10
  const lensHalf = { x: 15, y: 8 };
  const w1 = 4;
  // New threshold on the x-axis: sourceHalfW(10) + w1/2(2) + lensHalfW(15) = 27
  // (was 25 pre-Addendum-E, before the w1/2 inflation).
  function lensRectAt(cx: number, cy: number) {
    return { x: cx - lensHalf.x, y: cy - lensHalf.y, w: 2 * lensHalf.x, h: 2 * lensHalf.y };
  }

  it("null when the rects overlap", () => {
    expect(magnifierRectConnectorLines(sourceRect, lensRectAt(15, 0), w1)).toBeNull();
  });

  it("null when the (w1-inflated) rim gap is exactly 0 (touching)", () => {
    expect(magnifierRectConnectorLines(sourceRect, lensRectAt(27, 0), w1)).toBeNull();
  });

  it("null when the (w1-inflated) rim gap is smaller than MAGNIFIER_CONNECTOR_MIN_GAP_PX (2)", () => {
    // center distance 28 -> gx = 28 - 27 = 1 < 2.
    expect(magnifierRectConnectorLines(sourceRect, lensRectAt(28, 0), w1)).toBeNull();
  });

  it("non-null once the (w1-inflated) rim gap clears MAGNIFIER_CONNECTOR_MIN_GAP_PX", () => {
    // center distance 30 -> gx = 30 - 27 = 3 >= 2.
    expect(magnifierRectConnectorLines(sourceRect, lensRectAt(30, 0), w1)).not.toBeNull();
  });

  it("null when centers coincide (from === at) — the documented invariant that gx/gy are both driven to 0", () => {
    expect(magnifierRectConnectorLines(sourceRect, lensRectAt(0, 0), w1)).toBeNull();
  });

  it("the worked degenerate fixture from the design note (a tall lens dragged alongside a wide source): suppressed, though the pre-w1-inflation guard alone would have passed it", () => {
    const sourceRect2 = { x: -50, y: -20, w: 100, h: 40 };
    const lensRect2 = { x: 55, y: -170, w: 40, h: 400 };
    expect(magnifierRectConnectorLines(sourceRect2, lensRect2, 30)).toBeNull();
  });

  it("control: the same degenerate fixture moved 20px further apart is NOT suppressed — inflation doesn't over-suppress ordinary configurations", () => {
    const sourceRect2 = { x: -50, y: -20, w: 100, h: 40 };
    const lensRect2 = { x: 75, y: -170, w: 40, h: 400 }; // +20px on x
    expect(magnifierRectConnectorLines(sourceRect2, lensRect2, 30)).not.toBeNull();
  });
});

// Addendum F (2026-08-08): Addendum E §E4's guard correctly inflates the
// SOURCE half-extents by markerStroke/2 when deciding whether a connector
// should draw at all — but that means the CREATION-TIME placement gap
// (`MAGNIFIER_GAP_PX`, bare, rect-to-rect) can land a freshly created rect
// magnifier's connector inside the now-wider suppression band whenever
// `markerStroke/2` exceeds `MAGNIFIER_GAP_PX - MAGNIFIER_CONNECTOR_MIN_GAP_PX`
// — reachable on the web target's large `docScale` (round-3 review finding).
// Fix (`canvas.ts`'s `magnifierRectGeometry`, §F1): the gap PASSED TO
// `placeRectLens` is inflated by the same `markerStroke/2` term the guard
// itself subtracts, restoring "a freshly created rect magnifier always
// clears its own guard by the full MAGNIFIER_GAP_PX". Addendum G does not
// touch this fix or its fixtures (§G4.1: "F4's three tests, including the
// negative control, stay valid and unchanged") — only the function name
// changes, mechanically, to the new `magnifierRectConnectorLines`.
describe("magnifierRectConnectorLines: creation gap must clear the guard (Addendum F §F4)", () => {
  // Build the annotation-shaped geometry a real slide-to-aim creation would
  // produce for `size` on `canvasSize`, at effective creation `strokeWidth`,
  // with `from` at the canvas center — mirrors canvas.ts's
  // `magnifierRectGeometry` composition exactly (deriveRectLensSize +
  // placeRectLens(gap) + magnifierSourceRect/magnifierLensRect).
  function buildRectGeometry(canvasSize: { w: number; h: number }, size: "S" | "M" | "L", strokeWidth: number, gap: number) {
    const limits = magnifierSizeLimits(canvasSize, 1);
    const { sourceHalfW, sourceHalfH, width, height, zoom } = deriveRectLensSize(size, canvasSize, limits);
    const from = { x: canvasSize.w / 2, y: canvasSize.h / 2 };
    const at = placeRectLens(from, sourceHalfW, sourceHalfH, width / 2, height / 2, canvasSize, gap);
    const a = rectMagnifier({ at, from, width, height, zoom, strokeWidth });
    return { sourceRect: magnifierSourceRect(a), lensRect: magnifierLensRect(a) };
  }

  it("reviewer's repro, pinned: a 2532x1170 photo at the L preset (strokeWidth ~= 33.8, the web docScale case) clears the guard with the inflated gap", () => {
    const canvasSize = { w: 2532, h: 1170 };
    // Mirrors canvas.ts's real base.strokeWidth = this.strokeWidth *
    // this.docScale composition: STROKE_PRESETS.L is the L-preset picker
    // value, computeAnnotationScale(2532, ANNOTATION_SCALE_BASELINE) is the
    // web-only adaptive docScale for this photo's long side.
    const strokeWidth = STROKE_PRESETS.L * computeAnnotationScale(2532, ANNOTATION_SCALE_BASELINE);
    expect(strokeWidth).toBeCloseTo(33.76, 1); // sanity-check the fixture itself
    const gap = MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth) / 2;
    const { sourceRect, lensRect } = buildRectGeometry(canvasSize, "L", strokeWidth, gap);
    const lines = magnifierRectConnectorLines(sourceRect, lensRect, magnifierMarkerStroke(strokeWidth));
    expect(lines).not.toBeNull();
  });

  it("negative control (pins the bug): the SAME fixture with the bare (pre-Addendum-F) MAGNIFIER_GAP_PX is suppressed", () => {
    // This is the pre-Addendum-F behaviour; if this stops being null, the
    // guard (Addendum E §E4) or the marker ratio (MAGNIFIER_MARKER_STROKE_RATIO)
    // moved and F1's arithmetic needs re-checking.
    const canvasSize = { w: 2532, h: 1170 };
    const strokeWidth = STROKE_PRESETS.L * computeAnnotationScale(2532, ANNOTATION_SCALE_BASELINE);
    const { sourceRect, lensRect } = buildRectGeometry(canvasSize, "L", strokeWidth, MAGNIFIER_GAP_PX);
    const lines = magnifierRectConnectorLines(sourceRect, lensRect, magnifierMarkerStroke(strokeWidth));
    expect(lines).toBeNull();
  });

  it("parametric invariant: a freshly created rect magnifier (from at the canvas centre) always clears its own guard, across every S/M/L x docScale x canvas-size combination", () => {
    const canvasSizes = [
      { w: 2532, h: 1170 },
      { w: 1920, h: 1080 },
      { w: 4000, h: 3000 },
    ];
    // 1 = desktop (docScale always 1); 2.81 = this suite's own reviewer-repro
    // docScale (2532/900); 6 = ANNOTATION_SCALE_MAX, the adaptive-sizing cap.
    const docScales = [1, 2.81, 6];
    const sizes: Array<"S" | "M" | "L"> = ["S", "M", "L"];

    for (const canvasSize of canvasSizes) {
      for (const docScale of docScales) {
        for (const size of sizes) {
          const strokeWidth = STROKE_PRESETS[size] * docScale;
          const gap = MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth) / 2;
          const { sourceRect, lensRect } = buildRectGeometry(canvasSize, size, strokeWidth, gap);
          const lines = magnifierRectConnectorLines(sourceRect, lensRect, magnifierMarkerStroke(strokeWidth));
          expect(lines).not.toBeNull();
        }
      }
    }
  });
});

describe("magnifierRectConnectorLines: markerStroke never exceeds the lens border's own stroke (Addendum G §G7 T5)", () => {
  // The connector's ink-containment argument (assertConnectorSane's T1 doc
  // comment, and magnifierRectConnectorLines's own) depends on the painted
  // connector band never reaching past the lens border's own join band —
  // which in turn depends on magnifierMarkerStroke(sw) <= the lens stroke
  // (Math.max(1, sw * MAGNIFIER_LENS_STROKE_RATIO)) for every strokeWidth.
  // This is a standalone algebraic fact about the two ratio constants
  // (render.ts), not something a specific connector fixture can exercise —
  // pin it directly across a representative strokeWidth range, including
  // the web docScale extreme from the F4 suite above.
  it.each([0.25, 0.5, 1, 3, 6, 12, 33.76, 54.6])("holds at strokeWidth=%s", (sw) => {
    expect(magnifierMarkerStroke(sw)).toBeLessThanOrEqual(Math.max(1, sw * MAGNIFIER_LENS_STROKE_RATIO));
  });
});

describe("magnifierRectConnectorLines: parameterized regression sweep (Addendum E §E5.1) — this alone would have caught B1 round 2", () => {
  const sourceRect = { x: -30, y: -15, w: 60, h: 30 };
  const w1 = 6;
  const LENS_SIZES: Array<{ name: string; half: Point }> = [
    { name: "120x80", half: { x: 60, y: 40 } },
    { name: "576x216", half: { x: 288, y: 108 } },
  ];
  const UNIT_DIRS: Array<{ name: string; dir: Point }> = [
    { name: "E", dir: { x: 1, y: 0 } },
    { name: "W", dir: { x: -1, y: 0 } },
    { name: "S", dir: { x: 0, y: 1 } },
    { name: "N", dir: { x: 0, y: -1 } },
    { name: "SE", dir: { x: Math.SQRT1_2, y: Math.SQRT1_2 } },
    { name: "SW", dir: { x: -Math.SQRT1_2, y: Math.SQRT1_2 } },
    { name: "NE", dir: { x: Math.SQRT1_2, y: -Math.SQRT1_2 } },
    { name: "NW", dir: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 } },
    { name: "oblique A (~15deg)", dir: normalize({ x: 2.6, y: 0.7 }) },
    { name: "oblique B (~113deg)", dir: normalize({ x: -1, y: 2.4 }) },
  ];

  for (const dist of [300, 450]) {
    for (const { name: lensName, half } of LENS_SIZES) {
      for (const { name: dirName, dir } of UNIT_DIRS) {
        it(`dist=${dist} lens=${lensName} dir=${dirName}: connector is sane (or legitimately suppressed)`, () => {
          const center = { x: dir.x * dist, y: dir.y * dist };
          const lensRect = { x: center.x - half.x, y: center.y - half.y, w: 2 * half.x, h: 2 * half.y };
          assertConnectorSane(sourceRect, lensRect, w1);
        });
      }
    }
  }
});

describe("magnifierRectConnectorLines: near-field repro, the reviewer's own round-2 cases (Addendum E §E5.2), corner pairs updated for the facing-edge model (Addendum H §H5 T7)", () => {
  // 1920x1080-scale M preset: source 230.4x86.4 (half 115.2x43.2), lens
  // 576x216 (half 288x108), centered at the origin.
  const sourceRect = { x: -115.2, y: -43.2, w: 230.4, h: 86.4 };
  const lensHalf = { x: 288, y: 108 };
  const w1 = 5.4;

  it("lens near-north of the source (center (60,-420)): sane, gx=0 so y dominates, and the two segments join the source's NORTH corners to the lens's SOUTH corners — the facing edges", () => {
    const center = { x: 60, y: -420 };
    const lensRect = { x: center.x - lensHalf.x, y: center.y - lensHalf.y, w: 2 * lensHalf.x, h: 2 * lensHalf.y };
    const lines = assertConnectorSane(sourceRect, lensRect, w1)!;
    expect(lines).not.toBeNull();
    // Exact expected pair (Addendum H §H5's own worked example), verified
    // against the real implementation.
    expect(lines).toEqual([
      [
        { x: -115.2, y: -43.2 },
        { x: -228, y: -312 },
      ],
      [
        { x: 115.2, y: -43.2 },
        { x: 348, y: -312 },
      ],
    ]);
  });

  it("lens near-south of the source (center (-40,400)): sane, gx=0 so y dominates, and the two segments join the source's SOUTH corners to the lens's NORTH corners — the facing edges", () => {
    const center = { x: -40, y: 400 };
    const lensRect = { x: center.x - lensHalf.x, y: center.y - lensHalf.y, w: 2 * lensHalf.x, h: 2 * lensHalf.y };
    const lines = assertConnectorSane(sourceRect, lensRect, w1)!;
    expect(lines).not.toBeNull();
    expect(lines).toEqual([
      [
        { x: -115.2, y: 43.2 },
        { x: -328, y: 292 },
      ],
      [
        { x: 115.2, y: 43.2 },
        { x: 248, y: 292 },
      ],
    ]);
  });
});

describe("magnifierRectConnectorLines: off-cardinal band, the reviewer's failing bands (Addendum E §E5.3)", () => {
  const sourceRect = { x: -30, y: -15, w: 60, h: 30 };
  const lensHalf = { x: 60, y: 40 };
  const w1 = 6;
  const dist = 400;

  function rotate(v: Point, deg: number): Point {
    const r = (deg * Math.PI) / 180;
    return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
  }

  const CARDINALS: Array<{ name: string; dir: Point }> = [
    { name: "E", dir: { x: 1, y: 0 } },
    { name: "W", dir: { x: -1, y: 0 } },
    { name: "S", dir: { x: 0, y: 1 } },
    { name: "N", dir: { x: 0, y: -1 } },
  ];
  const ANGLES = [-14, -8, -2, 2, 8, 14];

  // Addendum G note: the old "resolves to the near-edge quad (length 4)"
  // near-cardinal assertion no longer applies — every non-null result is
  // now exactly two lines regardless of angle (there is no more quad-vs-
  // pentagon distinction, per §G4/§G6). The fixture set (this is the band
  // that caught the reviewer's B1 round-2 report) is kept unchanged; only
  // assertConnectorSane's T1-T4 stand in for the old length/interior checks.
  for (const { name, dir } of CARDINALS) {
    for (const angle of ANGLES) {
      it(`${name} ${angle > 0 ? "+" : ""}${angle}deg: connector is sane`, () => {
        const rdir = rotate(dir, angle);
        const center = { x: rdir.x * dist, y: rdir.y * dist };
        const lensRect = { x: center.x - lensHalf.x, y: center.y - lensHalf.y, w: 2 * lensHalf.x, h: 2 * lensHalf.y };
        const lines = assertConnectorSane(sourceRect, lensRect, w1);
        expect(lines).not.toBeNull();
      });
    }
  }
});

it("magnifierRectConnectorLines: dense angular sweep over real creation presets (Addendum E §E5.4) — 120 angles x 3 distance multipliers x 2 presets, connector stays sane wherever it isn't suppressed", () => {
  const presets: Array<{ name: string; canvasSize: { w: number; h: number }; size: "S" | "M" | "L" }> = [
    { name: "1000x800 M", canvasSize: { w: 1000, h: 800 }, size: "M" },
    { name: "2560x1440 L", canvasSize: { w: 2560, h: 1440 }, size: "L" },
  ];
  const w1 = 6;

  // F5(b) (Addendum F, 2026-08-08, carried into Addendum G unchanged):
  // assertConnectorSane passes vacuously on a null (suppressed) result, so
  // this sweep additionally counts how many cases actually produced lines
  // and floors it well above zero — otherwise a future guard regression
  // that suppresses EVERY case in the sweep would make this test pass green
  // while asserting nothing.
  let sweepLength = 0;
  let drawnCount = 0;

  for (const { canvasSize, size } of presets) {
    const limits = magnifierSizeLimits(canvasSize, 1);
    const { sourceHalfW, sourceHalfH, width, height } = deriveRectLensSize(size, canvasSize, limits);
    const sourceRect = { x: -sourceHalfW, y: -sourceHalfH, w: 2 * sourceHalfW, h: 2 * sourceHalfH };
    const lensHalfW = width / 2;
    const lensHalfH = height / 2;
    // "Just touching" reference distance (corner-to-corner, a conservative
    // over-estimate): sum of the two rects' own half-diagonals.
    const charDist = Math.hypot(sourceHalfW, sourceHalfH) + Math.hypot(lensHalfW, lensHalfH);

    for (const m of [1.2, 1.5, 2.5]) {
      for (let deg = 0; deg < 360; deg += 3) {
        sweepLength++;
        const rad = (deg * Math.PI) / 180;
        const dist = m * charDist;
        const center = { x: Math.cos(rad) * dist, y: Math.sin(rad) * dist };
        const lensRect = { x: center.x - lensHalfW, y: center.y - lensHalfH, w: 2 * lensHalfW, h: 2 * lensHalfH };
        const lines = assertConnectorSane(sourceRect, lensRect, w1); // suppressed (null) configs are legitimate, skipped
        if (lines !== null) drawnCount++;
      }
    }
  }

  expect(drawnCount).toBeGreaterThan(sweepLength / 2);
});

describe("magnifierRectConnectorLines: dominant-axis tie-break (Addendum H §H5 T6a)", () => {
  // A fixture with gx === gy EXACTLY (verified below) — pins the tie-break
  // ("larger gap wins, ties to x") deterministically. Source half-extents
  // 30x15, lens half-extents 60x40, w1=6, lens centred at (103, 68):
  // gx = |103| - (30+3+60) = 10; gy = |68| - (15+3+40) = 10.
  it("resolves to the x-dominant (vertical facing edges) answer on an exact gx === gy tie", () => {
    const sourceRect = { x: -30, y: -15, w: 60, h: 30 };
    const lensRect = { x: 103 - 60, y: 68 - 40, w: 120, h: 80 };
    // Sanity-check the fixture's own premise before trusting the pinned
    // result below — see this test's comment for the arithmetic.
    const gx = Math.abs(103) - (30 + 3 + 60);
    const gy = Math.abs(68) - (15 + 3 + 40);
    expect(gx).toBe(10);
    expect(gy).toBe(gx);
    const lines = assertConnectorSane(sourceRect, lensRect, 6)!;
    expect(lines).not.toBeNull();
    expect(lines).toEqual([
      [
        { x: 30, y: -15 },
        { x: 43, y: 28 },
      ],
      [
        { x: 30, y: 15 },
        { x: 43, y: 108 },
      ],
    ]);
  });
});

describe("magnifierRectConnectorLines: cardinal continuity, no snap near due-south (Addendum H §H5 T6b)", () => {
  // Due-south fixture plus the same rotated +/-2deg and +/-8deg: all five
  // must resolve to the SAME y-dominant facing-edge answer (source's own
  // BOTTOM corners are always the source-side endpoints) — no discontinuity
  // near a cardinal, only at the exact diagonal locus gx === gy (T6a).
  const sourceRect = { x: -30, y: -15, w: 60, h: 30 };
  const lensHalf = { x: 60, y: 40 };
  const w1 = 6;
  const dist = 400;

  function rotate(v: Point, deg: number): Point {
    const r = (deg * Math.PI) / 180;
    return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
  }

  it("due south (0deg): sane, source BL -> lens TL and source BR -> lens TR (exact pin)", () => {
    const center = { x: 0, y: dist };
    const lensRect = { x: center.x - lensHalf.x, y: center.y - lensHalf.y, w: 2 * lensHalf.x, h: 2 * lensHalf.y };
    const lines = assertConnectorSane(sourceRect, lensRect, w1)!;
    expect(lines).not.toBeNull();
    expect(lines).toEqual([
      [
        { x: -30, y: 15 },
        { x: -60, y: 360 },
      ],
      [
        { x: 30, y: 15 },
        { x: 60, y: 360 },
      ],
    ]);
  });

  for (const angle of [-8, -2, 2, 8]) {
    it(`${angle > 0 ? "+" : ""}${angle}deg off due-south: same source-side answer as due-south (source BL/BR), no snap`, () => {
      const rdir = rotate({ x: 0, y: 1 }, angle);
      const center = { x: rdir.x * dist, y: rdir.y * dist };
      const lensRect = { x: center.x - lensHalf.x, y: center.y - lensHalf.y, w: 2 * lensHalf.x, h: 2 * lensHalf.y };
      const lines = assertConnectorSane(sourceRect, lensRect, w1)!;
      expect(lines).not.toBeNull();
      // Pin the SOURCE-side endpoints only (the lens-side endpoints move
      // continuously with the lens's own position, which differs per
      // angle) — this is exactly "the same y-dominant facing-edge answer":
      // both segments still start at the source's bottom-left/bottom-right
      // corners, at every one of these angles.
      expect(lines[0][0]).toEqual({ x: -30, y: 15 }); // source BL
      expect(lines[1][0]).toEqual({ x: 30, y: 15 }); // source BR
    });
  }
});

describe("placeRectLens", () => {
  const canvasSize = { w: 1000, h: 800 };

  it("picks E (first candidate) when it fits fully on-canvas", () => {
    const from = { x: 500, y: 400 };
    const result = placeRectLens(from, 20, 10, 50, 30, canvasSize, 10);
    // E candidate: from + (sourceHalfW+gap+lensHalfW, 0) = from + (80, 0)
    expect(result).toEqual({ x: 580, y: 400 });
  });

  it("falls back to W when E would fall off the canvas", () => {
    const from = { x: 970, y: 400 }; // near the right edge
    const result = placeRectLens(from, 20, 10, 50, 30, canvasSize, 10);
    expect(result).toEqual({ x: 890, y: 400 });
  });

  it("falls back to S when both E and W are blocked", () => {
    // Canvas width exactly 2*lensHalfW: from sits dead-center on x, so E/W
    // both overflow, but S (which only shifts y) fits exactly.
    const from = { x: 50, y: 400 };
    const narrowCanvas = { w: 100, h: 800 };
    const result = placeRectLens(from, 20, 10, 50, 30, narrowCanvas, 10);
    expect(result).toEqual({ x: 50, y: 450 });
  });

  it("clamp fallback: returns the farthest-from-`from` candidate after clamping, ties broken toward the earlier candidate", () => {
    // Height (60) is too narrow for the lens (lensHalfH=30) on any
    // candidate, so every candidate's y collapses to 30. Width (300) lets x
    // vary; E/W (dist 80) tie for farthest, E is checked first and wins.
    const from = { x: 150, y: 30 };
    const wideShortCanvas = { w: 300, h: 60 };
    const result = placeRectLens(from, 20, 10, 50, 30, wideShortCanvas, 10);
    expect(result).toEqual({ x: 230, y: 30 });
  });

  it("clamp fallback degenerate case: both axes too narrow, every candidate collapses to the canvas center", () => {
    const tinyCanvas = { w: 60, h: 60 };
    const from = { x: 30, y: 30 };
    const result = placeRectLens(from, 5, 5, 50, 50, tinyCanvas, 5);
    expect(result).toEqual({ x: 30, y: 30 });
  });
});

describe("clampRectLensCenter", () => {
  const canvasSize = { w: 200, h: 150 };

  it("passes a center that's already fully on-canvas through unchanged", () => {
    expect(clampRectLensCenter({ x: 100, y: 75 }, 30, 20, canvasSize)).toEqual({ x: 100, y: 75 });
  });

  it("clamps an out-of-range x down to W - halfW", () => {
    expect(clampRectLensCenter({ x: 500, y: 75 }, 30, 20, canvasSize)).toEqual({ x: 170, y: 75 });
  });

  it("clamps an out-of-range x up to halfW", () => {
    expect(clampRectLensCenter({ x: -500, y: 75 }, 30, 20, canvasSize)).toEqual({ x: 30, y: 75 });
  });

  it("clamps each axis independently", () => {
    expect(clampRectLensCenter({ x: -500, y: 500 }, 30, 20, canvasSize)).toEqual({ x: 30, y: 130 }); // y: H-halfH = 150-20
  });

  it("falls back to the canvas-center coordinate on an axis too narrow to hold the lens (size - half < half)", () => {
    const narrow = { w: 40, h: 150 }; // halfW=30: hi = 40-30 = 10 < 30
    expect(clampRectLensCenter({ x: 500, y: 75 }, 30, 20, narrow)).toEqual({ x: 20, y: 75 }); // x -> w/2 = 20
  });
});

describe("clampRectZoom", () => {
  // clampRectZoom reads limits.minRectSource (Addendum G, 2026-08-08 — was
  // limits.minSource pre-Addendum-G); minSource itself is irrelevant here
  // (circle-only from Addendum G onward) but still required by the type, so
  // each fixture below sets it to an arbitrary value clampRectZoom never reads.
  it("clamps below MIN_MAGNIFIER_ZOOM up to the floor", () => {
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    expect(clampRectZoom(0.5, 200, 200, limits)).toBeCloseTo(MIN_MAGNIFIER_ZOOM);
  });

  it("clamps above MAX_MAGNIFIER_ZOOM down to the ceiling when both dims are large enough relative to limits.minRectSource", () => {
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    // min(2000,3000)/(2*2) = 500, far above MAX_MAGNIFIER_ZOOM (16).
    expect(clampRectZoom(100, 2000, 3000, limits)).toBeCloseTo(MAX_MAGNIFIER_ZOOM);
  });

  it("the SMALLER of width/height is the binding axis, order-independent", () => {
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    // min(10,1000)/(2*2) = 2.5, below MAX_MAGNIFIER_ZOOM (16), so this is the binding ceiling.
    expect(clampRectZoom(100, 10, 1000, limits)).toBeCloseTo(2.5);
    expect(clampRectZoom(100, 1000, 10, limits)).toBeCloseTo(2.5);
  });

  it("a larger limits.minRectSource lowers the reachable zoom ceiling for the same width/height", () => {
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 20, minLens: 0, maxLens: Infinity };
    expect(clampRectZoom(100, 200, 200, limits)).toBeCloseTo(200 / (2 * 20)); // 5, well below MAX_MAGNIFIER_ZOOM
  });

  it("passes an in-range value through unchanged", () => {
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    expect(clampRectZoom(4, 200, 200, limits)).toBeCloseTo(4);
  });
});

// Addendum I (2026-08-09), §I5: the grip's runtime clamp — the source is the
// FIXED quantity, the lens (`lens = source * zoom`) is the derived one, the
// inverse of clampRectZoom's own creation-time (lens-dims-known) shape.
describe("clampRectZoomForSource", () => {
  // minSource/minRectSource are irrelevant here (this reads only
  // limits.minLens) but still required by the type, so each fixture sets
  // them to an arbitrary value this function never reads.
  it("clamps below MIN_MAGNIFIER_ZOOM up to the floor when the canvas is large enough that the lens-size floor doesn't bind", () => {
    const canvasSize = { w: 10000, h: 10000 };
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampRectZoomForSource(0.5, 200, 200, canvasSize, limits)).toBeCloseTo(MIN_MAGNIFIER_ZOOM);
  });

  it("clamps above MAX_MAGNIFIER_ZOOM down to the ceiling when the canvas is large enough relative to the source", () => {
    const canvasSize = { w: 10000, h: 10000 };
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampRectZoomForSource(100, 200, 200, canvasSize, limits)).toBeCloseTo(MAX_MAGNIFIER_ZOOM);
  });

  it("per-axis ceiling: the tighter of the two canvas-relative caps binds", () => {
    // width axis: 2*0.45*1000/10 = 90; height axis: 2*0.45*100/10 = 9 — the
    // height axis is the tighter cap here.
    const canvasSize = { w: 1000, h: 100 };
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 0, maxLens: Infinity };
    const expectedHi = (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / 10;
    expect(clampRectZoomForSource(100, 10, 10, canvasSize, limits)).toBeCloseTo(expectedHi);
    // Transposing the canvas moves the bind to the other axis, same value by
    // construction (a square source), confirming both axes are consulted.
    expect(clampRectZoomForSource(100, 10, 10, { w: 100, h: 1000 }, limits)).toBeCloseTo(expectedHi);
  });

  it("per-axis floor: limits.minLens divided by the SMALLER source dimension binds, order-independent", () => {
    const canvasSize = { w: 100000, h: 100000 }; // hi stays at MAX_MAGNIFIER_ZOOM, well clear of the floor
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 50, maxLens: Infinity };
    const expectedLo = (2 * 50) / 10; // = 10, above MIN_MAGNIFIER_ZOOM
    expect(clampRectZoomForSource(0.1, 10, 1000, canvasSize, limits)).toBeCloseTo(expectedLo);
    expect(clampRectZoomForSource(0.1, 1000, 10, canvasSize, limits)).toBeCloseTo(expectedLo);
  });

  it("hi wins on a degenerate (tiny) canvas: the naive lens-size floor would exceed the cap, but the cap wins instead of an inverted lo>hi range", () => {
    const canvasSize = { w: 1, h: 1 };
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 1000, maxLens: Infinity };
    const hi = Math.min(MAX_MAGNIFIER_ZOOM, (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.w) / 10, (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / 10);
    // The naive floor (2*minLens/min(sw,sh) = 200) would exceed `hi` — every
    // requested zoom, however small or large, must land exactly on `hi`.
    expect(clampRectZoomForSource(0.001, 10, 10, canvasSize, limits)).toBeCloseTo(hi);
    expect(clampRectZoomForSource(1000, 10, 10, canvasSize, limits)).toBeCloseTo(hi);
  });

  it("passes an in-range value through unchanged", () => {
    const canvasSize = { w: 10000, h: 10000 };
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 0, maxLens: Infinity };
    expect(clampRectZoomForSource(4, 200, 200, canvasSize, limits)).toBeCloseTo(4);
  });

  it("a zero-width or zero-height source does not produce NaN/Infinity — Number.EPSILON floors it, saturating the per-axis cap instead of dividing by zero", () => {
    const canvasSize = { w: 1000, h: 800 };
    const limits: MagnifierSizeLimits = { minSource: 0, minRectSource: 0, minLens: 0, maxLens: Infinity };
    const r1 = clampRectZoomForSource(5, 0, 100, canvasSize, limits);
    const r2 = clampRectZoomForSource(5, 100, 0, canvasSize, limits);
    const r3 = clampRectZoomForSource(5, 0, 0, canvasSize, limits);
    expect(Number.isFinite(r1)).toBe(true);
    expect(Number.isFinite(r2)).toBe(true);
    expect(Number.isFinite(r3)).toBe(true);
    // With minLens=0, `lo` stays at MIN_MAGNIFIER_ZOOM regardless of the
    // zero dimension, and `hi` is pinned at MAX_MAGNIFIER_ZOOM too (the
    // canvas-relative terms become astronomically large, not infinite, when
    // dividing by Number.EPSILON), so a mid-range request (5) passes through.
    expect(r1).toBeCloseTo(5);
    expect(r2).toBeCloseTo(5);
    expect(r3).toBeCloseTo(5);
  });
});

describe("deriveRectLensSize", () => {
  it("zoom parity with the circle preset: when neither axis clamp bites, the rect's zoom equals deriveLensSizeForSource's zoom for the same sourceHalfW", () => {
    const canvasSize = { w: 1000, h: 800 }; // limits: minSource=20, minRectSource=4, minLens=28, maxLens=360
    const limits = magnifierSizeLimits(canvasSize, 1);
    const result = deriveRectLensSize("M", canvasSize, limits);
    // sourceHalfW = defaultSourceRadius = 60 (floored at the CIRCLE's minSource,
    // step 1 — unaffected by Addendum G); sourceHalfH = max(60/(8/3), minRectSource=4)
    // = 22.5 (aspect wins by a wide margin, not the — now much smaller — floor).
    expect(result.sourceHalfW).toBeCloseTo(60);
    expect(result.sourceHalfH).toBeCloseTo(60 / MAGNIFIER_RECT_ASPECT);
    expect(result.width).toBeCloseTo(300);
    expect(result.height).toBeCloseTo(112.5);
    expect(result.zoom).toBeCloseTo(2.5);
    const circle = deriveLensSizeForSource(result.sourceHalfW, "M", canvasSize, limits);
    expect(result.zoom).toBeCloseTo(circle.zoom);
    expect(result.width / 2).toBeCloseTo(circle.radius);
  });

  it("D11's own fixture, recomputed under Addendum G's much smaller floor: the operability floor no longer bites here at all, so the source keeps its NATURAL 8:3 aspect without the N3 widening branch engaging (Addendum G §G2 table, row 3)", () => {
    // Addendum G (§G1) shrank the rect floor from minSource (20 CSS px, a
    // fingertip size) to minRectSource (4 CSS px, legibility-only). This is
    // the exact canvas/scale/preset D11 originally used to demonstrate its
    // widen-not-square fix (pre-Addendum-G: baseHalfW/ASPECT=13.5 fell below
    // the old floor of 20, so the floor lifted sourceHalfH to 20 and D11's
    // mechanism widened sourceHalfW back out to 53.33 to preserve 8:3).
    // Under Addendum G's floor (4, CSS-scaled to 4 here since scale=1),
    // 13.5 clears it comfortably — the floor simply doesn't engage anymore,
    // and the source keeps its natural (unwidened) 8:3 proportions. This is
    // the expected, intentional behavior change request (1) asked for: the
    // operability floor stops distorting the rect source's shape/size for
    // all but the most extreme canvases.
    const canvasSize = { w: 600, h: 500 };
    const limits = magnifierSizeLimits(canvasSize, 1);
    const result = deriveRectLensSize("M", canvasSize, limits);
    const baseHalfW = 36; // defaultSourceRadius: FRACTION*longSide(0.06*600=36) clears both minSource(20) and the panorama cap(0.15*500=75)
    expect(baseHalfW / MAGNIFIER_RECT_ASPECT).toBeGreaterThanOrEqual(limits.minRectSource); // confirms the floor does NOT bind here anymore
    expect(result.sourceHalfW).toBeCloseTo(36);
    expect(result.sourceHalfH).toBeCloseTo(13.5);
    expect(result.width).toBeCloseTo(180);
    expect(result.height).toBeCloseTo(67.5);
    expect(result.zoom).toBeCloseTo(2.5);
    expect(result.width / result.height).toBeCloseTo(MAGNIFIER_RECT_ASPECT, 5); // natural aspect, not the N3 widening path
  });

  it("degenerate backstop case: zoom clamps to MIN_MAGNIFIER_ZOOM through the whole composition on a pathologically tiny canvas", () => {
    const canvasSize = { w: 10, h: 10 };
    const limits = magnifierSizeLimits(canvasSize, 0.01); // minSource backstop-bound (2), see magnifierSizeLimits's own tests
    const result = deriveRectLensSize("S", canvasSize, limits);
    expect(result.sourceHalfW).toBeCloseTo(MIN_MAGNIFIER_SOURCE_RADIUS_PX);
    expect(result.sourceHalfH).toBeCloseTo(MIN_MAGNIFIER_SOURCE_RADIUS_PX);
    expect(result.zoom).toBeCloseTo(MIN_MAGNIFIER_ZOOM);
    expect(result.width).toBeCloseTo(2 * MIN_MAGNIFIER_SOURCE_RADIUS_PX * MIN_MAGNIFIER_ZOOM);
    expect(result.height).toBeCloseTo(2 * MIN_MAGNIFIER_SOURCE_RADIUS_PX * MIN_MAGNIFIER_ZOOM);
  });

  it("post-condition: width/height stay within their own axis bounds, zoom stays within [MIN,MAX], and both derived source half-extents never fall below limits.minRectSource (Addendum G — was limits.minSource pre-Addendum-G), over a table of presets/canvas sizes/scales", () => {
    const table: Array<{ size: "S" | "M" | "L"; canvasSize: { w: number; h: number }; scale: number; minAspect?: number }> = [
      { size: "M", canvasSize: { w: 1000, h: 800 }, scale: 1 },
      { size: "S", canvasSize: { w: 1170, h: 2532 }, scale: 3.55 }, // iPhone screenshot
      { size: "L", canvasSize: { w: 2560, h: 1440 }, scale: 2.13 },
      { size: "S", canvasSize: { w: 100, h: 80 }, scale: 10 }, // both canvas caps bind
      { size: "L", canvasSize: { w: 4000, h: 3000 }, scale: 0.1 },
      { size: "M", canvasSize: { w: 600, h: 500 }, scale: 1 },
      // Addendum D §D11 (fixes N3): widening + inheriting the circle's
      // preset zoom keeps the lens noticeably wider than tall even on a
      // canvas/scale combo where the operability floor bites hard on one axis.
      { size: "M", canvasSize: { w: 2048, h: 1536 }, scale: 5, minAspect: 2 },
    ];
    for (const { size, canvasSize, scale, minAspect } of table) {
      const limits = magnifierSizeLimits(canvasSize, scale);
      const result = deriveRectLensSize(size, canvasSize, limits);
      const lensHalfW = result.width / 2;
      const lensHalfH = result.height / 2;
      expect(lensHalfW).toBeGreaterThanOrEqual(limits.minLens - 1e-9);
      expect(lensHalfW).toBeLessThanOrEqual(limits.maxLens + 1e-9);
      expect(lensHalfH).toBeGreaterThanOrEqual(limits.minLens - 1e-9);
      expect(lensHalfH).toBeLessThanOrEqual(0.45 * canvasSize.h + 1e-9); // MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h
      expect(result.zoom).toBeGreaterThanOrEqual(MIN_MAGNIFIER_ZOOM - 1e-9);
      expect(result.zoom).toBeLessThanOrEqual(MAX_MAGNIFIER_ZOOM + 1e-9);
      // clampRectZoom's whole purpose: neither derived source half-extent
      // (the width/height axes divided back down by the FINAL zoom) may
      // fall below limits.minRectSource.
      expect(lensHalfW / result.zoom).toBeGreaterThanOrEqual(limits.minRectSource - 1e-6);
      expect(lensHalfH / result.zoom).toBeGreaterThanOrEqual(limits.minRectSource - 1e-6);
      if (minAspect !== undefined) {
        expect(result.width / result.height).toBeGreaterThan(minAspect);
      }
    }
  });
});

describe("magnifierRectSlideUpdate", () => {
  const canvasSize = { w: 1000, h: 800 };

  it("on-canvas slide: from equals the pointer unchanged (the clamp is a no-op); at follows at the frozen offset", () => {
    const frozen = { offset: { x: 50, y: -30 }, half: { x: 40, y: 25 } };
    const result = magnifierRectSlideUpdate({ x: 200, y: 150 }, frozen, canvasSize);
    expect(result.from).toEqual({ x: 200, y: 150 });
    expect(result.at).toEqual({ x: 250, y: 120 });
  });

  it("off-corner slide: `from` (the source) is clamped onto the bitmap on both axes", () => {
    const frozen = { offset: { x: 0, y: 0 }, half: { x: 40, y: 25 } };
    const result = magnifierRectSlideUpdate({ x: -500, y: -500 }, frozen, canvasSize);
    expect(result.from).toEqual({ x: 0, y: 0 });
  });

  it("at derives from the CLAMPED from, not the raw off-canvas pointer", () => {
    const frozen = { offset: { x: 50, y: 20 }, half: { x: 40, y: 25 } };
    const result = magnifierRectSlideUpdate({ x: 1500, y: 150 }, frozen, canvasSize);
    // from clamps to (1000, 150); raw at = (1050, 170), then clampRectLensCenter clamps x to W - halfW = 960.
    expect(result.from).toEqual({ x: 1000, y: 150 });
    expect(result.at.x).toBeCloseTo(canvasSize.w - frozen.half.x);
    expect(result.at.y).toBeCloseTo(170);
  });

  it("clamps `at` back on-canvas when the frozen offset alone pushes it off the edge, even with an on-canvas pointer (from stays unclamped here)", () => {
    const frozen = { offset: { x: 900, y: 0 }, half: { x: 40, y: 25 } };
    const result = magnifierRectSlideUpdate({ x: 200, y: 150 }, frozen, canvasSize);
    expect(result.from).toEqual({ x: 200, y: 150 });
    expect(result.at.x).toBeCloseTo(canvasSize.w - frozen.half.x); // clamped to W - halfW = 960
    expect(result.at.y).toBeCloseTo(150);
  });

  it("half is not part of the return value — sizing cannot change mid-slide by construction", () => {
    const frozen = { offset: { x: 0, y: 0 }, half: { x: 40, y: 25 } };
    const result = magnifierRectSlideUpdate({ x: 10, y: 10 }, frozen, canvasSize);
    expect(result).not.toHaveProperty("half");
    expect(result).not.toHaveProperty("width");
    expect(result).not.toHaveProperty("height");
  });
});
