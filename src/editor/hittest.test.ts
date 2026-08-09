import { describe, it, expect } from "vitest";
import { hitTest, magnifierHitPart } from "./hittest";
import type {
  ArrowAnnotation,
  RectAnnotation,
  TextAnnotation,
  HighlighterAnnotation,
  BadgeAnnotation,
  ImageAnnotation,
  MagnifierAnnotation,
  RectMagnifierAnnotation,
  Annotation,
} from "./model";
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

function magnifier(
  at: { x: number; y: number },
  radius: number,
  from: { x: number; y: number },
  zoom: number,
  strokeWidth = 6,
): MagnifierAnnotation {
  return { id: "magnifier1", kind: "magnifier", color: "#ED107B", strokeWidth, at, radius, zoom, from };
}

function rectMagnifier(
  at: { x: number; y: number },
  width: number,
  height: number,
  from: { x: number; y: number },
  zoom: number,
  strokeWidth = 6,
): RectMagnifierAnnotation {
  return { id: "magnifier1", kind: "magnifier", shape: "rect", color: "#ED107B", strokeWidth, at, width, height, zoom, from };
}

// `hitTest`'s trailing `sourceMinHitHalf` parameter (Addendum G, 2026-08-08,
// §G3) is REQUIRED; every non-magnifier-specific call in this file passes
// `0` ("no minimum" — pure geometry, matching the pre-Addendum-G behavior
// exactly). Only the dedicated rect-hit-target tests near the bottom of this
// file pass a non-zero value.
describe("hitTest arrow", () => {
  it("a point on the shaft within tolerance hits", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });
    const result = hitTest([a], { x: 50, y: 1 }, measure, 5, 0);
    expect(result).toBe(a);
  });

  it("a far point misses", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 });
    const result = hitTest([a], { x: 50, y: 500 }, measure, 5, 0);
    expect(result).toBeNull();
  });

  it("a point just past an endpoint within tolerance + strokeWidth/2 hits", () => {
    const a = arrow({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    // tolerance 5 + strokeWidth/2 5 = 10 allowed past the endpoint.
    const result = hitTest([a], { x: 108, y: 0 }, measure, 5, 0);
    expect(result).toBe(a);
  });
});

describe("hitTest rect", () => {
  it("a point near the perimeter hits", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const result = hitTest([r], { x: 0, y: 50 }, measure, 5, 0);
    expect(result).toBe(r);
  });

  it("a point in the hollow center misses", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const result = hitTest([r], { x: 50, y: 50 }, measure, 5, 0);
    expect(result).toBeNull();
  });

  it("a degenerate thin rect falls back to a filled hit", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 1 }, 0);
    const result = hitTest([r], { x: 50, y: 0.5 }, measure, 1, 0);
    expect(result).toBe(r);
  });
});

describe("hitTest text", () => {
  it("a point inside the inflated bbox hits", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const result = hitTest([t], { x: 5, y: 10 }, measure, 5, 0);
    expect(result).toBe(t);
  });

  it("a point outside misses", () => {
    const t = text({ x: 0, y: 0 }, "hi", 20);
    const result = hitTest([t], { x: 500, y: 500 }, measure, 5, 0);
    expect(result).toBeNull();
  });
});

