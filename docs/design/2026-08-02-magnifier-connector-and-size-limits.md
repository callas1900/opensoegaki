# Magnifier — Addendum B: single-line connector and operability-based size limits

Partially overridden by Addendum C: [./2026-08-02a-magnifier-tapered-connector.md](./2026-08-02a-magnifier-tapered-connector.md) — connector widened and tapered toward the lens after real-iPhone feedback (the operability size limits below are unaffected).

*Date: 2026-08-02 · Status: proposed, ready for implementation · Delta to `docs/design/2026-08-01-magnifier-loupe.md` and Addendum A (`docs/design/2026-08-01a-magnifier-creation-revision.md`).*

## Problem

Real-iPhone testing of the shipped magnifier produced two pieces of feedback. (1) *"二本の線が二つの丸を繋いでいますが、コレを一本の線にして"* — the two external tangent segments that link the source circle to the lens read as a busy "cone" at phone scale; the user wants a single line. (2) *"円を小さくしすぎると再度編集がしにくくなるので、円の最大最小を操作可能範囲内で制限して下さい"* — the current floors (`MIN_MAGNIFIER_RADIUS = 12` bitmap px for the lens, `MIN_MAGNIFIER_SOURCE_RADIUS_PX = 2` for the derived source) are *sampling* floors, not *operability* floors: a source circle at or near 2 bitmap px is smaller than its own two handles, so `src-move` and `src-zoom` collapse onto each other and the loupe becomes practically uneditable — and on a large photo shown scaled-down on a phone even a 12–24 bitmap-px circle is 1–3 CSS px on screen. Both changes are pure `src/`: no Rust, no IPC, no new dependency, no change to the stored data model (`{at, radius, zoom, from}` with the source radius still derived as `radius / zoom`).

## Decision

### Part 1 — the connector becomes one rim-to-rim segment

**Geometry.** Replace `connectorTangents` with

```ts
export function connectorSegment(c1: Point, r1: number, c2: Point, r2: number): Segment | null;
```

returning the **center-to-center segment trimmed to each rim**: with `d = |c2 − c1|` and `u = (c2 − c1)/d`, the segment is `[ c1 + r1·u , c2 − r2·u ]`. This is confirmed as the right choice, for three concrete reasons rather than aesthetics:

- It is the only single line that is *symmetric* with respect to both circles — any of the two former tangents kept alone reads as a drawing error (the eye expects its partner).
- Because it is collinear with the centers, it points at the lens center, which is exactly the pixel that maps to `from` under the loupe's uniform sampling. The line therefore states the annotation's semantic claim ("this disc is that spot") in the most literal possible way.
- Trimming (rather than drawing the full center-to-center line) is load-bearing, not cosmetic: the source ring's interior is **not** filled, so an untrimmed line would paint ink across the very detail being magnified; and the lens interior is only covered when `background !== null` (step 3 of `drawMagnifier` is skipped for a null background), so an untrimmed line would also become visible inside an empty lens. Trimming makes the connector correct independently of the other passes.

The existing draw order stays: connector first, then source ring, then clipped content, then lens border. Both rims are stroked **over** the connector's ends, so the round caps tuck under the rings and the joints stay clean — the same property the tangent pair relied on.

**Guard — unchanged.** `d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX` ⇒ `null`. Note that the single-line construction no longer *needs* the guard mathematically (the tangent formula required `|r1 − r2| < d` for the `sqrt`; a rim-to-rim segment degrades gracefully), but the guard's meaning is editorial, not numerical: *no connector when the two circles overlap or nearly touch*, because a connector through an overlap communicates nothing that the adjacency does not already say, and a stub shorter than the stroke's own round caps renders as a blob. Keeping the same constant also keeps the corresponding tests and AC wording intact.

