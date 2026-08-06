/**
 * Pure geometry for the magnifier/loupe annotation. Leaf module — imports
 * only types from `model.ts` and `bounds.ts`. Deliberately NOT allowed to
 * import `hittest.ts`/`resize.ts`/`crop.ts`/`canvas.ts` (see the
 * import-boundary note in docs/design/2026-08-01-magnifier-loupe.md):
 * `render.ts`, `hittest.ts`, `resize.ts` and `canvas.ts` all reach into this
 * module, so it must stay a dependency-free bottom layer, exactly like
 * `bounds.ts`/`rotate.ts`.
 *
 * Authority: `MagnifierAnnotation`'s lens (`at`, `radius`), `zoom` and `from`
 * are authoritative; the source region is DERIVED (a circle of radius
 * `radius / zoom` centered on `from`) — this module is where that derivation
 * lives, so no other file re-implements "where does the source circle sit".
 *
 * **Operability size limits (Addendum B, 2026-08-02) are display-scale
 * dependent, on purpose.** `magnifierSizeLimits`, below, takes a `scale`
 * (bitmap px per CSS px, `canvas.ts`'s `cropScale()`) because the minima are
 * finger-relative, not image-relative: the same annotation is "in range" in
 * a wide desktop window and "below range" once the same image is shown small
 * on a phone. That is intentional, not a bug — see `magnifierSizeLimits`'s
 * doc comment for the full rationale.
 *
 * **Clamps are creation/edit-time behaviour only — nothing here ever mutates
 * stored data.** Loading a document, opening it, or simply rendering it never
 * runs these clamps; an old loupe with a source ring below the current
 * minima renders and exports exactly as saved. The clamps only bite the next
 * time the user actually drags a corner or the `src-zoom` handle, at which
 * point the annotation snaps into range — the same "clamp only on edit"
 * behaviour every other tool already has. Do not be tempted to "fix" an
 * out-of-range magnifier at load/render time; that would be new,
 * unrequested, data-mutating behaviour.
 */
import type { MagnifierAnnotation, Point, SizeName } from "./model";
import { MAGNIFIER_LENS_FRACTION_PRESETS } from "./model";
import type { Bounds } from "./bounds";

export const MIN_MAGNIFIER_ZOOM = 1.2;
export const MAX_MAGNIFIER_ZOOM = 16;

// Absolute backstop, bitmap px — NOT the operability floor (see
// MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX/magnifierSizeLimits for that). This is
// the one place the usual "hi wins" clamp order is deliberately inverted
// (magnifierSizeLimits's outermost op on minSource is a `max`, not a `min`):
// clampZoom divides by minSource, so minSource > 0 must hold even for a
// degenerate/zero-sized canvas, independent of scale.
export const MIN_MAGNIFIER_SOURCE_RADIUS_PX = 2;

// Coefficient for the default creation-time source radius (Addendum A,
// 2026-08-01a): every magnifier creation gesture (tap or slide — there is no
// longer a separate case) uses `defaultSourceRadius`, below, which applies
// this against the canvas's LONG side (not short, as the pre-addendum tap
// fallback did) — see that function's doc comment for why. Renamed from
// `MAGNIFIER_TAP_SOURCE_RADIUS_FRACTION`.
export const MAGNIFIER_SOURCE_RADIUS_FRACTION = 0.06;

// Rim-to-rim gap (bitmap px) auto-placement tries to leave between the
// source circle and the lens circle.
export const MAGNIFIER_GAP_PX = 12;

// Below this rim-to-rim gap, connectorShape suppresses the connector
// (overlapping, touching, or near-touching circles). Editorial, not
// numerical (see connectorShape's doc comment) — the underlying trimmed axis
// degrades gracefully even without this guard, but a connector through an
// overlap communicates nothing the adjacency doesn't already say, and a stub
// shorter than the rim bands that cover it (Addendum C, 2026-08-02a) renders
// as a blob. Unchanged by Addendum C: widening this guard would perturb a
// behaviour nobody complained about (see that note's degenerate-case section).
export const MAGNIFIER_CONNECTOR_MIN_GAP_PX = 2;

// ---- Operability size limits (Addendum B, 2026-08-02) ----------------------
//
// Minima are CSS px (scale-compensated at the call site via `cropScale()`,
// see magnifierSizeLimits): a thing is "too small" relative to a fingertip,
// not relative to the picture it sits on. Maxima are canvas-relative
// (image-relative): a thing is "too big" relative to the image it would
// otherwise hide.