describe("hitTest highlight", () => {
  const strokeWidth = 6;
  const tol = 5;
  const threshold = tol + (strokeWidth * HIGHLIGHTER_WIDTH_SCALE) / 2; // 5 + 9 = 14

  it("a point on the middle segment hits", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], strokeWidth);
    const result = hitTest([h], { x: 75, y: 0 }, measure, tol, 0);
    expect(result).toBe(h);
  });

  it("a far point misses", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], strokeWidth);
    const result = hitTest([h], { x: 75, y: 1000 }, measure, tol, 0);
    expect(result).toBeNull();
  });

  it("a point offset from a segment by just under tolerance + strokeWidth*3/2 hits", () => {
    const h = highlight([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }], strokeWidth);
    const result = hitTest([h], { x: 75, y: threshold - 0.1 }, measure, tol, 0);
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
    const result = hitTest([b], { x: 50, y: 50 }, measure, 5, 0);
    expect(result).toBe(b);
  });

  it("a point just inside radius + tolerance hits", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const result = hitTest([b], { x: 50 + 24.9, y: 50 }, measure, 5, 0);
    expect(result).toBe(b);
  });

  it("a point well outside misses", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const result = hitTest([b], { x: 500, y: 500 }, measure, 5, 0);
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
    expect(hitTest([rotated], worldPoint, measure, 5, 0)).toBe(rotated);
  });

  it("rect: the pre-rotation world position no longer hits once rotated", () => {
    const r = rect({ x: 0, y: 0 }, { x: 100, y: 50 }, 4);
    const localHitPoint = { x: 50, y: 0 };
    const rotated: RectAnnotation = { ...r, angle: Math.PI / 2 };
    expect(hitTest([rotated], localHitPoint, measure, 5, 0)).toBeNull();
  });

  it("text: a local-frame bbox point still hits at its rotated world position", () => {
    const t = text({ x: 0, y: 0 }, "hello", 20); // bounds w=50,h=24
    const angle = Math.PI / 3;
    const pivot = pivotOfAnnotation(t, measure);
    const localHitPoint = { x: 10, y: 10 };
    const worldPoint = rotatePoint(localHitPoint, pivot, angle);
    const rotated: TextAnnotation = { ...t, angle };
    expect(hitTest([rotated], worldPoint, measure, 5, 0)).toBe(rotated);
  });

  it("image: a local-frame bbox point still hits at its rotated world position", () => {
    const img = image({ x: 10, y: 10 }, 80, 40);
    const angle = -0.9;
    const pivot = pivotOfAnnotation(img, measure);
    const localHitPoint = { x: 20, y: 20 };
    const worldPoint = rotatePoint(localHitPoint, pivot, angle);
    const rotated: ImageAnnotation = { ...img, angle };
    expect(hitTest([rotated], worldPoint, measure, 5, 0)).toBe(rotated);
  });

  it("badge: rotation around its own center leaves the circular hit region unchanged", () => {
    const b = badge({ x: 50, y: 50 }, 20);
    const rotated: BadgeAnnotation = { ...b, angle: Math.PI / 4 };
    expect(hitTest([rotated], { x: 50, y: 50 }, measure, 5, 0)).toBe(rotated);
    expect(hitTest([rotated], { x: 50 + 24.9, y: 50 }, measure, 5, 0)).toBe(rotated);
  });

  it("angle: 0 explicit behaves identically to angle absent", () => {
    const r1 = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const r2: RectAnnotation = { ...r1, angle: 0 };
    expect(hitTest([r1], { x: 0, y: 50 }, measure, 5, 0)).toBe(r1);
    expect(hitTest([r2], { x: 0, y: 50 }, measure, 5, 0)).toBe(r2);
  });
});

// sourceRadius = radius/zoom = 60/3 = 20; markerStroke = max(1, 6*0.9) = 5.4;
// source disc hit band = tolerance + markerStroke/2 = 5 + 2.7 = 7.7, so the
// source disc hits out to 20 + 7.7 = 27.7 from `from`.
describe("hitTest magnifier", () => {
  it("the lens interior (a filled circle) hits", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    expect(hitTest([m], { x: 200, y: 150 }, measure, 5, 0)).toBe(m);
    expect(hitTest([m], { x: 200 + 64.9, y: 150 }, measure, 5, 0)).toBe(m); // just inside radius + tolerance
  });

  it("the source disc interior hits (it is the drag surface, live even when the magnifier is unselected)", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    // Distance 5 from `from`, well inside sourceRadius (20).
    expect(hitTest([m], { x: 55, y: 50 }, measure, 5, 0)).toBe(m);
    // The exact center of the source circle.
    expect(hitTest([m], { x: 50, y: 50 }, measure, 5, 0)).toBe(m);
  });

  it("the source disc's outer band hits", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    expect(hitTest([m], { x: 50 + 20, y: 50 }, measure, 5, 0)).toBe(m); // exactly on the ring
    expect(hitTest([m], { x: 50 + 27.6, y: 50 }, measure, 5, 0)).toBe(m); // just inside the band (27.7)
  });

  it("a point well outside both the lens and the source disc band misses", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    expect(hitTest([m], { x: 500, y: 500 }, measure, 5, 0)).toBeNull();
  });
});

// Direct magnifierHitPart coverage: the probe's own vocabulary ("lens" |
// "source" | null), including the lens-wins-on-overlap priority that
// hitTest's topmost-first / paint-order rule depends on.
describe("magnifierHitPart", () => {
  it("returns 'lens' at the lens center", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    expect(magnifierHitPart(m, { x: 200, y: 150 }, 5, 0)).toBe("lens");
  });

  it("returns 'lens' where the lens and source discs overlap (paint-order priority)", () => {
    // at=(100,100) r=30 (effective 35 with tolerance); from=(100,140) sourceRadius=15
    // (effective 22.7 with band); centers 40 apart, so the two effective discs
    // (35 and 22.7) overlap along the line between them (35 + 22.7 > 40 > |35-22.7|).
    const m = magnifier({ x: 100, y: 100 }, 30, { x: 100, y: 140 }, 2);
    const overlapPoint = { x: 100, y: 125 }; // dist 25 from `at`, dist 15 from `from` — inside both
    expect(magnifierHitPart(m, overlapPoint, 5, 0)).toBe("lens");
  });

  it("returns 'source' at the source center and at the source band's outer edge", () => {
    const m = magnifier({ x: 100, y: 100 }, 30, { x: 100, y: 140 }, 2);
    expect(magnifierHitPart(m, { x: 100, y: 140 }, 5, 0)).toBe("source");
    // sourceRadius 15 + band 7.7 = 22.7; just inside, away from the lens.
    expect(magnifierHitPart(m, { x: 100, y: 140 + 22.6 }, 5, 0)).toBe("source");
  });

  it("returns null just outside the source band", () => {
    const m = magnifier({ x: 100, y: 100 }, 30, { x: 100, y: 140 }, 2);
    expect(magnifierHitPart(m, { x: 100, y: 140 + 22.8 }, 5, 0)).toBeNull();
  });

  it("returns null far away from both discs", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    expect(magnifierHitPart(m, { x: 1000, y: 1000 }, 5, 0)).toBeNull();
  });
});

