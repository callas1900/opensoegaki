# Magnifier — Addendum C: tapered connector

*Date: 2026-08-02 · Status: proposed, ready for implementation · Delta to `docs/design/2026-08-02-magnifier-connector-and-size-limits.md` (Addendum B), which this note partially overrides.*

## Problem

Addendum B replaced the two tangent segments with a single rim-to-rim line stroked at the *secondary marker weight* (`markerStroke = max(1, strokeWidth × MAGNIFIER_MARKER_STROKE_RATIO)`, i.e. `0.6 × strokeWidth`), explicitly rejecting a tapered connector as "more ink than the user asked for". Real-iPhone testing of the shipped result produced the opposite verdict: *「接続線を太めに、かつ拡大側に向かって太くなることはできますか？」* — the line reads too thin at phone scale, and the user wants it to **widen toward the lens** so the connector itself carries the direction of the relationship (this small circle → that big one). This is an explicit user decision and it overrides Addendum B's rejection of a taper. A stroked path cannot taper, so the connector stops being a stroked segment and becomes a **filled quadrilateral**. Everything else (guard, draw order, hit-testing, data model) stays put: pure `src/`, no Rust, no IPC, no new dependency, no stored-model change.

## Decision

### 1. Geometry — a flat-ended trapezoid, ends buried under the rims

`connectorShape(c1, r1, c2, r2, w1, w2)` returns the four corners of the trapezoid built on Addendum B's rim-to-rim axis. With `d = |c2 − c1|`, `u = (c2 − c1)/d`, `n = (−u.y, u.x)`, `p1 = c1 + r1·u`, `p2 = c2 − r2·u`:

```
[ p1 + n·w1/2 ,  p2 + n·w2/2 ,  p2 − n·w2/2 ,  p1 − n·w1/2 ]
```

— one traversal down one side, across the wide end, back the other side. Same `null` guard as today (`d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX`), unchanged in constant and meaning.

**Flat ends, not rounded.** Addendum B relied on both rims being stroked *over* the connector's ends; that property survives verbatim, and the arithmetic is worth recording because it is what makes flat ends safe:

- *Sag.* A flat end is the chord's tangent line at `p1`; the arc falls away from it by at most `(w/2)² / (2r)` — 0.12 px for the widest realistic end (`w2 = 6`) against the smallest realistic lens (`r2 = 28`), 0.08 px at the source end of the e2e fixture. Sub-pixel, and in any case inside the ring's own ink.
- *Coverage.* Each rim is stroked as a band of half-width `(markerStroke + 4)/2 ≥ 2.5 px` (source ring) and `(strokeWidth + 4)/2 ≥ 2.5 px` (lens border), centred on the rim. The connector's outline pass overshoots its own flat end by exactly **2 px** (see §3). `2 < 2.5` holds for *every* `strokeWidth`, because both bands are floored by the `+4` halo constant, not by the stroke weight. So the connector's end — colour and halo alike — is always painted over by the ring that owns that rim. No seam, no configuration-dependent exception.
- *Corners.* All four corners sit within `sqrt(r² + (w/2)²) − r ≲ 0.2 px` of their rim, i.e. inside the same bands. This is why the outline's **join style is immaterial** and `drawMagnifier` must **not** set `ctx.lineJoin`: every corner is hidden, so there is nothing to gain, and setting it would add a second piece of leaked context state next to the already-documented `lineCap` leak.

Rounded ends (arc caps matching rim curvature) would buy nothing measurable and cost arc math; rejected below.

### 2. Widths — each end matches the element it touches

| End | Width | Expression in `render.ts` |
| --- | --- | --- |
| Source (`p1`) | source-ring weight | `markerStroke` (already computed once, shared with step 2) |
| Lens (`p2`) | lens-border weight | `Math.max(markerStroke, a.strokeWidth)` |

At the M preset (`strokeWidth = 6`): `3.6 → 6.0` of colour, plus the 2 px halo each side, versus a uniform `3.6` before. The wide end is 1.67× today's line and the mid-segment ~1.33×, which is the "太めに" the user asked for, delivered as a rule rather than a taste number.

**Why the lens end is exactly `a.strokeWidth`, expressed as `a.strokeWidth` and not as a new `…_RATIO = 1.0` constant.** The wide end must equal *whatever step 4 actually strokes the lens border at*; a parallel constant would be a second owner of "the lens border weight" and could silently drift from step 4 — precisely the two-owner failure the project's own rules exist to prevent. Writing the same expression is the one-owner form.