// Smallest allowed DERIVED source radius, in CSS px (16 -> 20, design note
// "magnifier UX brush-up", 2026-08-06). The old rationale — the source's two
// handles, `src-move` at `from` and `src-zoom` on the rim, separated by
// exactly the source radius, so 16 left ~6 CSS px of clear space between them
// — died with `src-move`: the whole source disc is now the drag surface
// (hittest.ts's `magnifierHitPart`), not a pair of point handles. New
// rationale: the `src-zoom` grip's 24 CSS px touch hit radius
// (`handleHitRadius()`) eats into the disc from the rim, so at
// `minSource = 20` the always-body-draggable lune (the part of the disc
// outside the grip's hit radius on every side) is `2*20 - 24 = 16` CSS px
// (vs. 8 at the old 16) — plenty of room to grab the body without triggering
// the grip. See magnifierSizeLimits' non-emptiness invariant for how this
// interacts with MIN_MAGNIFIER_LENS_RADIUS_CSS_PX.
export const MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX = 20;

// Smallest allowed lens radius, in CSS px. Diameter 56 CSS px: above Apple's
// ~44pt touch target, leaves a draggable body between the four 10px corner
// handles, and shows recognizable magnified content. Also
// >= MIN_MAGNIFIER_ZOOM * MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX (24, since the
// 2026-08-06 brush-up raised the source floor to 20), which keeps zoom 1.2
// reachable at the minimum lens size (see magnifierSizeLimits' non-emptiness
// invariant).
export const MIN_MAGNIFIER_LENS_RADIUS_CSS_PX = 28;

// Guard against an extreme panorama's short side making the operability
// floor absurd: the same coefficient defaultSourceRadius already uses for
// its own panorama guard, exported once so there is one owner of "0.15 *
// shortSide" for the source radius.
export const MAGNIFIER_SOURCE_SHORT_SIDE_CAP = 0.15;

// Largest allowed lens radius, as a fraction of the canvas's short side — the
// existing creation cap (deriveLensSizeForSource's targetRadius), now also
// the edit-time cap: a lens bigger than this would hide the image it
// annotates and push its own corner handles off-canvas, where they can be
// neither drawn nor grabbed.
export const MAGNIFIER_MAX_LENS_FRACTION = 0.45;

/**
 * The three size bounds a magnifier's lens radius / derived source radius
 * must satisfy, given the current canvas size and CSS-to-bitmap scale
 * (`cropScale()`). One owner: `defaultSourceRadius`, `deriveLensSizeForSource`,
 * and every resize enforcement site in `resize.ts` all consult this instead
 * of re-deriving the bounds independently.
 *
 * ```
 * shortSide = min(w, h)
 * maxLens   = MAGNIFIER_MAX_LENS_FRACTION * shortSide
 * minSource = max( MIN_MAGNIFIER_SOURCE_RADIUS_PX,
 *                   min( MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX * scale,
 *                        MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide ) )
 * minLens   = min( MIN_MAGNIFIER_LENS_RADIUS_CSS_PX * scale, maxLens )
 * ```
 *
 * The canvas caps (`MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide`, `maxLens`)
 * keep a finger-sized floor from becoming absurd on a small image — the "hi
 * wins" clamp discipline applied to the limits themselves. Non-emptiness
 * (`minLens >= MIN_MAGNIFIER_ZOOM * minSource`) holds for every canvas size
 * and scale with the constants above; see magnifier.test.ts's table-driven
 * property test. The one exception is a degenerate regime where `minSource`
 * hits the absolute `MIN_MAGNIFIER_SOURCE_RADIUS_PX` backstop while `minLens`
 * stays small and scale-proportional (see magnifier.test.ts's dedicated
 * backstop-exception test) — but that regime requires `scale < 1`, and in the
 * running app `scale` (`canvas.ts`'s `cropScale()`) is never below 1
 * (`fitCanvasToStage` clamps its own scale factor via `Math.min(1, …)` and
 * never upscales), so with `scale >= 1` the failure can only arise when the
 * canvas's short side is under `2.4 / MAGNIFIER_MAX_LENS_FRACTION ≈ 5.33`
 * bitmap px — provably unreachable outside a pathological, near-zero-pixel
 * document.
 */