// Rect (D2) branch: filled-rect hits instead of filled-circle hits, same
// paint-order (lens-wins) and inflation rules. Fixture: at=(200,150)
// width=120 height=60 from=(50,50) zoom=3 -> lensRect x[140,260] y[120,180];
// sourceRect (width/zoom x height/zoom = 40x20, centered on from) x[30,70]
// y[40,60]. markerStroke = max(1, 6*0.9) = 5.4, so the source band inflates
// by tolerance(5) + markerStroke/2(2.7) = 7.7; the lens inflates by
// tolerance(5) alone (no marker band on the lens fill). `sourceMinHitHalf`
// is `0` throughout this block (well below this fixture's own raw
// half-extents, so it never binds) — see "magnifierHitPart: rect source
// hit-target floor" below for the Addendum G floor itself.
describe("magnifierHitPart: rect (D2)", () => {
  const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3);

  it("returns 'lens' inside the filled lens rect, including near its inflated edge", () => {
    expect(magnifierHitPart(m, { x: 200, y: 150 }, 5, 0)).toBe("lens"); // center
    expect(magnifierHitPart(m, { x: 260, y: 150 }, 5, 0)).toBe("lens"); // exactly on the east edge
    expect(magnifierHitPart(m, { x: 264.9, y: 150 }, 5, 0)).toBe("lens"); // just inside the inflated (tolerance-only) band
  });

  it("returns null just outside the lens's inflated edge (and clear of the source)", () => {
    expect(magnifierHitPart(m, { x: 265.1, y: 150 }, 5, 0)).toBeNull();
  });

  it("returns 'source' inside the filled source rect, including near its (tolerance + markerStroke/2) inflated edge", () => {
    expect(magnifierHitPart(m, { x: 50, y: 50 }, 5, 0)).toBe("source"); // center
    expect(magnifierHitPart(m, { x: 70, y: 50 }, 5, 0)).toBe("source"); // exactly on the east edge
    expect(magnifierHitPart(m, { x: 77.6, y: 50 }, 5, 0)).toBe("source"); // just inside the 7.7px band
  });

  it("returns null just outside the source's inflated edge", () => {
    expect(magnifierHitPart(m, { x: 77.8, y: 50 }, 5, 0)).toBeNull();
  });

  it("returns 'lens' where the lens and source rects overlap (paint-order priority, same as the circle case)", () => {
    // at=(100,100) w=60 h=60 -> lensRect x[70,130] y[70,130];
    // from=(100,130) zoom=2 -> sourceRect (30x30) x[85,115] y[115,145].
    // Overlap region: x[85,115] y[115,130].
    const overlapping = rectMagnifier({ x: 100, y: 100 }, 60, 60, { x: 100, y: 130 }, 2);
    expect(magnifierHitPart(overlapping, { x: 100, y: 125 }, 5, 0)).toBe("lens");
    // Same fixture, a point inside the source but outside the lens (y=140, past the lens's y<=130 edge).
    expect(magnifierHitPart(overlapping, { x: 100, y: 140 }, 5, 0)).toBe("source");
  });

  it("returns null far away from both rects", () => {
    expect(magnifierHitPart(m, { x: 1000, y: 1000 }, 5, 0)).toBeNull();
  });
});

