/**
 * Pure geometry for the magnifier/loupe annotation. Leaf module — imports
 * only types from `model.ts` and `bounds.ts`. Deliberately NOT allowed to
 * import `hittest.ts`/`resize.ts`/`crop.ts`/`canvas.ts` (see the
 * import-boundary note in docs/design/2026-08-01-magnifier-loupe.md):
 * `render.ts`, `hittest.ts`, `resize.ts` and `canvas.ts` all reach into this
 * module, so it must stay a dependency-free bottom layer, exactly like
 * `bounds.ts`/`rotate.ts`.
 *
 * Authority: `MagnifierAnnotation`'s lens (`at` + `radius` for a circle,
 * `at` + `width`/`height` for a rect, "cube mode" — D1/D2), `zoom` and `from`
 * are authoritative; the source region is DERIVED (a circle of radius
 * `radius / zoom`, or a `(width/zoom) x (height/zoom)` rect, centered on
 * `from`) — this module is where that derivation lives, so no other file
 * re-implements "where does the source region sit".
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
import type { CircleMagnifierAnnotation, MagnifierAnnotation, Point, SizeName } from "./model";
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
 * Smallest allowed DERIVED source half-extent for a RECT lens, CSS px
 * (Addendum G, 2026-08-08, request (1) — "the source must shrink much
 * further"). **NOT a fingertip floor** — unlike the circle's `minSource`,
 * that role moved entirely to the hit target (`hittest.ts`'s
 * `MAGNIFIER_SOURCE_MIN_HIT_HALF_PX`, `canvas.ts`'s `magnifierSourceMinHit`).
 * This is a LEGIBILITY floor only: the source marker band (`markerStroke`,
 * stroked CENTERED on the source rect's boundary) must not swallow the
 * frame it draws.
 *
 * **User-facing why.** Pre-Addendum-G, the rect's derived source
 * half-extent was floored at the circle's `minSource` (a fingertip size, 20
 * CSS px) on EACH axis via `clampRectZoom`'s ceiling — on a phone
 * screenshot at typical PWA `cropScale` that pinned the smallest source to
 * several lines of text and capped zoom under 2x, defeating the point of a
 * "magnify one line of text" tool. Splitting the floor into this legibility
 * value (drawn) plus a hit-target floor (grabbable) lets the DRAWN source
 * shrink to the size of the text it is meant to isolate while the DRAG
 * TARGET stays finger-sized regardless — see `hittest.ts`'s
 * `magnifierHitPart` for the other half of this split.
 *
 * **Accepted, documented regime (do not "fix"):** at the L stroke preset on
 * a canvas displayed near 1:1 (`markerStroke ~= 10.8` bitmap px vs. an
 * 8-bitmap-px minimum source SIDE at `scale = 1`), a fully-shrunk source
 * marker paints as a solid tick rather than a visible frame. This is
 * bounded, self-inflicted (the user picked the L stroke preset), and
 * recoverable (pick a thinner stroke, or view the image less zoomed-in) —
 * NOT a bug to special-case. Do NOT add a `strokeWidth`-dependent floor:
 * `magnifierSizeLimits` is a per-canvas function, not a per-annotation one,
 * and threading `strokeWidth` into it would break its single-owner shape
 * (every other call site would have to start passing a stroke width it
 * doesn't otherwise need).
 */
export const MIN_MAGNIFIER_RECT_SOURCE_CSS_PX = 4;

/**
 * The four size bounds a magnifier's lens radius / derived source
 * half-extent must satisfy, given the current canvas size and CSS-to-bitmap
 * scale (`cropScale()`). One owner: `defaultSourceRadius`,
 * `deriveLensSizeForSource`, `deriveRectLensSize`, `clampRectZoom`, and
 * every resize enforcement site in `resize.ts` all consult this instead of
 * re-deriving the bounds independently.
 *
 * ```
 * shortSide     = min(w, h)
 * maxLens       = MAGNIFIER_MAX_LENS_FRACTION * shortSide
 * minSource     = max( MIN_MAGNIFIER_SOURCE_RADIUS_PX,
 *                       min( MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX * scale,
 *                            MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide ) )
 * minRectSource = max( MIN_MAGNIFIER_SOURCE_RADIUS_PX,
 *                       min( MIN_MAGNIFIER_RECT_SOURCE_CSS_PX * scale,
 *                            MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide ) )
 * minLens       = min( MIN_MAGNIFIER_LENS_RADIUS_CSS_PX * scale, maxLens )
 * ```
 *
 * **`minSource` is circle-only from Addendum G (2026-08-08) onward** —
 * every rect reader switched to `minRectSource` instead (`clampRectZoom`,
 * `applyMagnifierBoxResize`'s `minPx`, `deriveRectLensSize`'s
 * `sourceHalfH` floor); `minSource` itself is untouched in formula, value
 * and meaning, still governing the circle exclusively. The two floors share
 * the same clamp SHAPE (absolute backstop outside, canvas-relative cap
 * inside) but different CSS-px inputs (`MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX`
 * = 20, a fingertip size, vs. `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX` = 4, a
 * legibility size — see that constant's own doc comment for the full
 * rationale).
 *
 * The canvas caps (`MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide`, `maxLens`)
 * keep a finger-sized floor from becoming absurd on a small image — the "hi
 * wins" clamp discipline applied to the limits themselves. Non-emptiness
 * (`minLens >= MIN_MAGNIFIER_ZOOM * minSource`, and separately
 * `minLens >= MIN_MAGNIFIER_ZOOM * minRectSource`) holds for every canvas
 * size and scale with the constants above; see magnifier.test.ts's
 * table-driven property tests (one per floor). The one exception is a
 * degenerate regime where the floor hits its own absolute
 * `MIN_MAGNIFIER_SOURCE_RADIUS_PX` backstop while `minLens` stays small and
 * scale-proportional (see magnifier.test.ts's dedicated backstop-exception
 * test) — but that regime requires `scale < 1`, and in the running app
 * `scale` (`canvas.ts`'s `cropScale()`) is never below 1 (`fitCanvasToStage`
 * clamps its own scale factor via `Math.min(1, …)` and never upscales), so
 * with `scale >= 1` the failure can only arise when the canvas's short side
 * is under `2.4 / MAGNIFIER_MAX_LENS_FRACTION ≈ 5.33` bitmap px (circle) or
 * proportionally smaller still for the rect's lower CSS-px input —
 * provably unreachable outside a pathological, near-zero-pixel document.
 */