export interface MagnifierSizeLimits {
  /** Smallest allowed DERIVED source radius (radius / zoom), bitmap px. */
  minSource: number;
  /** Smallest allowed lens radius, bitmap px. */
  minLens: number;
  /** Largest allowed lens radius, bitmap px. */
  maxLens: number;
}

/** See `MagnifierSizeLimits`'s doc comment for the formula and rationale. */
export function magnifierSizeLimits(canvasSize: { w: number; h: number }, scale: number): MagnifierSizeLimits {
  const shortSide = Math.min(canvasSize.w, canvasSize.h);
  const maxLens = MAGNIFIER_MAX_LENS_FRACTION * shortSide;
  const minSource = Math.max(
    MIN_MAGNIFIER_SOURCE_RADIUS_PX,
    Math.min(MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX * scale, MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide),
  );
  const minLens = Math.min(MIN_MAGNIFIER_LENS_RADIUS_CSS_PX * scale, maxLens);
  return { minSource, minLens, maxLens };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** The source circle's radius: `radius / zoom` — the one derived-geometry fact this whole module exists to own. */
export function magnifierSourceRadius(a: MagnifierAnnotation): number {
  return a.radius / a.zoom;
}

/** Bounding SQUARE of the source circle (side `2 * magnifierSourceRadius(a)`, centered on `a.from`). This is the internal sample rect — never drawn; see `drawMagnifier`'s source ring for the honest, visible marker. */
export function magnifierSourceRect(a: MagnifierAnnotation): Bounds {
  const r = magnifierSourceRadius(a);
  return { x: a.from.x - r, y: a.from.y - r, w: 2 * r, h: 2 * r };
}

/** Bounding SQUARE of the lens circle (side `2 * a.radius`, centered on `a.at`). */
export function magnifierLensRect(a: MagnifierAnnotation): Bounds {
  return { x: a.at.x - a.radius, y: a.at.y - a.radius, w: 2 * a.radius, h: 2 * a.radius };
}

/**
 * Intersect the sample square `src` with the bitmap rect `[0,0,bmpW,bmpH]`,
 * and map the clipped fraction proportionally onto `dest` (the lens's
 * bounding square) — so the destination shrinks by exactly the same fraction
 * the source was clipped by, keeping the two squares' shared uniform `zoom`
 * mapping intact under the circular clip. `null` when there is no overlap or
 * either resulting rect has zero area (including a zero-area `src`).
 */
export function clampSampleRect(src: Bounds, bmpW: number, bmpH: number, dest: Bounds): { src: Bounds; dest: Bounds } | null {
  if (src.w <= 0 || src.h <= 0) return null;
  const x0 = Math.max(src.x, 0);
  const y0 = Math.max(src.y, 0);
  const x1 = Math.min(src.x + src.w, bmpW);
  const y1 = Math.min(src.y + src.h, bmpH);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;

  const fx0 = (x0 - src.x) / src.w;
  const fy0 = (y0 - src.y) / src.h;
  const fw = w / src.w;
  const fh = h / src.h;
  return {
    src: { x: x0, y: y0, w, h },
    dest: {
      x: dest.x + fx0 * dest.w,
      y: dest.y + fy0 * dest.h,
      w: fw * dest.w,
      h: fh * dest.h,
    },
  };
}

/**
 * The source-end trim point and axis direction between circle 1 (`c1`,
 * `r1`, the source) and circle 2 (`c2`, `r2`, the lens): with
 * `d = |c2 - c1|` and `u = (c2 - c1) / d`, `p1 = c1 + r1*u` is where the
 * center-to-center line crosses the source rim. `null` when the circles
 * overlap, touch, or are closer than `MAGNIFIER_CONNECTOR_MIN_GAP_PX`
 * rim-to-rim (this single distance guard subsumes containment and
 * coincident centers — see the design note). The corresponding lens-end trim
 * point is not returned here — `connectorShape` expresses it as the arc's
 * own radius (`c2`/`r2` directly) rather than a pre-computed point.
 *
 * Trimming `p1` (rather than starting the connector at `c1` itself) is
 * load-bearing, not cosmetic: the source ring's interior is NOT filled, so
 * an untrimmed line would paint ink across the very detail being magnified.
 * The guard above is editorial, not numerical (see docs/design/2026-08-02-…
 * for the two-tangent formula this superseded, which needed a numerical
 * guard): *no connector when the two circles overlap or nearly touch*,
 * because a connector through an overlap communicates nothing the adjacency
 * doesn't already say. Module-private since Addendum C
 * (docs/design/2026-08-02a-…) — see that note for why this lost its export.
 */
function trimmedConnectorAxis(c1: Point, r1: number, c2: Point, r2: number): { p1: Point; u: Point } | null {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX) return null;

  const u = { x: dx / d, y: dy / d };
  return {
    p1: { x: c1.x + r1 * u.x, y: c1.y + r1 * u.y },
    u,
  };
}

