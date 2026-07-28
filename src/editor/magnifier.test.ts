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
  MAGNIFIER_SOURCE_RADIUS_FRACTION,
  MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO,
  type MagnifierSizeLimits,
} from "./magnifier";
import type { MagnifierAnnotation, Point } from "./model";

function magnifier(overrides: Partial<MagnifierAnnotation> = {}): MagnifierAnnotation {
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
    expect(limits.minSource).toBeCloseTo(16 * 2); // MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX * scale
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
    // At scale=10, limits.minSource = max(2, min(16*10=160, 0.15*1600=240)) = 160 > 120.
    const canvasSize = { w: 2000, h: 1600 };
    const limits = magnifierSizeLimits(canvasSize, 10);
    expect(limits.minSource).toBeCloseTo(160);
    expect(defaultSourceRadius(canvasSize, limits)).toBeCloseTo(160);
  });
});

describe("deriveLensSizeForSource", () => {
  const canvasSize = { w: 1000, h: 800 }; // longSide=1000, shortSide=800
  const limits = magnifierSizeLimits(canvasSize, 1); // minSource=16, minLens=28, maxLens=360

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
      { sourceRadius: 57, size: "M", canvasSize: { w: 1170, h: 2532 }, scale: 3.55 }, // design note's iPhone sanity check
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
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    expect(clampZoom(0.5, a, limits)).toBeCloseTo(MIN_MAGNIFIER_ZOOM);
  });

  it("clamps above MAX_MAGNIFIER_ZOOM down to the ceiling when radius is large enough relative to limits.minSource", () => {
    const a = magnifier({ radius: 1000 }); // radius/minSource = 500, so MAX_ZOOM (16) is the binding ceiling
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    expect(clampZoom(100, a, limits)).toBeCloseTo(MAX_MAGNIFIER_ZOOM);
  });

  it("limits.minSource caps zoom below MAX_MAGNIFIER_ZOOM when radius is small relative to it", () => {
    // radius = 10 -> radius / minSource (2) = 5, which is below MAX_MAGNIFIER_ZOOM (16).
    const a = magnifier({ radius: 10 });
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
    expect(clampZoom(100, a, limits)).toBeCloseTo(10 / MIN_MAGNIFIER_SOURCE_RADIUS_PX);
  });

  it("a larger limits.minSource (e.g. from a small on-screen display scale) lowers the reachable zoom ceiling for the same radius", () => {
    const a = magnifier({ radius: 100 });
    const limits: MagnifierSizeLimits = { minSource: 20, minLens: 0, maxLens: Infinity };
    expect(clampZoom(100, a, limits)).toBeCloseTo(100 / 20); // 5, well below MAX_MAGNIFIER_ZOOM
  });

  it("passes an in-range value through unchanged", () => {
    const a = magnifier({ radius: 100 });
    const limits: MagnifierSizeLimits = { minSource: MIN_MAGNIFIER_SOURCE_RADIUS_PX, minLens: 0, maxLens: Infinity };
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
  // unlike a committed magnifier's src-move handle drag (resize.ts), which
  // stays unclamped — see magnifierSlideUpdate's doc comment for the
  // create-vs-edit distinction. Per-axis clamping is already covered directly
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