export interface MagnifierSizeLimits {
  /** Smallest allowed DERIVED source radius (radius / zoom), bitmap px. Circle-only. */
  minSource: number;
  /** Smallest allowed DERIVED source half-extent per axis for a RECT lens, bitmap px (Addendum G). A legibility floor, not a fingertip floor — see `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX`. */
  minRectSource: number;
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
  const minRectSource = Math.max(
    MIN_MAGNIFIER_SOURCE_RADIUS_PX,
    Math.min(MIN_MAGNIFIER_RECT_SOURCE_CSS_PX * scale, MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide),
  );
  const minLens = Math.min(MIN_MAGNIFIER_LENS_RADIUS_CSS_PX * scale, maxLens);
  return { minSource, minRectSource, minLens, maxLens };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * The source circle's radius: `radius / zoom` — the one derived-geometry fact
 * this whole module exists to own. Circle-only (narrowed from
 * `MagnifierAnnotation` when the rect variant was added, D1/D2): a rect
 * magnifier has no single "radius", so its source region is derived
 * per-axis instead — see `magnifierSourceRect`'s rect branch below.
 */
export function magnifierSourceRadius(a: CircleMagnifierAnnotation): number {
  return a.radius / a.zoom;
}

/**
 * Bounding rect of the source region, centered on `a.from`: a `2 *
 * magnifierSourceRadius(a)` SQUARE for a circle magnifier, a
 * `(width/zoom) x (height/zoom)` rect for a rect magnifier (D2) — this is
 * the internal sample rect in both cases, never drawn as-is; see
 * `drawMagnifier`'s source marker for the honest, visible one.
 */
export function magnifierSourceRect(a: MagnifierAnnotation): Bounds {
  if (a.shape === "rect") {
    const w = a.width / a.zoom;
    const h = a.height / a.zoom;
    return { x: a.from.x - w / 2, y: a.from.y - h / 2, w, h };
  }
  const r = magnifierSourceRadius(a);
  return { x: a.from.x - r, y: a.from.y - r, w: 2 * r, h: 2 * r };
}

/** Bounding rect of the lens, centered on `a.at`: a `2 * a.radius` SQUARE for a circle magnifier, `a.width x a.height` for a rect magnifier (D2). */
export function magnifierLensRect(a: MagnifierAnnotation): Bounds {
  if (a.shape === "rect") {
    return { x: a.at.x - a.width / 2, y: a.at.y - a.height / 2, w: a.width, h: a.height };
  }
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

/** Center of a `Bounds` rect. */
function rectCenter(r: Bounds): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * One connector line, `[sourceCorner, lensCorner]` — a corner of
 * `sourceRect` joined straight to a corner of `lensRect`. Addendum G
 * (2026-08-08, request (2): "the connector must join CORNER TO CORNER");
 * WHICH pair of corners is chosen was replaced by Addendum H (2026-08-08,
 * "join the FACING edges") — see `magnifierRectConnectorLines`'s own doc
 * comment.
 */
export type MagnifierConnectorLine = [Point, Point];

/**
 * Rect twin of `connectorShape` (D3). Returns two straight corner-to-corner
 * segments that join the source and lens rects' FACING edges — the classic
 * zoom-callout look. Addendum H (2026-08-08, live iPhone feedback on
 * Addendum G's joint-convex-hull bridges): those bridges connect the pair's
 * SILHOUETTE, which for a lens wider than the source sitting below it draws
 * BOTH segments from the source's TOP corners to the lens's TOP corners,
 * grazing past the source's sides — a correct convex-hull answer and the
 * WRONG picture. The hull-bridge construction (`connectorBridge`, deleted)
 * is replaced outright, not patched — see `docs/design/2026-08-08-
 * magnifier-cube-mode.md`'s Addendum H for the full ruling.
 *
 * 1. **Suppression guard — unchanged from Addendum G §G4, byte-identical.**
 *    `null` when the PER-AXIS AABB rim gap (source half-extents inflated by
 *    `w1/2`, lens half-extents un-inflated) is under
 *    `MAGNIFIER_CONNECTOR_MIN_GAP_PX`. Nothing about the guard's own
 *    expression or justification changed here — only what happens once it
 *    has passed.
 * 2. **Dominant separation axis: whichever of `gx`/`gy` is LARGER, ties to
 *    x** (Addendum H §H1) — NOT `|Δx|` vs `|Δy|`, and NOT a normalized
 *    ratio against the half-extents. `hypot(gx, gy) >=
 *    MAGNIFIER_CONNECTOR_MIN_GAP_PX > 0` forces `max(gx, gy) > 0`, so THE
 *    DOMINANT AXIS IS ALWAYS STRICTLY SEPARATED — the exact precondition
 *    the no-ink-inside proof below needs. Choosing dominance by raw center
 *    displacement or by a normalized ratio can select an axis whose GAP is
 *    0 (two rects can be far apart center-to-center on an axis they still
 *    overlap edge-to-edge on) — that would destroy the proof, which is why
 *    gap, not displacement, decides.
 * 3. **Facing edges, same-side pairing.** If x dominates: the source's
 *    facing edge is its right edge when the lens is east of it, else its
 *    left edge; the lens's facing edge is the mirror choice. Both segments
 *    run from that one shared x-coordinate on the source side to the other
 *    shared x-coordinate on the lens side, paired TOP-to-TOP and
 *    BOTTOM-to-BOTTOM (never top-to-bottom — that would cross, see §H3
 *    below). If y dominates: symmetric, LEFT-to-LEFT and RIGHT-to-RIGHT on
 *    the shared facing horizontal edges. Return order is pinned:
 *    `[top pair, bottom pair]` when x dominates, `[left pair, right pair]`
 *    when y dominates.
 * 4. **Diagonal placements use the SAME rule — there is no third regime.**
 *    Both segments still attach to the facing edges of the larger-gap axis
 *    and lean sideways toward the lens; this reads correctly (the source
 *    box still visibly opens into the lens box) and stays crossing-free
 *    (§H3 below). A dedicated diagonal case was considered and rejected —
 *    it would add two more switching loci for no benefit.
 *
 * **Continuity.** The rule is continuous through every CARDINAL relation
 * (near due-south, `gx = 0 << gy`, so a few degrees of drag never flips the
 * answer) — the property Addendum E valued for the old tangent rule, and
 * the direction the auto-placement gesture actually parks the lens in
 * (`PLACEMENT_DIRS` tries E/W/S/N first). The one discontinuity is at the
 * EXACT diagonal locus `gx === gy`, where the answer flips between the two
 * facing-edge pairs — accepted and documented: a discrete rule must switch
 * somewhere, and this is the least-visited locus a user's drag passes
 * through. The tie (`gx === gy`) resolves to x (`gx >= gy`), deterministic.
 *
 * **The no-ink-inside invariant (B1), restated for the facing-edge
 * construction — this is the property that must never regress. These
 * segments are NOT supporting lines of both rects (Addendum G's hull-bridge
 * argument no longer applies); this is a stronger, simpler SLAB argument
 * instead. WLOG x dominates and the lens is east (`at.x > from.x`; the
 * other three cases are mirrors/transposes of this one):**
 *
 * `gx > 0` gives `at.x - from.x > sourceRect.w/2 + w1/2 + lensRect.w/2`,
 * hence `sourceRight = sourceRect.x + sourceRect.w < lensLeft =
 * lensRect.x`, STRICTLY, with `gx + w1/2` to spare. Both returned segments
 * have their source endpoint on the line `x = sourceRight` and their lens
 * endpoint on `x = lensLeft`, so every point of either segment satisfies
 * `sourceRight <= x <= lensLeft` — strictly for any point in a segment's
 * relative interior. The source rect lies entirely in `{x <= sourceRight}`
 * and the lens rect entirely in `{x >= lensLeft}`. Therefore EACH SEGMENT
 * MEETS EACH RECT ONLY AT ITS OWN ENDPOINT CORNER; its relative interior is
 * disjoint from both closed rects. This covers the case the guard permits
 * with only ONE positive gap (`gx > 0, gy = 0` — a taller lens due east
 * overlapping the source vertically): the segments live in the vertical
 * SLAB between the two facing edge lines, outside both rects regardless of
 * how much the rects overlap vertically — precisely why dominance is chosen
 * by GAP, not by center displacement (point 2 above).
 *
 * The painted-ink consequence is unchanged from Addendum G and still holds
 * verbatim: because each segment lies in a closed half-plane bounded by the
 * rect's own facing-edge line and touches it only at the endpoint, the
 * segment dilated by the stroke half-width intersects that rect only inside
 * the disc of radius `(markerStroke + 4)/2` centred on the endpoint corner.
 * The SOURCE marker's round-join disc there has exactly that radius; the
 * LENS border's has `(lensStroke + 4)/2 >= (markerStroke + 4)/2` since
 * `magnifierMarkerStroke(sw) = max(1, 0.9*sw) <= max(1, 1.5*sw) =
 * lensStroke` (asserted in magnifier.test.ts, §G7 T5 — unchanged by this
 * addendum). Both frames are painted AFTER the connector (draw order
 * unchanged), so no connector ink survives inside either interior —
 * independently of the lens-content pass (TASK-46 AC#6).
 *
 * **Crossing-freedom (§H3).** WLOG x dominant. Both segments span the SAME
 * x-interval `[sourceRight, lensLeft]` (non-degenerate) and are affine in
 * x: at any x, segment A (the top pair) sits at `yA(x) = lerp(sourceTop,
 * lensTop)` and segment B (the bottom pair) at `yB(x) = lerp(sourceBottom,
 * lensBottom)`. `sourceTop < sourceBottom` and `lensTop < lensBottom` for
 * any positive-height rect, and a convex combination of two strict
 * inequalities is itself strict, so `yA(x) < yB(x)` everywhere: the two
 * segments are DISJOINT, not merely non-crossing (degenerate zero-height
 * rects make them coincide — a harmless `Path2D` case, documented, not
 * branched). Symmetric for the y-dominant case.
 *
 * Precondition (like `connectorShape`): `w1 > 0` — a negative value would
 * make the guard's own `w1/2` inflation term negative, which is undefined
 * behavior the caller is responsible for not producing (same "the caller's
 * editorial choice" precedent `connectorShape`'s own `w1`/`w2` document).
 */
export function magnifierRectConnectorLines(
  sourceRect: Bounds,
  lensRect: Bounds,
  w1: number,
): [MagnifierConnectorLine, MagnifierConnectorLine] | null {
  const from = rectCenter(sourceRect);
  const at = rectCenter(lensRect);
  const gx = Math.max(0, Math.abs(at.x - from.x) - (sourceRect.w / 2 + w1 / 2 + lensRect.w / 2));
  const gy = Math.max(0, Math.abs(at.y - from.y) - (sourceRect.h / 2 + w1 / 2 + lensRect.h / 2));
  if (Math.hypot(gx, gy) < MAGNIFIER_CONNECTOR_MIN_GAP_PX) return null;

  if (gx >= gy) {
    // Horizontal separation dominates (gx > 0): the facing edges are VERTICAL.
    const east = at.x > from.x;
    const sx = east ? sourceRect.x + sourceRect.w : sourceRect.x; // source's facing edge
    const lx = east ? lensRect.x : lensRect.x + lensRect.w; // lens's facing edge
    const sy1 = sourceRect.y;
    const sy2 = sourceRect.y + sourceRect.h;
    const ly1 = lensRect.y;
    const ly2 = lensRect.y + lensRect.h;
    return [
      // [top pair, bottom pair] — pinned order
      [
        { x: sx, y: sy1 },
        { x: lx, y: ly1 },
      ],
      [
        { x: sx, y: sy2 },
        { x: lx, y: ly2 },
      ],
    ];
  }
  // Vertical separation dominates (gy > 0): the facing edges are HORIZONTAL.
  const south = at.y > from.y;
  const sy = south ? sourceRect.y + sourceRect.h : sourceRect.y;
  const ly = south ? lensRect.y : lensRect.y + lensRect.h;
  return [
    // [left pair, right pair] — pinned order
    [
      { x: sourceRect.x, y: sy },
      { x: lensRect.x, y: ly },
    ],
    [
      { x: sourceRect.x + sourceRect.w, y: sy },
      { x: lensRect.x + lensRect.w, y: ly },
    ],
  ];
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
 * Shared half-extents core (D5): component-wise clamp of a candidate center
 * into `[halfW, W-halfW] x [halfH, H-halfH]` so a `2*halfW x 2*halfH` box
 * stays fully on-canvas — an axis too narrow to hold it (`size - half <
 * half`) falls back to that axis's canvas-center coordinate. `clampLensCenter`
 * (circle, `halfW === halfH === radius`) and `clampRectLensCenter` (rect,
 * independent half-extents) both delegate here — one owner of "keep the box
 * fully on canvas", exactly like the pre-D5 `clampLensCenter` was for the
 * circle-only case. Module-private: callers reach it through one of the two
 * named wrappers below, matching those functions' own exported shapes.
 */
function clampCenterHalfExtents(center: Point, halfW: number, halfH: number, canvasSize: { w: number; h: number }): Point {
  const clampAxis = (v: number, half: number, size: number): number => {
    const hi = size - half;
    if (hi < half) return size / 2;
    return clamp(v, half, hi);
  };
  return { x: clampAxis(center.x, halfW, canvasSize.w), y: clampAxis(center.y, halfH, canvasSize.h) };
}

/**
 * Component-wise clamp of a candidate lens center into `[R, W-R] x [R, H-R]`
 * so the lens circle stays fully on-canvas — an axis too narrow to hold the
 * lens (`size - R < R`) falls back to that axis's canvas-center coordinate.
 * The one owner of "keep the lens fully on canvas": `placeLens`'s
 * clamp-fallback and `magnifierSlideUpdate`'s per-frame clamp (Addendum A,
 * 2026-08-01a) both call this instead of re-deriving the same clamp
 * independently. Thin wrapper over `clampCenterHalfExtents` (`halfW === halfH
 * === radius`, D5) — refactored around that shared core when the rect variant
 * was added, but this function's own signature/behavior is unchanged.
 */
export function clampLensCenter(center: Point, radius: number, canvasSize: { w: number; h: number }): Point {
  return clampCenterHalfExtents(center, radius, radius, canvasSize);
}

/**
 * Rect twin of `clampLensCenter` (D5): keeps a `2*halfW x 2*halfH` lens rect
 * fully on-canvas. `placeRectLens`'s clamp-fallback and
 * `magnifierRectSlideUpdate`'s per-frame clamp both call this — same one-owner
 * discipline `clampLensCenter` already documents for the circle case.
 */
export function clampRectLensCenter(center: Point, halfW: number, halfH: number, canvasSize: { w: number; h: number }): Point {
  return clampCenterHalfExtents(center, halfW, halfH, canvasSize);
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
 * Rect twin of `placeLens` (D4): auto-placed lens center for a source rect at
 * `from` with half-extents `sourceHalfW`/`sourceHalfH`, given the target lens
 * half-extents `lensHalfW`/`lensHalfH`. Same `PLACEMENT_DIRS`/candidate/
 * clamp-fallback/farthest-pick structure as `placeLens`, generalized from one
 * isotropic `dist` to a PER-AXIS `distX`/`distY` (`sourceHalf + gap +
 * lensHalf` on each axis) — a circle's `dist` is direction-independent, but
 * two axis-aligned rects need their own axis's half-extents to actually clear
 * each other by `gap`. For a direction with both components non-zero
 * (SE/SW/NE/NW), the resulting reach differs from the cardinal case per-axis
 * whenever the two axes' half-extents differ (the common case for a rect
 * lens), which is expected: an isotropic reach would either overshoot the
 * short axis or undershoot the long one. Never fails, same as `placeLens`.
 */
export function placeRectLens(
  from: Point,
  sourceHalfW: number,
  sourceHalfH: number,
  lensHalfW: number,
  lensHalfH: number,
  canvasSize: { w: number; h: number },
  gap: number,
): Point {
  const distX = sourceHalfW + gap + lensHalfW;
  const distY = sourceHalfH + gap + lensHalfH;
  const candidates = PLACEMENT_DIRS.map((dir) => ({ x: from.x + dir.x * distX, y: from.y + dir.y * distY }));

  for (const c of candidates) {
    if (c.x - lensHalfW >= 0 && c.x + lensHalfW <= canvasSize.w && c.y - lensHalfH >= 0 && c.y + lensHalfH <= canvasSize.h) {
      return c;
    }
  }

  const clamped = candidates.map((c) => clampRectLensCenter(c, lensHalfW, lensHalfH, canvasSize));

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

/** Clamp a candidate zoom to `[MIN_MAGNIFIER_ZOOM, min(MAX_MAGNIFIER_ZOOM, a.radius / limits.minSource)]` — the upper bound keeps the derived source circle from collapsing below the operability floor. `limits.minSource >= MIN_MAGNIFIER_SOURCE_RADIUS_PX > 0`, so there is no division hazard. Circle-only (narrowed alongside `magnifierSourceRadius`, D1/D2) — see `clampRectZoom` for the rect twin. */
export function clampZoom(z: number, a: CircleMagnifierAnnotation, limits: MagnifierSizeLimits): number {
  return clamp(z, MIN_MAGNIFIER_ZOOM, Math.min(MAX_MAGNIFIER_ZOOM, a.radius / limits.minSource));
}

// Default width:height aspect for a freshly-created rect ("cube mode") lens
// (D4) — wide, to fit a text line far better than a square would. 8:3 was
// chosen over the circle-derived square so `deriveRectLensSize`'s creation
// default reads as a text-line strip, not a small window.
export const MAGNIFIER_RECT_ASPECT = 8 / 3;

/**
 * Rect twin of `clampZoom`: clamp a candidate zoom so BOTH derived source
 * half-extents (`width/(2*zoom)`, `height/(2*zoom)`) stay `>=
 * limits.minRectSource` (Addendum G, 2026-08-08 — was `limits.minSource`
 * pre-Addendum-G; see `MagnifierSizeLimits`'s own doc comment for why the
 * rect path uses a separate, smaller, LEGIBILITY floor rather than the
 * circle's fingertip one) — `min(width, height)` is the binding axis, since
 * it derives the smaller source half-extent. `width`/`height` are the
 * LENS's full dimensions (the caller's current or candidate lens size, not
 * the derived source), mirroring `clampZoom`'s `a.radius` term but taking
 * the two axes directly rather than an annotation, since this is also
 * called during creation (`deriveRectLensSize`) before any annotation
 * exists.
 *
 * **Creation-only from Addendum I (2026-08-09) onward.** The `src-zoom`
 * grip's runtime clamp moved to `clampRectZoomForSource`, below — the grip
 * now holds the SOURCE fixed and solves for the LENS (`lens = source *
 * zoom`), so its unknown-at-resize-time quantity is the source, not the
 * lens, and this function's `width`/`height` (LENS dims) signature cannot
 * serve it. This function keeps its one remaining caller,
 * `deriveRectLensSize` step 8, where the lens dims ARE already known.
 */
export function clampRectZoom(z: number, width: number, height: number, limits: MagnifierSizeLimits): number {
  return clamp(z, MIN_MAGNIFIER_ZOOM, Math.min(MAX_MAGNIFIER_ZOOM, Math.min(width, height) / (2 * limits.minRectSource)));
}

/**
 * Rect twin of `clampZoom`, but for Addendum I's SOURCE-authoritative grip
 * (2026-08-09, §I5): clamp a candidate zoom so the LENS derived from a FIXED
 * source (`lensW = sourceW * z`, `lensH = sourceH * z`) stays within its own
 * per-axis bounds — `[2*limits.minLens, 2*MAGNIFIER_MAX_LENS_FRACTION*
 * canvasSize.{w,h}]` — while also respecting the global `[MIN_MAGNIFIER_ZOOM,
 * MAX_MAGNIFIER_ZOOM]` range. This is the grip's runtime clamp; `clampRectZoom`
 * (above) stays creation-only — see that function's own comment for why its
 * lens-dims signature can't serve the grip.
 *
 * "Hi wins" clamp discipline, same as `magnifierSizeLimits`/`clampRectZoom`:
 * the per-axis lens CAP (`hi`) is computed first from `MAX_MAGNIFIER_ZOOM`
 * and the two canvas-relative maxima; the FLOOR (`lo`) — from
 * `MIN_MAGNIFIER_ZOOM` and the `minLens`-relative per-axis minima — is then
 * itself capped at `hi` via `Math.min(lo, hi)`, so a degenerate tiny canvas's
 * cap always beats the lens-size floor rather than producing an inverted
 * `lo > hi` range.
 *
 * `Number.EPSILON` floors both source dimensions before dividing: a
 * zero-width or zero-height source (never actually produced by
 * `applyMagnifierBoxResize`'s own floor, but this function has no way to
 * enforce that on its own) cannot produce a NaN/Infinity zoom — it saturates
 * the per-axis cap instead, the same guard `clampRectZoom` relies on
 * `limits.minRectSource > 0` for.
 *
 * Weaker invariant than `clampRectZoom` on a degenerate CANVAS specifically
 * (`clampRectZoom` takes no `canvasSize` at all, so it is simply not exposed
 * to this): on a zero-size `canvasSize` (`w === 0` or `h === 0`), the
 * canvas-relative terms in `hi` collapse toward 0, and "hi wins" then
 * returns a value BELOW `MIN_MAGNIFIER_ZOOM` — not merely below
 * `MAX_MAGNIFIER_ZOOM` as the "hi wins" discipline elsewhere promises. Not
 * guarded further: `canvas.ts`'s canvas dimensions are never zero in the
 * running app (an image must load before a magnifier can be created or
 * resized at all), so this stays a theoretical edge case of the pure
 * function, not a reachable UI bug.
 */
export function clampRectZoomForSource(
  z: number,
  sourceW: number,
  sourceH: number,
  canvasSize: { w: number; h: number },
  limits: MagnifierSizeLimits,
): number {
  const sw = Math.max(sourceW, Number.EPSILON);
  const sh = Math.max(sourceH, Number.EPSILON);
  const hi = Math.min(
    MAX_MAGNIFIER_ZOOM,
    (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.w) / sw,
    (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / sh,
  );
  const lo = Math.max(MIN_MAGNIFIER_ZOOM, (2 * limits.minLens) / Math.min(sw, sh));
  return clamp(z, Math.min(lo, hi), hi); // "hi wins", same discipline as magnifierSizeLimits
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
 * Rect twin of `defaultSourceRadius` + `deriveLensSizeForSource`, composed
 * (D4, rewritten by Addendum D §D11 — 2026-08-08, reviewer nit N3): every
 * rect ("cube mode") creation gesture uses this as the SOLE determinant of
 * creation-time size/zoom for a given S/M/L preset, mirroring how the circle
 * path composes those same two functions at the single call site
 * (`canvas.ts`'s `magnifierGeometry`).
 *
 * **Why N3 changed this at all.** The pre-Addendum-D version floored
 * `sourceHalfH` at `limits.minSource` whenever `sourceHalfW /
 * MAGNIFIER_RECT_ASPECT` fell under it, which silently SQUARED UP the source
 * (and therefore the lens) on any canvas where the operability floor bites on
 * one axis — defeating the whole point of `MAGNIFIER_RECT_ASPECT` (a wide
 * default that reads as a text-line strip, not a small window). §D11's fix:
 * when the floor lifts `sourceHalfH`, WIDEN `sourceHalfW` to restore the 8:3
 * ratio instead of leaving the aspect lost — capped by the same panorama
 * guard `defaultSourceRadius` itself uses, so widening can never make the
 * source swallow the image. §D11 additionally makes the preset's ZOOM
 * inherit exactly what the circle path would have chosen for the same
 * S/M/L — i.e. cube mode never magnifies less than the circle does at the
 * same preset, even after the source is widened.
 *
 * **Addendum G (2026-08-08, request (1)):** step 2's floor switched from
 * `limits.minSource` (the circle's fingertip floor, 20 CSS px) to
 * `limits.minRectSource` (a legibility-only floor, 4 CSS px — see
 * `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX`'s own doc comment). The floor now
 * rarely bites at all (it takes a much smaller `baseHalfW` to trip), so
 * step 3's widening — and the squared-up-source failure mode it exists to
 * avoid — is correspondingly rarer too; the 8:3 default survives intact far
 * more often. Every other step is otherwise unchanged by Addendum G.
 *
 * 1. `baseHalfW = defaultSourceRadius(canvasSize, limits)` — UNCHANGED: the
 *    circle's own default source radius, reused verbatim as the rect
 *    source's HALF WIDTH before any widening.
 * 2. `sourceHalfH = max(baseHalfW / MAGNIFIER_RECT_ASPECT,
 *    limits.minRectSource)` — the aspect-derived half height, floored at
 *    the rect's own LEGIBILITY minimum (Addendum G; was `limits.minSource`
 *    pre-Addendum-G) so a very wide/short source still draws a visible frame.
 * 3. `sourceHalfW = max(baseHalfW, min(MAGNIFIER_RECT_ASPECT * sourceHalfH,
 *    MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide))` — NEW (N3): when step 2's
 *    floor LIFTED `sourceHalfH` above `baseHalfW / ASPECT`, this widens the
 *    half WIDTH back out so `sourceHalfW / sourceHalfH === ASPECT` again,
 *    instead of leaving the source squared up. Capped at
 *    `MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide` — the same panorama guard
 *    `defaultSourceRadius` applies to its own long-side term — so widening
 *    can never make the source rect approach the image's own short side.
 *    Identity (`sourceHalfW === baseHalfW`) whenever step 2's floor did not
 *    bite; on a canvas so small that `limits.minRectSource` itself sits on
 *    the absolute `MIN_MAGNIFIER_SOURCE_RADIUS_PX` backstop, the `min(...,
 *    SHORT_SIDE_CAP * shortSide)` term caps widening away entirely, leaving
 *    `sourceHalfW === baseHalfW` there too (a degenerate canvas keeps the
 *    pre-widening geometry, not a widened-but-still-tiny one).
 * 4. `{radius: baseLensHalfW, zoom: zoom0} = deriveLensSizeForSource(baseHalfW,
 *    size, canvasSize, limits)` — the preset's zoom comes from the
 *    UNWIDENED source (`baseHalfW`, not `sourceHalfW`), so `zoom0` is EXACTLY
 *    what the circle path would pick for this same S/M/L preset.
 * 5. `lensHalfW = baseLensHalfW * (sourceHalfW / baseHalfW)`, `lensHalfH =
 *    sourceHalfH * zoom0` — the width axis carries the same widening factor
 *    the source picked up in step 3, so lens aspect equals source aspect
 *    exactly; the height axis is the direct `zoom0` scaling of the
 *    (unfloored-again) source half-height from step 2.
 * 6. Both axes are shrunk by ONE shared factor `s = min(1, limits.maxLens /
 *    lensHalfW, (MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / lensHalfH)` if
 *    either per-axis cap would otherwise bind — a per-axis independent cap
 *    would skew the aspect the whole feature exists to preserve, so both caps
 *    are checked but only the tighter one (if any) scales, uniformly.
 * 7. Floors apply LAST, per axis, each capped at that axis's own maximum so
 *    the "hi wins" clamp discipline `magnifierSizeLimits` documents for its
 *    own bounds still holds even in the rare regime where a floor and a cap
 *    are both in play: `lensHalfW = max(lensHalfW, min(limits.minLens,
 *    limits.maxLens))`, `lensHalfH = max(lensHalfH, min(limits.minLens,
 *    MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h))`. A floor trip here is rare
 *    (step 6 already shrinks toward the caps, not away from the floors) and,
 *    when it happens on only one axis, the aspect IS lost — an accepted,
 *    documented outcome, not prevented, since a lens axis under `minPx` would
 *    be unusable regardless of aspect.
 * 8. `zoom` is re-clamped once via `clampRectZoom` against the FINAL
 *    `2*lensHalfW`/`2*lensHalfH` pair — the same "recompute once from the
 *    clamped value" discipline `deriveLensSizeForSource` itself documents.
 * 9. The returned `sourceHalfW`/`sourceHalfH` are `lensHalfW / zoom` and
 *    `lensHalfH / zoom` — the source half-extents the annotation will
 *    ACTUALLY have (`source === lens / zoom` is the one derived-geometry
 *    invariant this whole module exists to own, `magnifierSourceRect`'s own
 *    doc comment), computed from the FINAL, post-clamp `lensHalfW`/
 *    `lensHalfH`/`zoom` rather than the step 1-3 intermediates, which steps
 *    6-8 can have moved. `placeRectLens` (the only caller of these two
 *    fields, via `canvas.ts`'s `magnifierRectGeometry`) needs the actual
 *    post-clamp gap the annotation will place with, not a pre-clamp guess.
 *
 * Returns full lens `width`/`height` (`2 * lensHalfW`/`2 * lensHalfH`),
 * matching `RectMagnifierAnnotation`'s own fields — the caller never has to
 * double a half-extent itself.
 */
export function deriveRectLensSize(
  size: SizeName,
  canvasSize: { w: number; h: number },
  limits: MagnifierSizeLimits,
): { sourceHalfW: number; sourceHalfH: number; width: number; height: number; zoom: number } {
  const shortSide = Math.min(canvasSize.w, canvasSize.h);

  // 1. The circle's own default source radius, as the rect's half WIDTH
  //    before widening. Audit note (Addendum G, 2026-08-08): this is the one
  //    remaining place `limits.minSource` (the circle's fingertip floor, not
  //    the rect's own `minRectSource`) still influences a rect dimension —
  //    `defaultSourceRadius` floors its result at `limits.minSource`
  //    unconditionally, circle call sites and this one alike. Harmless in
  //    practice (the `MAGNIFIER_SOURCE_RADIUS_FRACTION * longSide` term wins
  //    over the floor in every checked canvas/scale combination — see
  //    `defaultSourceRadius`'s own tests), and the CREATED size stays freely
  //    shrinkable afterward via the resize handles (`minRectSource`-floored,
  //    per `applyMagnifierBoxResize`) regardless of where creation started —
  //    but Addendum G's own text does not mention this indirect influence,
  //    so it is recorded here rather than left implicit.
  const baseHalfW = defaultSourceRadius(canvasSize, limits);

  // 2. The aspect-derived half height, floored at the rect's own LEGIBILITY
  //    minimum (Addendum G) — not the circle's fingertip minSource.
  const sourceHalfH = Math.max(baseHalfW / MAGNIFIER_RECT_ASPECT, limits.minRectSource);

  // 3. N3: when step 2's floor lifted the half height, restore the aspect by
  //    WIDENING instead of squaring up, capped by the panorama guard.
  const sourceHalfW = Math.max(baseHalfW, Math.min(MAGNIFIER_RECT_ASPECT * sourceHalfH, MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide));

  // 4. The preset's zoom comes from the UNWIDENED source, so cube mode never
  //    magnifies less than the circle does for the same S/M/L.
  const { radius: baseLensHalfW, zoom: zoom0 } = deriveLensSizeForSource(baseHalfW, size, canvasSize, limits);

  // 5. Lens half-extents at that zoom; the width axis carries the widening
  //    factor, so lens aspect === source aspect exactly.
  let lensHalfW = baseLensHalfW * (sourceHalfW / baseHalfW);
  let lensHalfH = sourceHalfH * zoom0;

  // 6. Caps shrink BOTH axes by one factor, so a cap can never skew the aspect.
  const s = Math.min(1, limits.maxLens / lensHalfW, (MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / lensHalfH);
  if (s < 1) {
    lensHalfW *= s;
    lensHalfH *= s;
  }

  // 7. Floors last, per axis, never above that axis's own cap ("hi wins").
  lensHalfW = Math.max(lensHalfW, Math.min(limits.minLens, limits.maxLens));
  lensHalfH = Math.max(lensHalfH, Math.min(limits.minLens, MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h));

  // 8. One re-clamp of zoom against the FINAL width/height pair.
  const zoom = clampRectZoom(zoom0, 2 * lensHalfW, 2 * lensHalfH, limits);

  // 9. Source half-extents the annotation will ACTUALLY have, derived from
  //    the final post-clamp lens size and zoom, not the pre-clamp intermediates.
  return {
    sourceHalfW: lensHalfW / zoom,
    sourceHalfH: lensHalfH / zoom,
    width: 2 * lensHalfW,
    height: 2 * lensHalfH,
    zoom,
  };
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

/**
 * Rect twin of `magnifierSlideUpdate` (D4): same per-frame slide-to-aim
 * update, `frozen.half` (the lens's frozen HALF-extents, `{x: halfW, y:
 * halfH}` — the rect analog of the circle's scalar `frozen.radius`, captured
 * once at pointerdown, same "sizing cannot change mid-gesture" discipline) in
 * place of `frozen.radius`, and `clampRectLensCenter` in place of
 * `clampLensCenter`. See `magnifierSlideUpdate`'s doc comment for why `from`
 * is clamped here but not during a committed annotation's source-body drag —
 * identical rationale, not repeated.
 */
export function magnifierRectSlideUpdate(
  p: Point,
  frozen: { offset: Point; half: Point },
  canvasSize: { w: number; h: number },
): { from: Point; at: Point } {
  const from = clampPointToCanvas(p, canvasSize);
  const at = clampRectLensCenter(
    { x: from.x + frozen.offset.x, y: from.y + frozen.offset.y },
    frozen.half.x,
    frozen.half.y,
    canvasSize,
  );
  return { from, at };
}