**Why not heavier (e.g. `1.3 × strokeWidth`).** Immediately outside the lens border's band the wedge is `w2` wide, directly adjacent to a border of width `strokeWidth`. Equal widths read as the connector *growing out of* the border; a wider wedge reads as a collar/blob stuck onto it. `a.strokeWidth` is therefore the maximum weight compatible with the visual hierarchy, and it is a single expression to retune if the device check disagrees.

**`Math.max` is a monotonicity guarantee, not defensive noise.** `markerStroke` has a `max(1, …)` floor that `a.strokeWidth` does not, so at `strokeWidth < 1.67` the "narrow" end would be the wider one and the wedge would point backwards. Today's `STROKE_PRESETS` (`3/6/12`, times `docScale ≥ 1`) never reach there, but the taper's *direction* is the whole point of this addendum and must not depend on a preset table.

**Addendum B's hierarchy principle, revised (explicitly, not silently).** Addendum B: *"connector and ring are one visual system; the lens border must dominate, so the connector uses the secondary weight."* Revised: **the connector is a transition element — it takes the weight of whichever element it touches at each end.** The lens border still dominates: it is a closed ring at full weight, while the connector reaches full weight only at its tip and is thinner everywhere else. What changes is that the connector is no longer *part of* the marker layer; it is the linkage *between* the marker layer and the lens, and its taper states which of the two is the magnified one. `MAGNIFIER_MARKER_STROKE_RATIO`'s doc comment must be updated accordingly (it currently claims the ratio governs the connector; after this change it governs the source ring and the connector's *narrow end*, and `hittest.ts` keeps using it for the ring band only).

### 3. Two-pass outline — stroke the closed path at 4, then fill

```
stroke(path) with OUTLINE at lineWidth = 4      // 2 px outside, 2 px inside
fill(path)   with a.color                       // covers the inside half
```

Net result: a 2 px white halo outside the wedge — **bit-for-bit the same halo geometry the family already has**, since stroking a width-`X` line at `X + 4` also puts exactly 2 px of white beyond each edge. The `4` in the code is the same house halo constant, applied to a boundary instead of to a centreline; the implementer must say so in a comment, because a bare `lineWidth = 4` next to a file full of `+ 4` looks like a different number.

Anti-aliasing behaves as elsewhere in the family: at the boundary pixel the white stroke is fully covered and the colour fill lands at partial coverage, giving the same slightly-lightened edge every two-pass stroke in this renderer already produces.

Rejected alternative technique: computing an outset polygon and filling it in `OUTLINE` first. It needs real polygon-offsetting math (miter handling, degenerate cases on short wedges) to reproduce what `stroke()` already does exactly.

Draw order is unchanged: connector → source ring → clipped content → lens border. The connector is still painted first, i.e. under both rings, which is what §1's coverage argument depends on.

### 4. API shape — one exported owner

`connectorSegment` **loses its export**. Its trimming math survives as a module-private helper inside `magnifier.ts` (keeping the "why trimmed" rationale where the code is), and `connectorShape` is the only exported connector API. Keeping both exported would be two owners of one geometry with `render.ts` using only one of them — the situation the project deletes rather than documents.

```ts
/** The four corners of the tapered connector, in traversal order. */
export type ConnectorQuad = [Point, Point, Point, Point];

export function connectorShape(
  c1: Point, r1: number,   // source circle
  c2: Point, r2: number,   // lens circle
  w1: number, w2: number,  // full widths at the source end / lens end (> 0)
): ConnectorQuad | null;
```

`Segment` (`[Point, Point]`) has no other consumer in `src/` and is deleted with `connectorSegment`'s export. A fixed-arity tuple type is deliberate over `Point[]`: it lets `render.ts` destructure without length checks and makes "exactly four corners" a compile-time fact.

**Widths are parameters, not constants inside `magnifier.ts`.** `magnifier.ts` owns geometry and imports only `model.ts`/`bounds.ts`; stroke weights live in `render.ts` (which is where `MAGNIFIER_MARKER_STROKE_RATIO` and `a.strokeWidth` already are). Passing `w1`/`w2` in keeps the import boundary intact and keeps `connectorShape` a pure function of numbers. Precondition (documented, not clamped): `w1, w2 > 0`; the function does not enforce `w1 ≤ w2` — it is correct for any positive pair, and the taper direction is the caller's editorial choice.

### 5. Degenerate cases — guard unchanged

The guard leaves `length = d − r1 − r2 ≥ MAGNIFIER_CONNECTOR_MIN_GAP_PX = 2` px, while `w2` can reach 12 (L preset) or more with `docScale`. A 2 px-long, 12 px-wide trapezoid looks odd in the abstract, but:

- It is never self-intersecting. The two end edges are parallel (both ⟂ `u`), the two side edges connect corresponding endpoints on the same side of the axis, so the polygon is simple for *any* positive `w1`, `w2` and *any* `length > 0`. Self-intersection would require a negative width.
- It is never visible. The two rim bands facing each other across that gap cover `2.5 + 2.5 = 5 px ≥ 2 px` of it, so the whole stub — colour and halo — is painted over by the rings.

So `MAGNIFIER_CONNECTOR_MIN_GAP_PX` stays at 2 and Addendum B's decision *not* to widen the guard stands. Widening it would change a behaviour nobody complained about and perturb two existing tests plus AC wording.

### 6. Ripple

- **`hittest.ts` — unchanged.** The connector remains deliberately non-hit-testable; `MAGNIFIER_MARKER_STROKE_RATIO` still sizes the source-ring grab band only.
- **`bounds.ts` — unchanged.** The wedge lies within the convex hull of the two circles up to `(w2 − markerStroke)/2 ≈ 1.2 px`, i.e. inside the same ink envelope the stroked line already had; the selection box is the lens circle's bounding square only (the source is a satellite by design, see bounds.ts) and is unaffected. *(Corrected in review: an earlier draft of this note wrongly said "union of the two circle boxes".)*
- **`tests/e2e/magnifier.spec.ts` — probe survives, comment must be rewritten.** No new mirrored constants are needed (the spec mirrors `magnifier.ts` geometry constants; the widths live in `render.ts` and are not mirrored). The white-revert probe at `(95, 10)`, post-drag axis `(35.9, 33.0) → (55.9, 47.5)`, `strokeWidth = 6` (`docScale = 1` on the 120×90 fixture) ⇒ `w2 = 6`, wide-end corners `(54.1, 49.9)` and `(57.6, 45.1)`; nearest wedge ink to the probe is that second corner at **51.2 px**, minus the 2 px halo ⇒ **≈ 49 px of clearance**, versus ≈ 50 px against the old thin segment. The probe does not move; the comment must state the new numbers and the wedge (it currently describes a `≈54 px`-away centreline). Step 4's "drag perpendicular to the from→at line" rationale is unchanged and now slightly more load-bearing.
- **`docs/ARCHITECTURE.md`** — the "Connector: one rim-to-rim segment" paragraph and the `connectorSegment` mention in the derived-geometry list describe a stroked segment at the secondary weight; both must be rewritten, plus the design-note list and the earlier notes' cross-link headers.

### 7. Acceptance-criteria amendments (TASK-48, In Progress)

AC #1 and #2 describe the straight stroked segment and must be replaced:

> **#1** The connector is exactly one straight, tapered quadrilateral along the center-to-center line, with its two parallel end edges centered on each circle's rim, and is suppressed when the circles overlap or nearly touch (unchanged guard `d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX`).

> **#2** The connector widens toward the lens: its width is the source ring's marker weight at the source end and the lens border's full `strokeWidth` at the lens end, never inverted. It is painted in the house two-pass style (white `OUTLINE` stroke at `lineWidth = 4` on the closed quad path, then an `a.color` fill), under both rings, so both flat ends are covered by the rims' own stroke bands. `connectorTangents` and the exported `connectorSegment` are both deleted, with no fallback.

Proposed new AC, since this is a device-driven visual change and a code trace cannot verify it:

> **#8** On a real iPhone the connector reads as a wedge that clearly widens toward the lens, is noticeably heavier than the pre-Addendum-C line, and shows no seam or collar where it meets either circle.

ACs #3–#7 are untouched. Other Done tasks are unaffected: no signature outside `magnifier.ts`/`render.ts` changes, and the export path is shared with the live renderer, so export parity is automatic.

## Alternatives considered

- **Keep the stroked line, just raise its weight to `strokeWidth`.** Delivers 太め but not 拡大側に向かって太く — half the request, and it makes the connector exactly as heavy as the lens border along its whole length, which is the hierarchy problem Addendum B was right about.
- **Gradient stroke (`createLinearGradient`) from thin-looking to thick-looking colour.** A gradient changes colour, not geometry; a constant-width line with a colour ramp reads as a fading line, not a widening one, and the white halo cannot follow it.
- **Stacked segments of increasing width.** Visible stair-steps and n× the halo overdraw; a filled quad is strictly simpler.
- **Rounded ends (arc caps, or a quad drawn with round line caps).** The rim bands already cover the ends with ≥ 0.5 px of margin at every `strokeWidth`, so rounding is invisible work; it also complicates the unit tests' "end edges ⟂ axis" property.
- **Extending the wedge slightly *into* both circles to guarantee no seam.** Unnecessary given §1's arithmetic, and it would paint colour inside the unfilled source ring if the coverage argument ever failed — the opposite of Addendum B's "trimming is load-bearing" reasoning.
- **Wide end at `1.3 × strokeWidth` for extra punch.** Rejected: reads as a collar on the lens border (see §2). If the device check says the connector is still too thin, retune that one expression and re-verify — do not reach for it pre-emptively.
- **Arrowhead / leader-line connector.** Carried over from Addendum B: collides semantically with the arrow tool.
- **Keeping `connectorSegment` exported alongside `connectorShape`.** Two owners of one geometry with one consumer; the loser gets deleted, per the TASK-38 ruling.
- **Putting `w1`/`w2` ratio constants in `magnifier.ts`.** Breaks the geometry/style split and would create a second owner of the lens-border weight.

## IPC / API contract

**No IPC changes.** No Rust, no Tauri command, no capability, no dependency; `docs/ARCHITECTURE.md`'s "the magnifier/loupe … is a pure `src/` feature and introduces no IPC changes" stays true. Internal contract deltas:

| Surface | Before | After |
| --- | --- | --- |
| `magnifier.ts` | `export function connectorSegment(c1, r1, c2, r2): Segment \| null` | export **deleted**; math survives as a private helper |
| `magnifier.ts` | `export type Segment = [Point, Point]` | **deleted** (no other consumer) |
| `magnifier.ts` | — | `export type ConnectorQuad = [Point, Point, Point, Point]`; `export function connectorShape(c1, r1, c2, r2, w1, w2): ConnectorQuad \| null` |
| `render.ts` | `drawMagnifier` step 1 strokes a segment two-pass at `markerStroke + 4` / `markerStroke` | step 1 strokes the closed quad at `lineWidth = 4` in `OUTLINE`, then fills it in `a.color`; widths `markerStroke` and `Math.max(markerStroke, a.strokeWidth)` |
| `render.ts` | `MAGNIFIER_MARKER_STROKE_RATIO` doc comment: "governs the source ring **and** the connector" | governs the source ring and the connector's **narrow end**; `hittest.ts`'s use (ring band) unchanged |

Import boundary unchanged and still enforced: `exporter → render → {bounds, rotate, magnifier} → model`; `magnifier.ts` imports only `model.ts`/`bounds.ts` types.

## Implementation tasks

Hand to `implementer` in order; each step leaves the tree compiling. Run `pnpm check` and `pnpm test` after every task.

1. **Geometry** (`src/editor/magnifier.ts`): add `ConnectorQuad` and `connectorShape(c1, r1, c2, r2, w1, w2)` exactly as specified in §1/§4 — same guard, corners in the stated order. Demote `connectorSegment` to a private helper (or inline it) and delete its export together with the `Segment` type. Doc comments: keep Addendum B's trimming rationale; add the flat-end coverage argument (2 px outline overshoot vs. ≥ 2.5 px rim bands), the `w1, w2 > 0` precondition, the "does not enforce `w1 ≤ w2`" note, and the simple-polygon argument for short wedges. Update `MAGNIFIER_CONNECTOR_MIN_GAP_PX`'s comment, which names `connectorSegment`.
2. **Rendering** (`src/editor/render.ts`): in `drawMagnifier` step 1, call `connectorShape(a.from, sourceRadius, a.at, a.radius, markerStroke, Math.max(markerStroke, a.strokeWidth))`; build a `Path2D` with `moveTo`/three `lineTo`/`closePath`, `stroke` it in `OUTLINE` at `lineWidth = 4`, then `fill` it in `a.color`. Comment the `4` as the house halo constant applied to a boundary rather than a centreline, the `Math.max` as the taper-direction guarantee, and the deliberate absence of any `ctx.lineJoin` write (all four corners are hidden under the rim bands; do not add leaked state). Keep the unconditional `lineCap`, the shared `markerStroke`, the draw order and the existing step numbering. Update `MAGNIFIER_MARKER_STROKE_RATIO`'s doc comment per §2.
3. **Unit tests** (`src/editor/magnifier.test.ts`): replace the `connectorSegment` block with a `connectorShape` block. Properties: exactly 4 corners, all finite; both end-edge **midpoints** lie on their own rims (transfers the old endpoint test); the midpoint-to-midpoint direction is collinear with `c2 − c1` and has length `d − r1 − r2`; each end edge is ⟂ the axis (dot with `u` ≈ 0); `|corner0 − corner3| = w1` and `|corner1 − corner2| = w2`; corners 0 and 1 are on one side of the axis and 3, 2 on the other (taper direction / no crossing); all `null` cases carry over verbatim; one degenerate case at `gap = MIN_GAP + ε` with `w2 > length` still returns four finite corners with the side-consistency property intact.
4. **E2E** (`tests/e2e/magnifier.spec.ts`): rewrite the `(95, 10)` probe comment for the wedge — state `strokeWidth = 6`, `w2 = 6`, the wide-end corners `(54.1, 49.9)` / `(57.6, 45.1)`, the ≈ 51 px nearest-corner distance and the ≈ 49 px clearance after the 2 px halo — and confirm no mirrored constant changes are needed. Run `pnpm build:web && pnpm test:e2e`; do not sign off on a code trace.
5. **Docs** (`docs/ARCHITECTURE.md`): rewrite the connector paragraph (tapered quad, per-end weight rule, revised hierarchy statement, flat-end coverage arithmetic, unchanged guard) and the `connectorSegment` mention in the derived-geometry list; add this note to the design-note list and cross-link it from the headers of the three earlier magnifier notes.
6. **Task file** (`backlog/tasks/task-48 - …md`): replace AC #1 and #2 with the §7 text and append AC #8.
7. **Device check** (user-run, on iPhone): confirm AC #8 — visible taper, heavier than before, no seam or collar at either circle. If the connector still reads thin, the single retune point is the `w2` expression in `render.ts` step 2; anything above `a.strokeWidth` reopens the collar question in §2 and comes back to `architect`.

## §8 Amendment: extreme taper (2026-08-02)

*Follow-up user decision after seeing §1–§7 on the tunnel build: 「もっと極端に太くなるようにして下さい」. This overrides §2's ruling that `w2 = a.strokeWidth` is the maximum width compatible with the visual hierarchy, exactly as §2's own escape clause anticipated.*

### 8.1 The rule: the lens end is anchored to the lens radius, not to the stroke weight

```
w1 = markerStroke                                            (unchanged)
w2 = min( max( MAGNIFIER_CONNECTOR_FAN_RATIO × r2,           FAN_RATIO = 0.6   (render.ts)
               markerStroke, a.strokeWidth ),
          MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO × r2 )    MAX_RATIO = 1.0   (magnifier.ts)
```

House clamp semantics, `min(max(x, lo), hi)` — `hi` wins.

**Why `r2` and not `strokeWidth`.** The half-angle the wedge subtends at the lens center is `θ = asin((w2/2)/r2) = asin(FAN_RATIO/2)` — with `FAN_RATIO = 0.6`, a constant **17.46°** (a 35° mouth, ~10 % of the rim) at *every* lens size, document scale and display scale. A stroke-anchored width cannot do this: it makes the fan look wide on a small lens and like a pinstripe on a large one. An aperture is the right unit for a beam; a weight is not.

| Case | `r2` | `strokeWidth` | old `w2` (§2) | new `w2` | taper `w1 → w2` |
| --- | --- | --- | --- | --- | --- |
| e2e fixture | 28 | 6 | 6.0 | **16.8** | 3.6 → 16.8 (4.7×) |
| phone, min lens | 99 | ~27 | 27 | **59.4** | 16.2 → 59.4 (3.7×) |
| desktop, large lens | 648 | ~17 | 17 | **388.8** | 10.2 → 388.8 (38×) |

**`w1` stays `markerStroke`.** A near-point apex is what makes the shape read as *projecting outward from* the source; scaling `w1` with `r1` (e.g. `0.6 × r1` → 8.1 on the fixture) would halve the taper ratio and re-introduce the "two heavy ends" look the user is moving away from. The source end is therefore unchanged in every respect: same width, same flat (tangent) end, same sub-pixel sag, same ≥ 2.5 px rim-band coverage of the 2 px outline overshoot (§1). Nothing in §3 changes. The pre-existing edge case where a huge `strokeWidth` makes the apex wider than a backstop-sized source ring is unchanged from the approved build and is not addressed here.

### 8.2 The collar question is now moot; the wide end must become an arc

The §2 collar objection was about a band *slightly* wider than the lens border reading as an accidental lump. A 35° fan flush with the rim cannot be read as an accident: it is a beam, and the lens border still bounds the object. **Revised hierarchy statement:** the connector is aperture-anchored at the lens end and weight-anchored at the source end — it is the projection, not part of the marker layer.

But the flat end no longer hides. Sag between the tangent end and the rim is `r2·(1 − sqrt(1 − FAN_RATIO²/4)) = 0.0461 × r2` — 1.3 px on the fixture (still under the 5 px border band), **29 px on a 648 px desktop lens** (band 10.5 px). A scale-dependent gap is not acceptable, so:

**The wide end becomes an arc along the lens rim**, flush by construction at every size. `w2` keeps its meaning as the end *width*: the arc's two endpoints are `r2·sinθ = w2/2` off-axis, so their separation is exactly `w2`. Geometry, with `β = atan2(−u.y, −u.x)`:

```
θ         = asin( (w2/2) / r2 )                      // ≤ 30° by the MAX_RATIO cap
arc       = { center: c2, radius: r2,
              startAngle: β − θ, endAngle: β + θ, counterclockwise: false }
```

`β − θ` is the `+n` side and `β + θ` the `−n` side (increasing angle decreases the `n` component at `β`), so the traversal `s0 = p1 + n·w1/2 → arc → s1 = p1 − n·w1/2 → close` is consistent for every orientation.

Three properties fall out (the first two are asserted by unit tests; the third is a documented consequence): the arc lies *on* the rim, so its endpoints are the best possible case for the border band's coverage; the arc's axial extent is `d − r2·cosθ ≥ d − r2`, i.e. the arc endpoints retreat *toward the lens*, never backwards past `p1`; and the arc and the source end lie on or outside the rim, while the straight side edges can dip a few px inside it when the gap is near-minimal on a large lens — always under the lens border's own inner band and in any case overpainted by the lens content pass, so Addendum B's "never ink inside an empty lens" consequence survives. *(Corrected in review: an earlier draft claimed the whole wedge stays entirely outside the lens circle — an endpoint-only argument; the side edges can dip inside, e.g. ~2.5 px at r2 = 648 with a 12 px gap.)*

### 8.3 Halo: unchanged technique

Still `stroke(path)` in `OUTLINE` at `lineWidth = 4`, then `fill(path)` in `a.color`. `stroke()` follows an arc segment exactly as it follows a line, so the 2 px white band wraps the arc too. That band's inner 2 px lands just inside the lens rim, where the lens border's own white outline pass (half-width `(strokeWidth + 4)/2 ≥ 2.5 px`) covers it — the same constant-vs-constant argument as §1, size-independent. The two line/arc junctions sit exactly on the rim, buried under the border band, so `ctx.lineJoin` still must not be touched.

### 8.4 Degenerate cases

- **`MAX_RATIO = 1.0`** (`w2 ≤ r2`, `θ ≤ 30°`) is a *geometric domain* bound owned by `connectorShape`: it keeps `asin`'s argument ≤ 0.5, the arc well under a semicircle, and the shape simple even when the `strokeWidth` floor exceeds the fan term on a small lens with a heavy stroke. `FAN_RATIO = 0.6` is an *editorial* aperture owned by `render.ts`. Different owners, no duplication; neither is derivable from the other.
- **Degenerate `r2 ≤ 0`**: `hi = 0` wins, `w2 = 0`, `θ = 0` — the shape degrades to a triangle, no `NaN`, no `asin` domain error.
- **Short connectors** (gap just past the unchanged `MAGNIFIER_CONNECTOR_MIN_GAP_PX = 2`): a wide, ~2 px-long flare. It stays simple (parallel-ish ends, sides on opposite sides of the axis, arc endpoints never behind `p1`), the arc end is flush with the rim, and only the ≤ 2 px side edges are exposed. **Guard unchanged**, per Addendum B and §5.

### 8.5 Ripple

- **E2E probe `(95, 10)` survives — recomputed, not assumed.** Post-drag: `p2 = (55.87, 47.51)`, `u = (0.8081, 0.5891)`, `r2 = 28`, `w2 = 16.8`, `θ = 17.46°`. Arc endpoints `(51.97, 55.05)` and `(61.86, 41.48)`; the probe is on the `−n` side, so the nearest ink is the `(61.86, 41.48)` endpoint at **45.7 px**, minus the 2 px halo ⇒ **≈ 43.7 px clearance** (was ≈ 49 px). The nearest point of the lens rim itself is 70.9° from the arc's bisector — 53.5° outside the arc span — so the arc adds nothing closer. *(Corrected in review: an earlier draft called 70.9° the distance to the span.)* The post-undo `(78.5, 64)` white probe clears the restored wedge by ≈ 38 px. The probe does not move; the comment's numbers do.
- **`hittest.ts`, `bounds.ts`, exporter, IPC — unchanged.** The wedge still lies inside the two circles' convex hull.
- **TASK-48 AC #2**, second sentence, replace the width rule with: *"…its width is the source ring's marker weight at the source end and `MAGNIFIER_CONNECTOR_FAN_RATIO × lens radius` (floored by the stroke weights, capped at the lens radius) at the lens end, whose edge is an arc along the lens rim so it is flush with the border at any size."* **AC #8**: *"…reads as a beam/cone fanning out from the source to the lens, with no gap, seam or unpainted lune where it meets either circle, on both a phone-sized and a large desktop capture."*
- **`docs/ARCHITECTURE.md`** connector paragraph: replace the per-end *weight* rule with the aperture rule, state the constant 17.46° half-angle and why scale-invariance drove it, and note the arc end.

### 8.6 Implementation tasks (one round)

1. **`src/editor/magnifier.ts`** — replace `ConnectorQuad` with `ConnectorShape { source: [Point, Point]; lens: { center, radius, startAngle, endAngle, counterclockwise } }`; `connectorShape` saturates `w2` at `MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO (1.0) × r2` (new exported constant, documented as a geometric domain bound, hi-wins) and emits the arc per §8.2. Guard, `w1` handling and the source edge unchanged. Document why the arc end exists (scale-dependent sag) and the three invariants in §8.2.
2. **`src/editor/render.ts`** — add `MAGNIFIER_CONNECTOR_FAN_RATIO = 0.6` with the aperture rationale; `w2 = Math.max(MAGNIFIER_CONNECTOR_FAN_RATIO * a.radius, markerStroke, a.strokeWidth)` (the cap is applied downstream — say so in the comment); build the path as `moveTo(source[0])`, `arc(...)`, `lineTo(source[1])`, `closePath()`; keep stroke-at-4-then-fill, keep not setting `lineJoin`. Update the §2 weight comment, which now describes a superseded rule.
3. **`src/editor/magnifier.test.ts`** — rewrite the `connectorShape` block: arc endpoints lie on the lens rim; their separation equals `w2`; the arc's bisector direction is `−u`; `θ = asin(w2/2r2)`; `counterclockwise === false` and the `+n`/`−n` side assignment; saturation when `w2 > r2`; `w2 = 0` degenerate returns a finite triangle-like shape; source-edge properties and all `null` cases carry over unchanged.
4. **`tests/e2e/magnifier.spec.ts`** — rewrite the `(95, 10)` probe comment with §8.5's numbers (arc endpoints, 45.7 px, 43.7 px clearance); no mirrored-constant changes. Run `pnpm build:web && pnpm test:e2e`.
5. **Docs and task file** — `docs/ARCHITECTURE.md` connector paragraph per §8.5; amend TASK-48 AC #2 and #8.
6. **Device check** — confirm AC #8 on the phone build *and* on a large desktop capture (the arc end only matters at large `r2`). If it still is not extreme enough, `MAGNIFIER_CONNECTOR_FAN_RATIO` is the single knob; above ~1.0 the geometric cap starts biting and it comes back to `architect`.