// Geometric domain bound on the lens-end width, owned by THIS module: caps
// w2 at `MAX_LENS_WIDTH_RATIO * r2` so `asin`'s argument in connectorShape
// never exceeds 0.5 (theta <= 30 deg), keeping the lens-end arc well under a
// semicircle and the shape simple even when render.ts's editorial fan/stroke
// terms would otherwise ask for a wider mouth than the lens itself supports
// (e.g. a heavy strokeWidth on a small, backstop-sized lens). This is a
// DIFFERENT owner than render.ts's MAGNIFIER_CONNECTOR_FAN_RATIO (the
// editorial aperture the connector actually aims for) — one is "how wide do
// we want it", the other is "how wide can the geometry possibly allow";
// neither is derivable from the other, so both are named constants rather
// than one computing the other. House clamp semantics apply here too: this
// is the `hi` in `min(max(...), hi)`, so it always wins.
export const MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO = 1.0;

/**
 * The tapered connector's geometry: a straight pair of source-end points,
 * plus a lens-end ARC lying exactly on the lens rim, flush at every lens
 * size. Third construction for this shape — see docs/design/2026-08-01-
 * magnifier-loupe.md, 2026-08-02-magnifier-connector-and-size-limits.md and
 * 2026-08-02a-magnifier-tapered-connector.md for the two-tangent,
 * straight-segment and flat-quad predecessors this superseded.
 *
 * `source` is `[p1 + n*w1/2, p1 - n*w1/2]` (`p1`, `n` from
 * `trimmedConnectorAxis`) — a flat (tangent) end at the source rim. The
 * source ring is stroked as a band of half-width `w1/2 + 2` (`markerStroke +
 * 4`, halved), always `>= 2.5px` since `markerStroke >= 1`; the connector's
 * own two-pass outline overshoots this flat end by exactly 2px, which is
 * `< 2.5` (so `< w1/2 + 2`) for every `strokeWidth`, because both bands are
 * floored by the shared `+4` halo constant, not by the stroke weight itself.
 * This is also why `render.ts` deliberately never sets `ctx.lineJoin`: even
 * the sharpest inherited join (miter, whose tip at `lineWidth = 4` extends
 * `4 / (2*sin45deg) ~= 2.83px` beyond a right-angle corner — past the
 * `~2.5px` band floor on its own) stays covered at `source[0]`/`source[1]`,
 * because each corner's miter bisector points radially INWARD, toward the
 * source circle's own center, landing well inside its rim band rather than
 * beyond it. Worked example at the M stroke preset (`strokeWidth = 6`,
 * `markerStroke = max(1, 6 * MAGNIFIER_MARKER_STROKE_RATIO) = 5.4` since the
 * magnifier UX brush-up, 2026-08-06, retuned that ratio 0.6 -> 0.9 — was
 * `markerStroke = 3.6`, `hypot(11.5, 3.8) ~= 12.11px`, band
 * `[r1-3.8, r1+3.8] = [9.7, 17.3]` before), for a minimum-size source
 * (`r1 = 13.5`): `hypot(r1-2, w1/2+2) = hypot(11.5, 4.7) ~= 12.42px` from the
 * source center, inside its own `[r1-(w1/2+2), r1+(w1/2+2)] = [8.8, 18.2]`
 * band — still inside, with more margin than the pre-brush-up example, since
 * the band widened by exactly as much as the miter's own reach did (both
 * terms scale with `markerStroke`). The two LENS-end junctions
 * (where the straight side edges meet the arc) need a different argument,
 * since there is no corner there to have a miter at all: those junctions sit
 * exactly ON the lens rim by construction (the arc IS the rim), buried under
 * the lens border's own `>= 2.5px` band regardless of join style — strictly
 * stronger coverage than a corner miter's, not merely equivalent to it.
 *
 * `lens` is the arc `{center: c2, radius: r2, startAngle: beta - theta,
 * endAngle: beta + theta}`, where
 * `beta = atan2(-u.y, -u.x)` (the direction from the lens center back toward
 * the source) and `theta = asin(cappedW2 / (2 * r2))`, `cappedW2` being `w2`
 * saturated at `MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO * r2` (see that
 * constant's own doc comment). The chord subtended by `2*theta` at radius
 * `r2` has length `2 * r2 * sin(theta) = cappedW2` exactly, so `w2` keeps its
 * meaning as an end WIDTH even though the end is now curved. `beta - theta`
 * sits on the `+n` side and `beta + theta` on the `-n` side (increasing
 * angle decreases the `n` component at `beta`), matching `source[0]` (the
 * `+n` point) and `source[1]` (the `-n` point) respectively — the intended
 * traversal is `moveTo(source[0])`, then the arc (which the canvas draws a
 * connecting line into from `source[0]` and out of toward `source[1]`),
 * then `lineTo(source[1])`, then close. `startAngle` is always less than
 * `endAngle` here, sweeping the short way (`2*theta <= 60deg` given the
 * `MAX_LENS_WIDTH_RATIO` cap), which is why the arc is drawn with the
 * default (clockwise) sweep direction rather than an explicit
 * `counterclockwise: true`.
 *
 * Precondition, documented but not enforced or clamped: `w1, w2 > 0` (a
 * negative width would swap the source points / reverse the arc sweep into a
 * self-crossing shape). The function deliberately does NOT require
 * `w1 <= w2` — it is correct geometry for any positive pair, so which end is
 * wide is the caller's editorial choice (see `render.ts`'s `Math.max`, which
 * is what actually guarantees the taper direction).
 *
 * **Why an arc, not a flat end.** A flat end's sag away from the true rim is
 * `(w/2)^2 / (2r)`; because `w2` is anchored to `r2` itself (a fixed
 * aperture, `FAN_RATIO * r2`, not a bounded stroke weight), that sag becomes
 * `r2 * (1 - sqrt(1 - FAN_RATIO^2/4))` — a FIXED FRACTION of `r2`
 * (`~0.0461 * r2`): sub-pixel on a phone-sized lens, but ~29px on a large
 * desktop-capture lens (against a ~10.5px border band there) — a real,
 * scale-dependent gap. An arc has zero sag by construction at every size, so
 * only the lens end needs one; the source end's width stays stroke-anchored
 * and small, so its sag stays sub-pixel and it can stay flat.
 *
 * **Two invariants worth asserting, not just trusting, plus one consequence:**
 * 1. The arc lies exactly ON the rim (by construction — its points are
 *    `center + radius * (cos angle, sin angle)`), the best possible case for
 *    the lens border band's coverage. (Asserted in magnifier.test.ts.)
 * 2. The arc's axial extent is `d - r2*cos(theta) >= d - r2`: the arc
 *    endpoints sit no further back than the untapered rim point, i.e. they
 *    retreat TOWARD the lens center's own rim, never backward past `p1` —
 *    so the connector can only shrink toward the lens, never grow past the
 *    source. (Asserted in magnifier.test.ts.)
 * 3. The arc and the source end lie ON OR OUTSIDE the lens rim, but the
 *    straight SIDE EDGES can dip a few px INSIDE it when the gap is
 *    near-minimal on a large lens (outwardness at the arc endpoint roughly
 *    needs `gap > 0.048*r2 - 0.157*w1`; e.g. ~2.5px of dip at
 *    `r2=648`/`gap=12`, ~14px at `r2=1350`/`gap=2`). This does not reopen
 *    Addendum B's "never paint inside an empty lens" concern in practice:
 *    any such dip stays under the lens border's own INNER half of its band
 *    (the border is stroked centered ON the rim, so its inner half already
 *    covers a few px inside it) and is in any case overpainted by the lens
 *    content pass (step 3 of `drawMagnifier`, drawn after the connector).
 *
 * **Degenerate `r2 <= 0`.** `MAX_LENS_WIDTH_RATIO * r2 <= 0 < w2`, so the cap
 * (`hi`) wins and the effective lens-end width is 0; `theta` is set to `0`
 * directly (guarded, not computed via `asin(.../ (2 * r2))`, which would be
 * `0/0` = `NaN` at `r2 = 0`) so `startAngle === endAngle === beta` — the
 * "arc" collapses to the single point `c2 + r2*(cos beta, sin beta)`
 * (`= c2` when `r2 = 0`), and the whole shape degrades to a triangle
 * (`source[0]`, that point, `source[1]`) with no `NaN` and no `asin` domain
 * error.
 */
