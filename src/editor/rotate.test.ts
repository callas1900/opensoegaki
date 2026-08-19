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
  documentRotation,
  rotateAnnotationForDocument,
} from "./rotate";
import { boundsOf } from "./bounds";
import type {
  ArrowAnnotation,
  BadgeAnnotation,
  CircleMagnifierAnnotation,
  HighlighterAnnotation,
  ImageAnnotation,
  Point,
  RectAnnotation,
  RectMagnifierAnnotation,
  TextAnnotation,
} from "./model";

// Trivial fake 2D context: only `font` (settable) and `measureText` are used
// by boundsOf's text branch — same fixture shape as hittest.test.ts. AUTO
// badges only in this file (badgeHalfWidth's manual branch needs a real
// `document` to create an offscreen canvas — unavailable in vitest's
// environment: "node" — see hittest.test.ts's precedent).
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

/**
 * The full-coverage output rect for a `w x h` source rotated by `angle`,
 * expressed in "rotated-source" space as `documentRotation`'s `outRect`
 * expects it: origin AT the rotated bbox's own top-left (so `{x:0,y:0}`,
 * always — the size, not the position, is what `rotatedCorners`'s
 * pivot-centered min/max gives us). Mirrors what crop.ts's
 * `cropFrameFor`/`frameToRotatedSource` would hand `documentRotation` for an
 * untouched (whole-image) crop.
 */