// Addendum G (2026-08-08, §G3): the rect source's fingertip/operability
// requirement moved OUT of its drawn size (now a legibility-only floor,
// magnifier.ts's MIN_MAGNIFIER_RECT_SOURCE_CSS_PX) and INTO the hit region,
// independently floored per axis at `sourceMinHitHalf` (canvas.ts's
// magnifierSourceMinHit — mirrored here as a plain number, since hittest.ts
// itself is canvas/DOM-free pure geometry). These three cases are exactly
// G7's required (a)/(b)/(c).
describe("magnifierHitPart: rect source hit-target floor (Addendum G §G3)", () => {
  // An 8x21 bitmap px source (G1's own "smallest source" example) — raw
  // half-extents 4x10.5, well under any fingertip floor. Built directly via
  // width/height/zoom=1 (magnifierSourceRect divides by zoom, so zoom=1
  // makes the source dimensions equal the lens dimensions exactly) rather
  // than via deriveRectLensSize, to keep this test's own fixture minimal
  // and self-contained.
  const from = { x: 100, y: 100 };
  const tol = 5;
  const strokeWidth = 6; // markerStroke = max(1, 6*0.9) = 5.4, pad = tol(5) + markerStroke/2(2.7) = 7.7
  // MAGNIFIER_SOURCE_MIN_HIT_HALF_PX(11) * TOUCH_HIT_MULTIPLIER(2) * cropScale(1) — canvas.ts's own touch-scaled value, mirrored as a plain number (hittest.ts must not import canvas.ts).
  const sourceMinHitHalf = 22;

  it("(a) a press 15 CSS px outside the raw 8x21 source (well beyond its own tolerance+marker band) still returns 'source', because the hit target is floored at sourceMinHitHalf", () => {
    const farLens = rectMagnifier({ x: 1000, y: 1000 }, 8, 21, from, 1, strokeWidth); // lens far away, doesn't interfere
    // Raw hit half-extents without the floor: hw = 4+7.7 = 11.7, hh = 10.5+7.7 = 18.2.
    // Press 15 px east of `from`: outside the raw band (15 > 11.7) but inside
    // the floored one (15 <= sourceMinHitHalf = 22).
    expect(magnifierHitPart(farLens, { x: from.x + 15, y: from.y }, tol, sourceMinHitHalf)).toBe("source");
    // Control: without the floor (sourceMinHitHalf=0), the same press misses entirely.
    expect(magnifierHitPart(farLens, { x: from.x + 15, y: from.y }, tol, 0)).toBeNull();
  });

  it("(b) the same press, with the lens covering that point, returns 'lens' — the lens still wins even though the source's floored hit region also covers it", () => {
    const coveringLens = rectMagnifier({ x: from.x + 15, y: from.y }, 8, 21, from, 1, strokeWidth);
    expect(magnifierHitPart(coveringLens, { x: from.x + 15, y: from.y }, tol, sourceMinHitHalf)).toBe("lens");
  });

  it("(c) a circle magnifier is bit-identical with sourceMinHitHalf = 0 and = 22 — the circle branch ignores this parameter entirely", () => {
    const m = magnifier({ x: 200, y: 150 }, 60, { x: 50, y: 50 }, 3);
    // At the source band's outer edge (hits) and just past it (misses) —
    // same two probes "hitTest magnifier"/"magnifierHitPart" above already
    // use for the circle, run at both sourceMinHitHalf values.
    expect(magnifierHitPart(m, { x: 50 + 27.6, y: 50 }, tol, 0)).toBe("source");
    expect(magnifierHitPart(m, { x: 50 + 27.6, y: 50 }, tol, 22)).toBe("source");
    expect(magnifierHitPart(m, { x: 50 + 27.8, y: 50 }, tol, 0)).toBeNull();
    expect(magnifierHitPart(m, { x: 50 + 27.8, y: 50 }, tol, 22)).toBeNull();
  });
});

// hitTest's own "magnifier" case is a pure delegation to magnifierHitPart
// (returns non-null iff the annotation is hit) — one integration test to
// pin that the rect branch is wired through hitTest the same way the circle
// branch already is (see "hitTest magnifier" above).
describe("hitTest magnifier rect (D2)", () => {
  it("a filled lens hit and a filled source-band hit both resolve through hitTest", () => {
    const m = rectMagnifier({ x: 200, y: 150 }, 120, 60, { x: 50, y: 50 }, 3);
    expect(hitTest([m], { x: 200, y: 150 }, measure, 5, 0)).toBe(m); // lens interior
    expect(hitTest([m], { x: 50, y: 50 }, measure, 5, 0)).toBe(m); // source interior
    expect(hitTest([m], { x: 1000, y: 1000 }, measure, 5, 0)).toBeNull();
  });
});

describe("hitTest topmost-first", () => {
  it("returns the last annotation in the list when overlapping", () => {
    const bottom = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const top = rect({ x: 0, y: 0 }, { x: 100, y: 100 }, 4);
    const list: Annotation[] = [bottom, top];
    const result = hitTest(list, { x: 0, y: 50 }, measure, 5, 0);
    expect(result).toBe(top);
  });

  it("empty list returns null", () => {
    expect(hitTest([], { x: 0, y: 0 }, measure, 5, 0)).toBeNull();
  });
});