export interface ConnectorShape {
  source: [Point, Point];
  lens: { center: Point; radius: number; startAngle: number; endAngle: number };
}

export function connectorShape(c1: Point, r1: number, c2: Point, r2: number, w1: number, w2: number): ConnectorShape | null {
  const axis = trimmedConnectorAxis(c1, r1, c2, r2);
  if (!axis) return null;

  const { p1, u } = axis;
  const n = { x: -u.y, y: u.x };
  const cappedW2 = Math.min(w2, MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO * r2);
  const theta = r2 > 0 ? Math.asin(cappedW2 / (2 * r2)) : 0;
  const beta = Math.atan2(-u.y, -u.x);

  return {
    source: [
      { x: p1.x + (n.x * w1) / 2, y: p1.y + (n.y * w1) / 2 },
      { x: p1.x - (n.x * w1) / 2, y: p1.y - (n.y * w1) / 2 },
    ],
    // startAngle < endAngle always (2*theta <= 60deg via MAX_LENS_WIDTH_RATIO),
    // swept the short way — Path2D.arc's counterclockwise param defaults to
    // false, which is exactly what that sweep direction needs.
    lens: { center: c2, radius: r2, startAngle: beta - theta, endAngle: beta + theta },
  };
}

// Auto-placement candidate directions, in the fixed order the design note
// requires: cardinals before diagonals (a side-by-side loupe reads more
// clearly than a diagonal one), and within each group E/W/S/N then
// SE/SW/NE/NW so the result is predictable rather than "cleverest".
const PLACEMENT_DIRS: Point[] = [
  { x: 1, y: 0 }, // E
  { x: -1, y: 0 }, // W
  { x: 0, y: 1 }, // S
  { x: 0, y: -1 }, // N
  { x: Math.SQRT1_2, y: Math.SQRT1_2 }, // SE
  { x: -Math.SQRT1_2, y: Math.SQRT1_2 }, // SW
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, // NE
  { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }, // NW
];