function fullOutRect(w: number, h: number, angle: number) {
  const pts = rotatedCorners({ x: 0, y: 0, w, h }, angle);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: 0,
    y: 0,
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

describe("documentRotation", () => {
  it("four successive 90 degree rotations return to the identity", () => {
    let w = 100;
    let h = 60;
    const original: Point = { x: 20, y: 10 };
    let point: Point = { ...original };
    for (let i = 0; i < 4; i++) {
      const outRect = fullOutRect(w, h, Math.PI / 2);
      const r = documentRotation(w, h, Math.PI / 2, outRect);
      point = r.map(point);
      w = r.out.w;
      h = r.out.h;
    }
    expect(point.x).toBeCloseTo(original.x, 6);
    expect(point.y).toBeCloseTo(original.y, 6);
    // Back to the original document size too.
    expect(w).toBe(100);
    expect(h).toBe(60);
  });

  it("out is the rounded outRect size, and angle is normalized", () => {
    const outRect = { x: 0, y: 0, w: 60.4, h: 100.6 };
    const r = documentRotation(100, 60, Math.PI / 2, outRect);
    expect(r.out).toEqual({ w: 60, h: 101 });
    expect(r.angle).toBeCloseTo(Math.PI / 2, 9);
  });

  it("matrix maps the source corners onto the output corners, consistent with map()", () => {
    const w = 100;
    const h = 60;
    const angle = Math.PI / 2;
    const outRect = fullOutRect(w, h, angle);
    const r = documentRotation(w, h, angle, outRect);
    const [a, b, c, d, e, f] = r.matrix;

    const applyMatrix = (p: Point): Point => ({
      x: p.x * a + p.y * c + e,
      y: p.x * b + p.y * d + f,
    });

    const sourceCorners: Point[] = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const outputCorners = new Set([
      `${0},${0}`,
      `${r.out.w},${0}`,
      `${r.out.w},${r.out.h}`,
      `${0},${r.out.h}`,
    ]);

    for (const corner of sourceCorners) {
      const viaMap = r.map(corner);
      const viaMatrix = applyMatrix(corner);
      // matrix and map must agree exactly (matrix's translation term IS map(0,0)).
      expect(viaMatrix.x).toBeCloseTo(viaMap.x, 9);
      expect(viaMatrix.y).toBeCloseTo(viaMap.y, 9);
      const key = `${Math.round(viaMap.x)},${Math.round(viaMap.y)}`;
      expect(outputCorners.has(key)).toBe(true);
    }
  });

  it("is a pure translation (identity rotation) at angle 0", () => {
    const outRect = { x: 15, y: 25, w: 70, h: 50 };
    const r = documentRotation(100, 100, 0, outRect);
    const p = { x: 40, y: 60 };
    const mapped = r.map(p);
    expect(mapped.x).toBeCloseTo(p.x - outRect.x, 9);
    expect(mapped.y).toBeCloseTo(p.y - outRect.y, 9);
  });

  it("F2: a quarter turn maps integer source corners to EXACT integer output corners (no float residual)", () => {
    // Odd dimensions deliberately: srcW/2 and srcH/2 are non-integer, so this
    // only comes out exact if the half-offsets cancel bit-for-bit against a
    // TRULY zero/one cos/sin — `Math.cos(Math.PI / 2)` (6.1e-17) would leave
    // a residual here instead of landing on an integer.
    const w = 101;
    const h = 61;
    const angle = Math.PI / 2;
    const outRect = fullOutRect(w, h, angle); // {x:0, y:0, ...} — only x/y feed the map
    const r = documentRotation(w, h, angle, outRect);

    // The matrix's cos/sin must be the bit-exact snapped values, not ~6.1e-17.
    expect(r.matrix[0]).toBe(0); // cos
    expect(r.matrix[1]).toBe(1); // sin
    expect(r.matrix[2]).toBe(-1); // -sin
    expect(r.matrix[3]).toBe(0); // cos

    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    for (const p of corners) {
      const mapped = r.map(p);
      expect(Number.isInteger(mapped.x)).toBe(true);
      expect(Number.isInteger(mapped.y)).toBe(true);
    }
  });
});

describe("rotateAnnotationForDocument", () => {
  it("rect: mapped world corners match r.map applied to the original (unrotated) world corners", () => {
    const a: RectAnnotation = {
      id: "r1",
      kind: "rect",
      color: "#2f7de1",
      strokeWidth: 3,
      a: { x: 10, y: 10 },
      b: { x: 30, y: 20 },
    };
    const outRect = fullOutRect(100, 60, Math.PI / 2);
    const r = documentRotation(100, 60, Math.PI / 2, outRect);

    const originalCorners = rotatedCorners({ x: 10, y: 10, w: 20, h: 10 }, angleOf(a));
    const expectedCorners = originalCorners.map((p) => r.map(p));

    const result = rotateAnnotationForDocument(a, r, measure) as RectAnnotation;
    expect(angleOf(result)).toBeCloseTo(Math.PI / 2, 6);

    const rx = Math.min(result.a.x, result.b.x);
    const ry = Math.min(result.a.y, result.b.y);
    const rw = Math.abs(result.a.x - result.b.x);
    const rh = Math.abs(result.a.y - result.b.y);
    const resultCorners = rotatedCorners({ x: rx, y: ry, w: rw, h: rh }, angleOf(result));

    for (let i = 0; i < 4; i++) {
      expect(resultCorners[i].x).toBeCloseTo(expectedCorners[i].x, 6);
      expect(resultCorners[i].y).toBeCloseTo(expectedCorners[i].y, 6);
    }
  });

  it("arrow at angle 0 is mapped point-wise and gains no angle", () => {
    const a: ArrowAnnotation = {
      id: "arrow1",
      kind: "arrow",
      color: "#e8465a",
      strokeWidth: 6,
      from: { x: 12, y: 8 },
      to: { x: 40, y: 30 },
    };
    const outRect = fullOutRect(100, 60, Math.PI / 2);
    const r = documentRotation(100, 60, Math.PI / 2, outRect);
    const result = rotateAnnotationForDocument(a, r, measure) as ArrowAnnotation;

    expect(result.from).toEqual(r.map(a.from));
    expect(result.to).toEqual(r.map(a.to));
    expect(result.angle).toBeUndefined();
  });

  it("highlight at angle 0 is mapped point-wise and gains no angle", () => {
    const a: HighlighterAnnotation = {
      id: "h1",
      kind: "highlight",
      color: "#FBB034",
      strokeWidth: 6,
      points: [
        { x: 5, y: 5 },
        { x: 15, y: 5 },
        { x: 15, y: 15 },
      ],
    };
    const outRect = { x: 0, y: 0, w: 100, h: 100 }; // pure crop, angle 0
    const r = documentRotation(100, 100, 0, outRect);
    const result = rotateAnnotationForDocument(a, r, measure) as HighlighterAnnotation;

    expect(result.points).toEqual(a.points.map((p) => r.map(p)));
    expect(result.angle).toBeUndefined();
  });

  it("circle magnifier: at/from are mapped, angle stays 0, zoom and radius are unchanged", () => {
    const a: CircleMagnifierAnnotation = {
      id: "m1",
      kind: "magnifier",
      color: "#000000",
      strokeWidth: 2,
      at: { x: 50, y: 40 },
      from: { x: 20, y: 15 },
      zoom: 2,
      radius: 30,
    };
    const outRect = fullOutRect(100, 100, Math.PI / 2);
    const r = documentRotation(100, 100, Math.PI / 2, outRect);
    const result = rotateAnnotationForDocument(a, r, measure) as CircleMagnifierAnnotation;

    expect(result.at).toEqual(r.map(a.at));
    expect(result.from).toEqual(r.map(a.from));
    expect(result.angle).toBe(0);
    expect(result.zoom).toBe(2);
    expect(result.radius).toBe(30);
  });

  it("rect magnifier: swaps width/height at 90 and 270 degrees", () => {
    for (const angle of [Math.PI / 2, (3 * Math.PI) / 2]) {
      const a: RectMagnifierAnnotation = {
        id: "m2",
        kind: "magnifier",
        color: "#000000",
        strokeWidth: 2,
        shape: "rect",
        at: { x: 50, y: 40 },
        from: { x: 20, y: 15 },
        zoom: 2,
        width: 80,
        height: 50,
      };
      const outRect = fullOutRect(100, 100, angle);
      const r = documentRotation(100, 100, angle, outRect);
      const result = rotateAnnotationForDocument(a, r, measure) as RectMagnifierAnnotation;
      expect(result.width).toBe(50);
      expect(result.height).toBe(80);
      expect(result.angle).toBe(0);
    }
  });

  it("rect magnifier: does NOT swap width/height at a non-90-multiple angle (37 degrees)", () => {
    const angle = (37 * Math.PI) / 180;
    const a: RectMagnifierAnnotation = {
      id: "m3",
      kind: "magnifier",
      color: "#000000",
      strokeWidth: 2,
      shape: "rect",
      at: { x: 50, y: 40 },
      from: { x: 20, y: 15 },
      zoom: 2,
      width: 80,
      height: 50,
    };
    const outRect = fullOutRect(100, 100, angle);
    const r = documentRotation(100, 100, angle, outRect);
    const result = rotateAnnotationForDocument(a, r, measure) as RectMagnifierAnnotation;
    expect(result.width).toBe(80);
    expect(result.height).toBe(50);
    expect(result.angle).toBe(0);
  });

  it("auto badge: at maps through the pivot+translate branch (pivot === at, per boundsOf's badge case)", () => {
    const a: BadgeAnnotation = {
      id: "b1",
      kind: "badge",
      color: "#ED107B",
      strokeWidth: 6,
      at: { x: 40, y: 25 },
      number: 1,
      radius: 20,
    };
    const outRect = fullOutRect(100, 60, Math.PI / 2);
    const r = documentRotation(100, 60, Math.PI / 2, outRect);
    const result = rotateAnnotationForDocument(a, r, measure) as BadgeAnnotation;

    // A badge's pivot is exactly `at` (bounds.ts: the box is already centered
    // on it), so the mapped `at` must equal r.map(original at) exactly.
    expect(result.at.x).toBeCloseTo(r.map(a.at).x, 9);
    expect(result.at.y).toBeCloseTo(r.map(a.at).y, 9);
    expect(result.radius).toBe(20);
    expect(result.number).toBe(1);
    expect(angleOf(result)).toBeCloseTo(Math.PI / 2, 6);
  });

  it("F13: text uses `measure` for its local bounds — the pivot+translate branch maps its pivot exactly like rect's", () => {
    const a: TextAnnotation = {
      id: "t1",
      kind: "text",
      color: "#222222",
      strokeWidth: 1,
      at: { x: 20, y: 15 },
      text: "hi",
      fontSize: 20,
    };
    const outRect = fullOutRect(100, 60, Math.PI / 2);
    const r = documentRotation(100, 60, Math.PI / 2, outRect);
    const pivotBefore = pivotOfAnnotation(a, measure);

    const result = rotateAnnotationForDocument(a, r, measure) as TextAnnotation;

    expect(angleOf(result)).toBeCloseTo(Math.PI / 2, 6);
    const pivotAfter = pivotOfAnnotation(result, measure);
    const expected = r.map(pivotBefore);
    expect(pivotAfter.x).toBeCloseTo(expected.x, 6);
    expect(pivotAfter.y).toBeCloseTo(expected.y, 6);
  });

  it("F13: an already-angled rect accumulates the document rotation and normalizes past PI", () => {
    const startAngle = (170 * Math.PI) / 180;
    const a: RectAnnotation = {
      id: "r2",
      kind: "rect",
      color: "#2f7de1",
      strokeWidth: 3,
      a: { x: 10, y: 10 },
      b: { x: 30, y: 20 },
      angle: startAngle,
    };
    const angle = Math.PI / 2; // startAngle + 90deg = 260deg, must wrap past PI
    const outRect = fullOutRect(100, 60, angle);
    const r = documentRotation(100, 60, angle, outRect);

    const result = rotateAnnotationForDocument(a, r, measure) as RectAnnotation;

    const expected = normalizeAngle(startAngle + angle);
    // Sanity: this case only exercises the accumulate-and-normalize path if
    // the sum genuinely wraps (170 + 90 = 260deg > 180deg -> wraps negative).
    expect(expected).toBeLessThan(0);
    expect(angleOf(result)).toBeCloseTo(expected, 6);
  });

  it("F13: a nonzero outRect.x/y combined with a non-right angle still maps the pivot exactly", () => {
    const a: RectAnnotation = {
      id: "r3",
      kind: "rect",
      color: "#2f7de1",
      strokeWidth: 3,
      a: { x: 10, y: 10 },
      b: { x: 30, y: 20 },
    };
    const angle = (37 * Math.PI) / 180;
    // An arbitrary crop window in rotated-source space: neither full
    // coverage nor anchored at the origin, unlike every other case above.
    const outRect = { x: 15, y: 8, w: 50, h: 40 };
    const r = documentRotation(100, 60, angle, outRect);
    const pivotBefore = pivotOfAnnotation(a, measure);

    const result = rotateAnnotationForDocument(a, r, measure) as RectAnnotation;

    expect(angleOf(result)).toBeCloseTo(normalizeAngle(angle), 6);
    const pivotAfter = pivotOfAnnotation(result, measure);
    const expected = r.map(pivotBefore);
    expect(pivotAfter.x).toBeCloseTo(expected.x, 6);
    expect(pivotAfter.y).toBeCloseTo(expected.y, 6);
  });
});