**Stroke weight — drop to the secondary weight.** The connector is stroked in the house two-pass style (`OUTLINE` first, then `a.color`) but at the **source ring's weight**, `max(1, a.strokeWidth × MAGNIFIER_MARKER_STROKE_RATIO)` (outline pass at `that + 4`), not at the full `strokeWidth`. Rationale: two tangents at `strokeWidth` carried the linkage as a *pair*; a single line at full weight would be as heavy as the lens border, which is the element that must dominate. The ring and the connector are one visual system — the "marker" layer that annotates the background — and the lens border is the object. Matching their weights also makes the joint where the connector meets the ring visually continuous.

Consequently `MAGNIFIER_SOURCE_STROKE_RATIO` (declared in `render.ts`, imported by `hittest.ts` for the ring's grab band) is **renamed `MAGNIFIER_MARKER_STROKE_RATIO`**, value unchanged at `0.6`, with a doc comment naming both consumers. A constant whose name says "source" while it also governs the connector would be exactly the kind of drifting name this codebase's one-owner rule exists to prevent. `hittest.ts` keeps using it for the source-ring band only (the connector is deliberately not hit-testable — unchanged).

**Dead code: delete, do not keep.** `connectorTangents` is removed entirely, along with its unit tests. No flag, no "classic connector" option, no fallback — per the TASK-38 ruling that the loser of a two-owner situation gets deleted. The `Segment` type stays (now describing one segment rather than a pair).

**Test impact (must be planned, not discovered):**

- `src/editor/magnifier.test.ts` — the whole `describe("connectorTangents")` block is replaced by a `connectorSegment` block: endpoints lie on their own circles; the segment is collinear with `c2 − c1`; its length equals `d − r1 − r2`; `null` for overlap / exact touch / containment / coincident centers / `gap < MIN_GAP`; non-null just past the gap. The `null` cases and the gap cases transfer verbatim (same guard).
- `tests/e2e/magnifier.spec.ts` — **the "old lens area reverted to white" probe was positioned against the two-tangent geometry** (its comment computes clearance to "the new connector's tangent centerline"). With a single centerline the ink lands somewhere else, so the probe must be **recomputed, not assumed**. For the current fixture the arithmetic works out in the change's favour (`from = (25,25)`, `at` after the body drag `= (62.2, 51)`; the trimmed segment runs ≈`(30.9, 29.1) → (47.5, 40.7)`, ~30 px from the probe at `(72.2, 21)` versus ~6 px before), so the probe point itself is expected to survive — but the implementer must redo the numbers, rewrite the justification comment (it currently documents geometry that will no longer exist), and re-run `pnpm test:e2e` rather than reasoning only.

### Part 2 — size limits sized for fingers, not for `drawImage`

**The principle that resolves "bitmap px vs screen px".** This codebase already splits its size constants into two families, and the split is not arbitrary:

- **Content sizes are bitmap px** — `MIN_RECT_PX`, `MIN_BADGE_RADIUS`, `MIN_TEXT_FONT_SIZE`, stroke widths (with `docScale`/`ANNOTATION_SCALE_BASELINE` making them proportionate on large imports). They describe how the *exported image* should look.
- **Operability thresholds are CSS px, scale-compensated at the call site with `cropScale()`** — `BASE_TOL_PX`, `DOUBLE_TAP_SLOP_PX`, `HANDLE_HIT_PX × TOUCH_HIT_MULTIPLIER`, `MAGNIFIER_READOUT_*`. They describe how big something must be *under a finger*. The original magnifier note made this rule explicit for `MAGNIFIER_TAP_SLOP_PX`: "must be CSS-px-based and scale-compensated … a fixed bitmap-px threshold would turn a 2-CSS-px sloppy tap on a 4000 px photo into a 'drag'."

The user's complaint is literally about operability (*再度編集がしにくくなる*), and its worst case is the one a plain bitmap constant cannot fix: a 4000 px photo displayed at ~390 CSS px, where a 24-bitmap-px floor is 2.3 CSS px. So:

> **Minima are CSS px × `cropScale()` (finger-relative); maxima are canvas-relative (image-relative).** A thing is "too small" relative to a fingertip; a thing is "too big" relative to the picture it sits on.

`docScale` (`computeAnnotationScale`, bitmap-long-side ÷ 900, and hard-wired to 1 on desktop) was considered as the scale source and rejected below — it measures image resolution, not on-screen size, and is 1 exactly where large desktop screenshots need it most.

**One owner: `magnifierSizeLimits`.** A new pure function in `magnifier.ts` (still importing nothing but `model.ts`/`bounds.ts`):

```ts
export interface MagnifierSizeLimits {
  /** Smallest allowed DERIVED source radius (radius / zoom), bitmap px. */
  minSource: number;
  /** Smallest allowed lens radius, bitmap px. */
  minLens: number;
  /** Largest allowed lens radius, bitmap px. */
  maxLens: number;
}

export function magnifierSizeLimits(
  canvasSize: { w: number; h: number },
  scale: number, // bitmap px per CSS px — canvas.ts's cropScale()
): MagnifierSizeLimits;
```

with the body

```
shortSide = min(w, h)
maxLens   = MAGNIFIER_MAX_LENS_FRACTION (0.45) * shortSide
minSource = max( MIN_MAGNIFIER_SOURCE_RADIUS_PX (2),
                 min( MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX (16) * scale,
                      MAGNIFIER_SOURCE_SHORT_SIDE_CAP (0.15) * shortSide ) )
minLens   = min( MIN_MAGNIFIER_LENS_RADIUS_CSS_PX (28) * scale, maxLens )
```

Notes on each term:

- The canvas caps (`0.15 × shortSide`, `maxLens`) keep a finger-sized floor from becoming absurd on a small image — the "hi wins" clamp discipline established in round 1, applied to the limits themselves.
- `MIN_MAGNIFIER_SOURCE_RADIUS_PX = 2` **survives** as an absolute backstop and is the one place where the usual "hi wins" order is deliberately inverted (the `max` is outermost). It is load-bearing beyond aesthetics: `clampZoom` divides by `minSource`, so `minSource > 0` must hold even for a degenerate/zero-sized canvas. Its doc comment must say so.
- `MIN_MAGNIFIER_RADIUS` (12) and `MAX_MAGNIFIER_RADIUS` (4096) are **deleted**. The generous 4096 was always a placeholder ("the effective limit comes from the zoom clamp"); a lens larger than 90 % of the short side hides the image it is annotating, and its corner handles walk off the canvas where they cannot be drawn or grabbed. `maxLens = 0.45 × shortSide` is the same expression creation already used, so creation and editing now share one owner of "how big may a lens be".

**Values, and why these numbers.**

| Constant | Value | Derivation |
| --- | --- | --- |
| `MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX` | **16** | The source's two handles are `src-move` (at `from`) and `src-zoom` (on the rim), separated by exactly the source radius. `HANDLE_DRAW_PX = 10`, so glyph half-widths are 5 CSS px each: a 16 CSS px separation leaves ~6 CSS px of clear space between them, i.e. two visually distinct, independently aimable targets. Diameter 32 CSS px. |
| `MIN_MAGNIFIER_LENS_RADIUS_CSS_PX` | **28** | Lens diameter 56 CSS px — above Apple's ~44 pt target, leaves a draggable body between the four 10 px corner handles, and shows recognizable magnified content. Also ≥ `MIN_MAGNIFIER_ZOOM × 16 = 19.2`, which keeps zoom 1.2 reachable at the minimum lens (see the invariant below). |
| `MAGNIFIER_SOURCE_SHORT_SIDE_CAP` | **0.15** | Deliberately the same coefficient `defaultSourceRadius` already uses for its panorama guard; exported once and used by both, so there is one owner. |
| `MAGNIFIER_MAX_LENS_FRACTION` | **0.45** | The existing creation cap, now also the edit cap. |

Sanity check on a real device (iPhone, 1170×2532 screenshot, canvas ≈ 330 CSS px wide ⇒ `scale ≈ 3.55`): `minSource = 57` bitmap px (16 CSS px radius), `minLens = 99` bitmap px (28 CSS px radius), `maxLens = 526` bitmap px (148 CSS px radius — a lens that still fits the stage). Desktop, 2560×1440 capture in a 1400 px window (`scale ≈ 2.13`): 34 / 60 / 648 bitmap px. Both are usable, and neither prevents magnifying a genuinely small detail: the smallest source is ~6 % of the phone screenshot's width, roughly three characters of body text.

**Coupling, and the exact change at every enforcement site.** `sourceRadius = radius / zoom`, so a source floor is a zoom ceiling given a lens radius, and a lens floor given a zoom. The invariant set is:

```
I1  minLens ≤ radius ≤ maxLens
I2  radius / zoom ≥ minSource      ⟺   zoom ≤ radius / minSource
I3  MIN_MAGNIFIER_ZOOM ≤ zoom ≤ MAX_MAGNIFIER_ZOOM
```

Non-emptiness requires `minLens ≥ MIN_MAGNIFIER_ZOOM × minSource`; with the constants above this holds in every regime (uncapped 28 ≥ 19.2; both capped 0.45 ≥ 0.18; either mixed case follows from the cap that bit). This is asserted by a unit test over a table of canvas sizes and scales, not left as a comment.

| Site | Today | After |
| --- | --- | --- |
| `defaultSourceRadius(canvasSize)` | `min(0.06·long, 0.15·short)` | `defaultSourceRadius(canvasSize, limits)` = `max(min(0.06·long, MAGNIFIER_SOURCE_SHORT_SIDE_CAP·short), limits.minSource)`. The floor lives *inside* the function so `canvas.ts` cannot forget it. Result never exceeds `0.15·short` because `minSource` is itself capped there. |
| `deriveLensSizeForSource(srcR, size, canvasSize)` | caps with `0.45·short`, floors with `MIN_MAGNIFIER_RADIUS` | `deriveLensSizeForSource(srcR, size, canvasSize, limits)`: `targetRadius = min(PRESET·long/2, limits.maxLens)`; step-4 clamp becomes `clamp(radius, limits.minLens, limits.maxLens)`; the **single** re-derivation of `zoom` is unchanged. `canvasSize` is still needed for the long-side preset term, so both parameters are passed (redundant but honest — note it in the doc comment). |
| lens corner resize (`applyMagnifierCornerResize`) | `lo = max(MIN_MAGNIFIER_RADIUS, zoom·2)`, `hi = 4096` | `lo = max(limits.minLens, a.zoom · limits.minSource)`, `hi = limits.maxLens`. Structure unchanged; only the numbers move. The `zoom · minSource` term is what preserves I2 while the gesture holds `zoom` fixed (AC #3). |
| `src-zoom` (`clampZoom(z, a)`) | ceiling `min(MAX_ZOOM, radius/2)` | `clampZoom(z, a, limits)`, ceiling `min(MAX_MAGNIFIER_ZOOM, a.radius / limits.minSource)`. `minSource ≥ 2 > 0`, so no division hazard. |
| `src-move` | `from = pointer`, unclamped | unchanged — position, not size. |

Because `radius ≤ maxLens` and `zoom ≤ radius / minSource`, no gesture sequence can leave the reachable set: shrinking the lens stops at `zoom · minSource`; raising the zoom stops at `radius / minSource`; the corner drag never touches `zoom` (AC #3 preserved). The one consequence worth documenting in the UI-facing docs: **at a high zoom the lens cannot be made small — lower the zoom first.** That is the intended reading of the user's request (tiny lens + high zoom *is* the ungrabbable source).

Degenerate canvases keep the round-1 semantics: when `lo > hi` the clamp's `hi` wins (`min(max(x, lo), hi)`), so a canvas too small to satisfy both floors yields `radius = maxLens` and may sit under the operability floor. Documented, tested, not special-cased.

**Existing annotations below the new minima — confirmed policy, unchanged.** Clamps are **creation/edit-time behaviour only**. Nothing mutates stored data at render time, on load, or on document open; an old loupe with a 4 px source ring renders exactly as saved (and exports identically), and snaps into range the first time a corner or the `src-zoom` handle is dragged — the ordinary clamp behaviour of every other tool. This matters more than usual here because the minima are *display-scale dependent*: the same annotation is "in range" in a wide desktop window and "below range" on a phone. That asymmetry is correct (the floors are about the current finger-to-pixel ratio), it never destroys data, and it must be stated explicitly in `magnifier.ts`'s doc comment because it will otherwise read as a bug.

**Threading the limits.** `canvas.ts` gains one private owner:

```ts
private magnifierLimits(): MagnifierSizeLimits {
  return magnifierSizeLimits({ w: this.canvas.width, h: this.canvas.height }, this.cropScale());
}
```

used by `magnifierGeometry` (creation) and by the resize branch. `applyResize` gains a **required** 6th parameter `limits: MagnifierSizeLimits` — required rather than optional-with-default, for the same reason `renderAnnotations`'s `background` was made required in the original note: TypeScript then forces the single real call site to be updated, and a silent default is exactly the "fallback left behind" the project forbids. Only the magnifier branch reads it, which mirrors the existing precedent of `translateAnnotation(a, dx, dy, part)` — a parameter one kind reads and the rest ignore. Cost: mechanical call-site updates in `resize.test.ts` (append a shared `TEST_LIMITS` constant).

`magnifierGeometry` is simplified to `magnifierGeometry(from: Point)`: it computes the limits once, derives the source radius via `defaultSourceRadius(canvasSize, limits)`, then sizes and places. `onDown`'s magnifier branch loses its `defaultSourceRadius(...)` argument, removing a second place that must remember to apply the floor.

**Does this break the aspect-independent creation zoom (AC #12)?** The floor only bites at creation when `MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX × scale > 0.06 × longSide`, i.e. when the canvas's **displayed long side is under ≈ 267 CSS px** — a window smaller than any phone in portrait. Above that, `defaultSourceRadius` is unchanged and S/M/L still yield ≈1.8×/2.5×/3.3× for any aspect up to 2.5:1. Below it, zoom is lower than the preset *by design* (operability wins over a nominal zoom number). Proposed as a footnote to AC #12 rather than a break — see the AC section.

## Alternatives considered

**Connector**

- **Keep one of the two tangents.** Rejected: asymmetric, reads as a rendering bug, and loses the "cone" reading that justified the pair in the first place.
- **Untrimmed center-to-center line.** Rejected: paints ink across the detail inside the source ring (whose interior is transparent) and shows inside the lens whenever `background === null`.
- **Leader/arrow-style connector (tapered, or with a head).** Rejected: more ink than the user asked for, and an arrowhead collides semantically with the arrow tool.
- **Curved bridge (quadratic between rims).** Rejected: no added meaning, more code, and it makes AA-fringe reasoning in the e2e probe harder for no benefit.
- **Keep `connectorTangents` and add `connectorSegment`, choosing per preference/flag.** Rejected: two owners of one geometry, dead code by default, and a settings surface for a decision the user has already made.
- **Raise `MAGNIFIER_CONNECTOR_MIN_GAP_PX` so short stubs are suppressed.** Rejected for now: it changes a behaviour the user did not complain about and would perturb AC #1's "suppressed when … nearly touch" wording and two existing tests. Revisit only if stubs look wrong on device.

**Size limits**

- **Plain bitmap-px constants (raise `MIN_MAGNIFIER_SOURCE_RADIUS_PX` 2 → ~24, `MIN_MAGNIFIER_RADIUS` 12 → ~48).** Simplest possible change, zero API churn, and consistent with `MIN_BADGE_RADIUS`/`MIN_RECT_PX`. Rejected because it does not fix the reported failure where it actually hurts: on a 4000 px photo at 390 CSS px, 24 bitmap px is 2.3 CSS px — still ungrabbable — while on a 400 px image the same constant is an unusably large floor. A single number cannot serve both.
- **Scale the floors by `docScale` (`computeAnnotationScale`) instead of `cropScale()`.** Rejected: `docScale` measures *image resolution* (and is clamped, and is hard-wired to 1 on desktop), not on-screen size. A 2560 px desktop screenshot in a small window — precisely a case where handles get tiny — would get `docScale = 1` and no protection. It is the right scale for stroke weights, the wrong one for fingers. The plumbing cost is identical either way, so there is no simplicity argument in its favour.
- **Let the lens corner drag *lower the zoom* instead of refusing to shrink.** Rejected: it silently violates the fixed-zoom contract of the corner handle (TASK-46 AC #3) and destroys the orthogonal one-control-per-degree-of-freedom assignment that the whole handle model rests on.
- **A single post-hoc `clampMagnifierSize(a, limits)` applied in `canvas.ts` after `applyResize`, with the clamps deleted from `resize.ts`.** Genuinely attractive (one owner of all three invariants, and it would automatically cover future writers such as TASK-42 group scaling), but rejected: it makes `applyResize` return momentarily invalid annotations, is inconsistent with how every sibling kind clamps inline, and can be silently forgotten by a future caller — the same "structural, not a rule" argument Addendum A used for freezing radius/zoom in `magnifierPlace`. Revisit if TASK-42 adds a second writer of `radius`/`zoom`.
- **Keep `MAX_MAGNIFIER_RADIUS = 4096` and only fix the minima.** Rejected: the user asked for 最大最小, and an unbounded lens hides its own image and pushes its corner handles off the canvas, where they cannot be drawn or grabbed — the same "cannot be re-edited" trap, from the other end.
- **Freeze the limits at `pointerdown` for the duration of a resize gesture** (mirroring `magnifierPlace`). Rejected as unnecessary: only a window resize mid-drag could change them, and `tolerance()`/`handleHitRadius()` already recompute `cropScale()` per event without trouble.

## IPC / API contract

**No IPC changes.** No Rust, no Tauri command, no capability, no new dependency; `docs/ARCHITECTURE.md`'s "the magnifier/loupe … is a pure `src/` feature and introduces no IPC changes" paragraph stays true as written. The contract that changes is internal and cross-module:

| Surface | Before | After |
| --- | --- | --- |
| `magnifier.ts` | `connectorTangents(c1, r1, c2, r2): [Segment, Segment] \| null` | **deleted** → `connectorSegment(c1, r1, c2, r2): Segment \| null` |
| `magnifier.ts` | — | `interface MagnifierSizeLimits { minSource; minLens; maxLens }`; `magnifierSizeLimits(canvasSize, scale): MagnifierSizeLimits` |
| `magnifier.ts` | `defaultSourceRadius(canvasSize)` | `defaultSourceRadius(canvasSize, limits)` |
| `magnifier.ts` | `deriveLensSizeForSource(srcR, size, canvasSize)` | `deriveLensSizeForSource(srcR, size, canvasSize, limits)` |
| `magnifier.ts` | `clampZoom(z, a)` | `clampZoom(z, a, limits)` |
| `magnifier.ts` | `MIN_MAGNIFIER_RADIUS`, `MAX_MAGNIFIER_RADIUS` | **deleted**; new `MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX = 16`, `MIN_MAGNIFIER_LENS_RADIUS_CSS_PX = 28`, `MAGNIFIER_SOURCE_SHORT_SIDE_CAP = 0.15`, `MAGNIFIER_MAX_LENS_FRACTION = 0.45`; `MIN_MAGNIFIER_SOURCE_RADIUS_PX = 2` kept as the absolute backstop |
| `resize.ts` | `applyResize(a, bounds, handle, pointer, shiftKey)` | `applyResize(a, bounds, handle, pointer, shiftKey, limits: MagnifierSizeLimits)` — **required**; only the magnifier branch reads it |
| `render.ts` | `MAGNIFIER_SOURCE_STROKE_RATIO` | renamed `MAGNIFIER_MARKER_STROKE_RATIO` (same value `0.6`; now governs the source ring **and** the connector); `hittest.ts`'s import updates |
| `canvas.ts` | `magnifierGeometry(from, sourceRadius)` | `magnifierGeometry(from)`; new private `magnifierLimits()` |

Import boundary is unchanged and must still hold: `exporter → render → {bounds, rotate, magnifier} → model`; `magnifier.ts` imports nothing but `model.ts`/`bounds.ts` types and must never import `hittest`/`resize`/`crop`/`canvas`. All new constants and the new function are pure geometry, so they belong in `magnifier.ts`; the CSS-px constants live there too (they are numbers, not DOM knowledge — the `cropScale()` conversion stays in `canvas.ts`, which is the only module allowed to know about the DOM).

## Acceptance-criteria regression pass

TASK-46 is still **In Progress**, so its ACs are not yet frozen contracts — but they are the agreed spec and must not be silently contradicted. Findings:

1. **AC #1 conflicts and must be amended** — it reads *"renders as: two external tangent connector segments, a thin source ring, …"*. Proposed replacement text:

   > *"The committed annotation renders as: a single straight connector segment along the center-to-center line, trimmed to each circle's rim and stroked at the secondary marker weight; a thin source ring; smoothly interpolated magnified content clipped to the lens circle; and a two-pass (white outline + color) lens border. The connector is suppressed when the lens and source circles overlap or nearly touch."*

2. **AC #12 (aspect-independent creation zoom) — proposed footnote, not a break.** Add: *"…for any image up to 2.5:1 displayed at a long side of ≥ 267 CSS px; below that the operability floor on the source radius takes precedence and the creation zoom is correspondingly lower."*

3. **AC #3 (handle semantics), #5 (no rotation, no pixel storage), #10 (e2e), #11 (auto-select) — intact.** The corner handle remains fixed-zoom; only its clamp bounds change. The e2e scenario still passes if the probe is revalidated (task 8 below).
4. **ACs #2 and #6 are still unverified** (export and post-crop behaviour). Neither change touches the export path or `applyCrop`, so they remain open exactly as they are — this addendum does not close them and must not be reported as doing so.
5. Other Done tasks: TASK-29 (selection/resize) is affected only by the added `applyResize` parameter, with no behaviour change for non-magnifier kinds; TASK-35.x (web/PWA), TASK-40 (crop), rotation work — unaffected.

## Implementation tasks

Hand these to `implementer` in order; each step leaves the tree compiling. Run `pnpm check` and `pnpm test` after every task.

1. **Connector geometry** (`src/editor/magnifier.ts`): replace `connectorTangents` with `connectorSegment(c1, r1, c2, r2): Segment | null` — same `d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX` guard, returning `[c1 + r1·u, c2 − r2·u]`. Delete `connectorTangents` and its derivation comment; write a new doc comment covering the trimming rationale (transparent ring interior, null-background case) and the fact that the guard is editorial rather than numerical. Update `MAGNIFIER_CONNECTOR_MIN_GAP_PX`'s comment, which names `connectorTangents`.
2. **Connector rendering** (`src/editor/render.ts`, `src/editor/hittest.ts`): rename `MAGNIFIER_SOURCE_STROKE_RATIO` → `MAGNIFIER_MARKER_STROKE_RATIO` (value unchanged, doc comment naming both consumers), update `hittest.ts`'s import and use. In `drawMagnifier` step 1, stroke the single segment two-pass at `markerStroke + 4` (OUTLINE) then `markerStroke` (`a.color`), where `markerStroke` is the same expression the source ring uses — compute it once above step 1 and share it. Keep the unconditional `ctx.lineCap = "round"` and the existing draw order and comments.
3. **Connector tests** (`src/editor/magnifier.test.ts`): replace the `connectorTangents` describe block with `connectorSegment` — endpoints on their rims, collinearity with `c2 − c1`, length `= d − r1 − r2`, and the `null` cases plus the gap-boundary cases carried over unchanged.
4. **Size limits** (`magnifier.ts`): add `MagnifierSizeLimits`, `magnifierSizeLimits(canvasSize, scale)` and the four new constants exactly as specified; keep `MIN_MAGNIFIER_SOURCE_RADIUS_PX = 2` with its new "absolute backstop, guarantees `minSource > 0` for `clampZoom`" comment; delete `MIN_MAGNIFIER_RADIUS`/`MAX_MAGNIFIER_RADIUS`. Update `defaultSourceRadius`, `deriveLensSizeForSource` and `clampZoom` to the new signatures and bodies (`MAGNIFIER_SOURCE_SHORT_SIDE_CAP` replaces the literal `0.15` in `defaultSourceRadius`; `limits.maxLens` replaces both `0.45 * shortSide` occurrences). Document the display-scale dependency and the "clamps are creation/edit-time only; stored data is never mutated" policy in the module doc comment.
5. **Resize enforcement** (`src/editor/resize.ts`): add the required `limits` parameter to `applyResize` (documented as "read only by the magnifier branch — the `translateAnnotation(part)` precedent") and thread it to `applyMagnifierResize`/`applyMagnifierCornerResize`/`clampZoom`; `lo = max(limits.minLens, a.zoom * limits.minSource)`, `hi = limits.maxLens`. Update the imports from `magnifier.ts` and the doc comments that name the deleted constants.
6. **Editor wiring** (`src/editor/canvas.ts`): add the private `magnifierLimits()`; change `magnifierGeometry(from)` to compute limits + `defaultSourceRadius(canvasSize, limits)` internally and pass `limits` to `deriveLensSizeForSource`; simplify the `onDown` magnifier branch accordingly (and drop the now-unused `defaultSourceRadius` import if nothing else uses it); pass `this.magnifierLimits()` at the `applyResize` call site.
7. **Unit tests for limits** (`magnifier.test.ts`, `src/editor/resize.test.ts`): add a `magnifierSizeLimits` block (CSS-px scaling, both canvas caps, the absolute backstop, and a table-driven property test that `minLens ≥ MIN_MAGNIFIER_ZOOM × minSource` across several canvas sizes and scales); add post-condition tests for `deriveLensSizeForSource` (`radius ∈ [minLens, maxLens]` and `radius / zoom ≥ minSource` over a table of presets/source radii/scales, plus the existing degenerate-canvas "hi wins" case); update `defaultSourceRadius` and `clampZoom` tests to the new signatures. In `resize.test.ts`, define one shared `TEST_LIMITS = magnifierSizeLimits({ w: 1000, h: 800 }, 1)`, append it to every `applyResize` call, and rewrite the four magnifier clamp tests against the new bounds (lens floor `minLens`, high-zoom floor `zoom × minSource`, ceiling `maxLens` instead of 4096, `src-zoom` ceiling `radius / minSource`).
8. **E2E revalidation** (`tests/e2e/magnifier.spec.ts`): update the mirrored constants block — replace `MIN_RADIUS = 12` with a mirror of `magnifierSizeLimits` using `bitmapPerCss = 1 / geo.scale`, and assert in a comment (with the numbers) that neither the floor nor the cap bites for the 120×90 fixture so the expected lens radius is unchanged. Then **recompute** the "old lens area reverted to white" probe against the new single-segment geometry: derive the trimmed segment's endpoints for the post-drag state, state the probe's clearance to it and to the zoom readout / marquee, and rewrite the comment (which currently documents tangent-line clearances that will no longer exist). Run `pnpm build:web && pnpm test:e2e`; do not sign off on a code trace alone.
9. **Docs** (`docs/ARCHITECTURE.md`): update the "Magnifier (loupe)" section — the connector description and the `connectorTangents` mention, the constants-and-homes paragraph for the deleted/renamed/added constants, and add a short "Operability limits" paragraph stating the minima-in-CSS-px / maxima-canvas-relative principle, the `magnifierSizeLimits` single owner, the "lower the zoom before shrinking the lens" consequence, and the never-mutate-stored-data policy. Add this design note to the design-note list and cross-link it from the two earlier magnifier notes' headers.