/**
 * Component-wise clamp of a candidate lens center into `[R, W-R] x [R, H-R]`
 * so the lens circle stays fully on-canvas — an axis too narrow to hold the
 * lens (`size - R < R`) falls back to that axis's canvas-center coordinate.
 * The one owner of "keep the lens fully on canvas": `placeLens`'s
 * clamp-fallback and `magnifierSlideUpdate`'s per-frame clamp (Addendum A,
 * 2026-08-01a) both call this instead of re-deriving the same clamp
 * independently.
 */
export function clampLensCenter(center: Point, radius: number, canvasSize: { w: number; h: number }): Point {
  const clampAxis = (v: number, size: number): number => {
    const hi = size - radius;
    if (hi < radius) return size / 2;
    return clamp(v, radius, hi);
  };
  return { x: clampAxis(center.x, canvasSize.w), y: clampAxis(center.y, canvasSize.h) };
}

/**
 * Auto-placed lens center for a source at `from` with radius `sourceRadius`,
 * given the target `lensRadius`. Candidates sit at
 * `from + dir * (sourceRadius + gap + lensRadius)` for each `dir` in
 * `PLACEMENT_DIRS`; the first candidate whose lens circle lies fully inside
 * `canvasSize` wins. If none fits, every candidate is clamped on-canvas via
 * `clampLensCenter`, and the clamped candidate farthest from `from` (least
 * overlap with the source) is returned. Never fails — overlap between lens
 * and source is legal, nothing is refused.
 */
export function placeLens(from: Point, sourceRadius: number, lensRadius: number, canvasSize: { w: number; h: number }, gap: number): Point {
  const dist = sourceRadius + gap + lensRadius;
  const candidates = PLACEMENT_DIRS.map((dir) => ({ x: from.x + dir.x * dist, y: from.y + dir.y * dist }));
  const R = lensRadius;

  for (const c of candidates) {
    if (c.x - R >= 0 && c.x + R <= canvasSize.w && c.y - R >= 0 && c.y + R <= canvasSize.h) {
      return c;
    }
  }

  const clamped = candidates.map((c) => clampLensCenter(c, R, canvasSize));

  let best = clamped[0];
  let bestDist = Math.hypot(best.x - from.x, best.y - from.y);
  for (let i = 1; i < clamped.length; i++) {
    const dCand = Math.hypot(clamped[i].x - from.x, clamped[i].y - from.y);
    if (dCand > bestDist) {
      bestDist = dCand;
      best = clamped[i];
    }
  }
  return best;
}

/**
 * Derive `{radius, zoom}` for a freshly-drawn source circle of `sourceRadius`
 * at size preset `size`, per the design note's 4-step derivation:
 *
 * 1. `targetRadius = min(PRESET[size] * longSide / 2, limits.maxLens)`.
 * 2. `zoom = clamp(targetRadius / sourceRadius, MIN_MAGNIFIER_ZOOM, MAX_MAGNIFIER_ZOOM)`.
 * 3. `radius = sourceRadius * zoom`.
 * 4. `radius` is clamped to `[limits.minLens, limits.maxLens]`; if that
 *    clamp changed the value, `zoom` is re-derived ONCE from the clamped
 *    radius (the discipline `applyTextResize` already documents: "the
 *    effective scale is recomputed from the clamped value").
 *
 * Named `...SizeForSource`, not `...LensForSource`: this derives the lens's
 * SIZE only. Placement is a separate concern owned by `placeLens` — a caller
 * building the final annotation composes both calls (see canvas.ts's
 * `magnifierGeometry`). No `from`/center parameter: nothing here depends on
 * where the source sits, only on its radius.
 *
 * `canvasSize` is still needed (for the long-side preset term in step 1)
 * even though `limits` is also derived from `canvasSize` at the call site —
 * redundant but honest, per the design note, rather than re-deriving
 * long/short side from `limits` (which doesn't carry them).
 */
export function deriveLensSizeForSource(
  sourceRadius: number,
  size: SizeName,
  canvasSize: { w: number; h: number },
  limits: MagnifierSizeLimits,
): { radius: number; zoom: number } {
  const longSide = Math.max(canvasSize.w, canvasSize.h);

  const targetRadius = Math.min((MAGNIFIER_LENS_FRACTION_PRESETS[size] * longSide) / 2, limits.maxLens);
  let zoom = clamp(targetRadius / sourceRadius, MIN_MAGNIFIER_ZOOM, MAX_MAGNIFIER_ZOOM);
  let radius = sourceRadius * zoom;

  const clampedRadius = clamp(radius, limits.minLens, limits.maxLens);
  if (clampedRadius !== radius) {
    radius = clampedRadius;
    zoom = clamp(radius / sourceRadius, MIN_MAGNIFIER_ZOOM, MAX_MAGNIFIER_ZOOM);
  }
  return { radius, zoom };
}

/** Clamp a candidate zoom to `[MIN_MAGNIFIER_ZOOM, min(MAX_MAGNIFIER_ZOOM, a.radius / limits.minSource)]` — the upper bound keeps the derived source circle from collapsing below the operability floor. `limits.minSource >= MIN_MAGNIFIER_SOURCE_RADIUS_PX > 0`, so there is no division hazard. */
export function clampZoom(z: number, a: MagnifierAnnotation, limits: MagnifierSizeLimits): number {
  return clamp(z, MIN_MAGNIFIER_ZOOM, Math.min(MAX_MAGNIFIER_ZOOM, a.radius / limits.minSource));
}

/**
 * Default source radius for magnifier creation (Addendum A, 2026-08-01a):
 * every creation gesture — tap or slide, there is no longer a separate case
 * — uses this, so it is now the SOLE determinant of creation-time zoom for a
 * given S/M/L preset.
 *
 * Long-side-based, not short-side: `deriveLensSizeForSource`'s
 * `targetRadius` is itself long-side-driven for any aspect ratio up to
 * 2.5:1 (see its `limits.maxLens` cap), so a long-side-based default here
 * makes the creation zoom for a given preset CONSTANT across aspect ratios
 * (~1.8x/2.5x/3.3x for S/M/L) instead of swinging with the image's aspect
 * ratio the way a short-side-based default did (3.3x-5.4x for the same "M"
 * across a 4:3 photo vs. a phone screenshot). The
 * `MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide` term is a guard for extreme
 * panoramas beyond that 2.5:1 point, where a long-side-derived source circle
 * would be nearly as tall as the image; past it,
 * `deriveLensSizeForSource`'s own cap and two-pass re-derivation take over
 * unchanged.
 *
 * `limits` (Addendum B, 2026-08-02) supplies the operability floor: the
 * floor lives INSIDE this function, as the outer `max`, so `canvas.ts`
 * cannot forget to apply it. The result never exceeds
 * `MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide` because `limits.minSource`
 * is itself capped there (see `magnifierSizeLimits`).
 */
export function defaultSourceRadius(canvasSize: { w: number; h: number }, limits: MagnifierSizeLimits): number {
  const longSide = Math.max(canvasSize.w, canvasSize.h);
  const shortSide = Math.min(canvasSize.w, canvasSize.h);
  return Math.max(Math.min(MAGNIFIER_SOURCE_RADIUS_FRACTION * longSide, MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide), limits.minSource);
}

/**
 * Component-wise clamp of a point into `[0, W] x [0, H]` — keeps a point
 * from landing outside the bitmap entirely. Used by `magnifierSlideUpdate`
 * (below) to clamp the SOURCE center during creation; deliberately NOT used
 * for the source-body drag on an already-committed magnifier (canvas.ts's
 * `onMove`, via `translateAnnotation(a, dx, dy, "source")` — see that call
 * site's own comment) or for any other annotation's move/drag, which stay
 * unclamped by this app's general "never clamp annotations" policy.
 */
export function clampPointToCanvas(p: Point, canvasSize: { w: number; h: number }): Point {
  return {
    x: clamp(p.x, 0, canvasSize.w),
    y: clamp(p.y, 0, canvasSize.h),
  };
}

/**
 * Per-frame update for the slide-to-aim creation gesture (Addendum A,
 * 2026-08-01a): the source follows the pointer, CLAMPED onto the bitmap
 * (`clampPointToCanvas` — review round 2 ruling, see below), and the lens
 * rides along at the FROZEN `offset` (captured once at pointerdown by the
 * caller) from that clamped source, itself clamped back on-canvas
 * (`clampLensCenter`) if the frozen offset would otherwise push it off the
 * edge. `radius`/`zoom` are deliberately absent from the return type, not
 * merely left unchanged by convention — they cannot change during a slide by
 * construction, since `frozen` (captured once, reused every frame) is the
 * only place this function reads them from.
 *
 * Why `from` is clamped here (review round 2 ruling), when this app's
 * documented policy is "never clamp annotations" (crop/move translate
 * off-canvas freely): that policy is data-preservation for an EXISTING
 * annotation — nothing is lost by letting a committed shape sit partly
 * off-canvas, and clamping it would destroy the user's own positioning. A
 * *creation* gesture is different: its whole job is to produce a visible,
 * usable loupe, and a source planted fully off-bitmap samples nothing —
 * `clampSampleRect` returns `null` and the lens renders provably empty, a
 * dead result the user cannot recover from except by starting over. Clamping
 * `from` during the slide keeps a corner/edge framing reachable (a source
 * near the bitmap edge still overlaps it and samples the in-bounds slice via
 * `clampSampleRect`, exactly as crop's partial-overlap case already does)
 * while ruling out the fully-empty dead end. This does NOT reopen the
 * "never clamp annotations" question for the general case: once committed,
 * the source-body drag (canvas.ts's `onMove`, hit-tested by hittest.ts's
 * `magnifierHitPart` and applied via `translateAnnotation(a, dx, dy,
 * "source")`) sets `from` to track the pointer UNCLAMPED, deliberately —
 * that is a user-steered edit of an existing, undoable annotation, not a
 * creation gesture, so the general policy applies there unchanged. If that
 * ever needs to change, reuse `clampPointToCanvas` rather than re-deriving
 * the same clamp.
 */
export function magnifierSlideUpdate(
  p: Point,
  frozen: { offset: Point; radius: number; zoom: number },
  canvasSize: { w: number; h: number },
): { from: Point; at: Point } {
  const from = clampPointToCanvas(p, canvasSize);
  const at = clampLensCenter({ x: from.x + frozen.offset.x, y: from.y + frozen.offset.y }, frozen.radius, canvasSize);
  return { from, at };
}
