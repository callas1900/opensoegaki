# Design note — Magnifier UX brush-up (source-body drag, zoom grip, frame weight)

Backlog id: **TASK-49**. Status: approved 2026-08-06.

## Problem

The magnifier's source-side controls are unreadable as controls: the `src-move` dot at
`from` and the `src-zoom` dot on the source rim are the same 10 CSS px accent circle,
sit within one source-radius of each other, and compete visually with the four white
lens-bbox squares — nothing says which grip owns which degree of freedom. Worse, the
source *region* — the thing the user actually aims — is not a drag surface at all: its
interior is a deliberate hit-test miss, and its rim band moves the **lens** (`canvas.ts`
passes `part = "lens"` for every magnifier body drag). The zoom grip has no grab
affordance, and both frame strokes (lens border `= strokeWidth`, source ring
`= 0.6 × strokeWidth`) read as hairlines on a large capture.

User decisions (2026-08-06): the whole source disc becomes the drag surface, live even
when the magnifier is unselected, and `src-move` is deleted.

## Decision summary

| # | Question | Decision |
| --- | --- | --- |
| 1 | Part plumbing | New pure `magnifierHitPart()` in `hittest.ts`; `translateAnnotation` part union → `"all" \| "lens" \| "source"`; `canvas.ts` freezes the part into `this.move` at pointerdown |
| 2 | Hit priority | selected-handle > topmost annotation > (within a magnifier) lens disc > source disc |
| 3 | Zoom grip | On-rim 16 CSS px accent knob, white casing + 3 white tangential ridges; `HandleSpec.shape` renamed `"square" \| "grip"` |
| 4 | Frame weight | Uniform 1.5×: new `MAGNIFIER_LENS_STROKE_RATIO = 1.5`, `MAGNIFIER_MARKER_STROKE_RATIO` 0.6 → 0.9 (marker stays exactly 0.6 × lens border) |
| 5 | Source affordance | Chrome-only accent tint filling the source disc while selected, `evenodd`-punched by the lens disc |
| 6 | Cursors | Falls out for free: `move` over the source disc (selected or not), `nwse-resize` on the grip, `move` on the lens body |
| 7 | Operability floor | `MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX` 16 → 20 |

### 1. Source-body drag plumbing

New contract in `src/editor/hittest.ts`:

```ts
/** Which half of a magnifier the pointer landed on — the lens disc wins where the two overlap (paint order). */
export function magnifierHitPart(a: MagnifierAnnotation, p: Point, tolerance: number): MagnifierPart | null;
```

- `MagnifierPart = "lens" | "source"` is exported from `model.ts` (the leaf that already
  owns the part union), so **the probe's return type *is* the translate part type** — no
  mapping layer, no second vocabulary.
- Geometry: `lens` = filled disc `radius + tolerance` (verbatim today's rule); `source` =
  filled disc `magnifierSourceRadius(a) + tolerance + markerStroke/2` (the outer edge of
  today's ring band, so nothing that hits today stops hitting).
- `hitsAnnotation`'s `case "magnifier"` becomes
  `return magnifierHitPart(a, p, tolerance) !== null;` — one owner of magnifier hit
  geometry. `hittest.ts` stays pure.
- Rotation: a magnifier can never carry a non-zero `angle`
  (`canRotate("magnifier") === false`; group rotation is translation-only), so the probe
  takes world coords and does no unrotation.

`model.ts`: `translateAnnotation(a, dx, dy, part: "all" | MagnifierPart = "all")`;
`"source"` shifts only `from`.

`canvas.ts`: `move` state gains `part`, computed once at pointerdown from the annotation
`hitTest` returned; `onMove` then uses `this.move.part`, and the old
`original.kind === "magnifier" ? "lens" : "all"` derivation is **deleted, not left as a
fallback** — the part is decided once, at grab time, by the same function that decided
the hit. `from` stays **unclamped** during a source drag (the policy the deleted
`src-move` branch documented: creation clamps, editing does not).

### 2. Hit priority

Order in `onDown` (select tool) — only the last step is new:

1. **Selected annotation's controls** (`rotateOrResizeTarget`) — already checked before
   `hitTest`; that is exactly what keeps the `src-zoom` grip reachable now that the disc
   under it is hit-testable.
2. **`hitTest` topmost-first**, unchanged: an annotation drawn ABOVE the magnifier still
   wins inside the source disc; one drawn BELOW no longer does (the accepted tradeoff).
3. **Within one magnifier**: lens disc first, then source disc — matches paint order.

Two consequences to document, not special-case, both self-recoverable in one gesture:

- When the lens fully contains the source disc, the source can't be grabbed until the
  lens is dragged off it. The §5 tint shows this truthfully because it is punched by the
  lens.
- At minimum source size on touch, the grip's 24 CSS px hit radius eats into the disc;
  §7 raises the always-draggable lune from 8 to 16 CSS px, and an accidental grip drag at
  minimum size can only *decrease* zoom (the shrink direction is already clamped), i.e.
  it grows the source and restores room.

### 3. `src-zoom` grip redesign

Anchor unchanged: `MAGNIFIER_ZOOM_HANDLE_ANGLE = π/4`, and the handle `pos` stays exactly
**on the rim**, so `zoom = radius / dist(pointer, from)` still maps the grab point to the
current zoom with **zero jump**.

New chrome constants in `canvas.ts` (CSS px, all `* cropScale()`):

```
MAGNIFIER_ZOOM_GRIP_PX           = 16    // drawn diameter (vs HANDLE_DRAW_PX = 10 for lens squares)
MAGNIFIER_ZOOM_GRIP_CASING_PX    = 2     // white casing stroke width
MAGNIFIER_ZOOM_GRIP_RIDGE_LEN_PX = 8     // ridge length, tangential
MAGNIFIER_ZOOM_GRIP_RIDGE_GAP_PX = 3.5   // radial spacing of the 3 ridges
MAGNIFIER_ZOOM_GRIP_RIDGE_PX     = 1.5   // ridge stroke width
```

Draw (in `drawSelectionOverlay`, wrapped in its own `ctx.save()/restore()` — it sets
`lineCap = "round"`, which must not leak into the marquee/rotate knob):

```
u = (cos π/4, sin π/4)            // radial outward
t = (-u.y, u.x)                   // tangential
c = handle.pos                    // on the rim
disc:   arc(c, 8·s), fill PALETTE[0], stroke rgba(255,255,255,0.95) @ 2·s
ridges: for k ∈ {-1,0,1}: segment c + u·(k·3.5·s) ∓ t·(4·s)
        stroke rgba(255,255,255,0.95) @ 1.5·s, lineCap "round"
```

Ridges run **tangentially**, i.e. perpendicular to the radial drag direction (the
scrollbar-thumb / bottom-sheet idiom). Fit check: at radial offset 3.5 the half-chord of
the r = 8 disc is `√(64 − 12.25) = 7.19 > 4`, so all three ridges sit inside the casing.
Differentiation from lens squares: circle vs square, 16 vs 10 CSS px,
accent-fill+white-casing vs white-fill+accent-border, textured vs flat — four independent
cues, plus the `src-move` twin is gone. Cursor `nwse-resize`. Hit radius unchanged
(`handleHitRadius()` = 12 mouse / 24 touch CSS px); drawn radius 8 < 12 preserves the
house "hit slightly larger than glyph" relation.

`HandleSpec.shape?: "square" | "circle"` → `"square" | "grip"`: with `src-move` gone
there is exactly one non-square family, and "grip" names what `drawSelectionOverlay` must
draw. It stays a chrome hint; `resize.ts` still draws nothing.

### 4. Frame thickness

```ts
// render.ts
export const MAGNIFIER_LENS_STROKE_RATIO   = 1.5;  // NEW: lens border = strokeWidth * this
export const MAGNIFIER_MARKER_STROKE_RATIO = 0.9;  // was 0.6 — still exactly 0.6 × the lens border
```

`drawMagnifier` computes `lensStroke = Math.max(1, a.strokeWidth *
MAGNIFIER_LENS_STROKE_RATIO)` once, uses it for both border passes (`lensStroke + 4`
outline, then `lensStroke`), and the connector's wide-end floor becomes
`Math.max(FAN_RATIO * a.radius, markerStroke, lensStroke)`.

Resulting weights (bitmap px, `docScale` 1), lens border / source ring:
**S 4.5 / 2.7, M 9 / 5.4, L 18 / 10.8** (was 3/1.8, 6/3.6, 12/7.2).

Flushness (TASK-48 AC#8) holds and strengthens; `connectorShape`'s doc arithmetic in
`magnifier.ts` is re-derived:

- Source end: the connector's 2 px halo overshoot vs the ring band half-width
  `(markerStroke + 4)/2 ≥ 2.5` — carried by the shared `+4` halo floor, unchanged.
- Miter coverage, minimum case (`r1 = 13.5`): was `hypot(11.5, 3.8) = 12.11` inside band
  `[10.6, 16.4]`; becomes `hypot(11.5, 4.7) = 12.42` inside band `[8.8, 18.2]` — still
  inside, with more margin.
- Lens end: the arc lies exactly on the rim, now under a thicker border band — strictly
  better.

**Stated explicitly:** this changes the exported pixels of every existing magnifier
(thicker frames). That is the point of complaint 4. Reading of TASK-48 AC#6 ("stored data
never mutated at render/load; pre-existing out-of-range annotations render and export
unchanged"): its subject is *geometry and stored data*, not pixel-identical output across
releases — a weight retune is a rendering change governed by AC#1/#2, whose structure we
keep. No amendment to #6; the reading is recorded in TASK-48's notes.

### 5. Selection affordance on the source side

While selected, `drawSelectionOverlay` fills the source disc with a flat accent tint
**before** the handle loop:

```
MAGNIFIER_SOURCE_TINT = "rgba(237,16,123,0.12)"   // PALETTE[0] at 12 %
path = new Path2D(); path.arc(from, sourceRadius); path.arc(at, a.radius);
ctx.fill(path, "evenodd");                         // the lens disc punches the tint out
```

**Correction (review round 1, 2026-08-06): the pseudocode above is wrong as written.**
With disjoint discs (the normal case — lens and source are usually apart, connected only
by the connector), an UN-clipped `evenodd` fill of a `Path2D` holding both full circles
does not punch the lens out at all: `evenodd` only cancels the *overlap* between two
loops, so it independently fills the lens disc's own exclusive interior too (every pixel
inside the lens but outside the source is crossed exactly once, by the lens loop alone —
odd, hence filled). Implemented instead as: `clip()` to the source disc FIRST, then
`evenodd`-fill a `Path2D` holding both discs, inside that clip. The clip is what
suppresses the lens's exclusive body (nothing drawn after `clip()` can land outside the
source disc); `evenodd` is what punches the overlap out within the clip. Neither alone is
sufficient; both together, in this order, are. (A first implementation attempt used
`clip()` + `destination-out` instead of `clip()` + `evenodd` — also wrong, on two counts:
`destination-out` only erases by the fill's own alpha, so most of the tint survived
inside the overlap and the punch didn't punch; and because `drawSelectionOverlay` paints
on the live canvas after `renderAnnotations`, `destination-out` erased the actually
rendered screenshot underneath, not just the tint layer, visibly holing out the picture
whenever the lens was dragged onto its own source.) The original pseudocode above is kept
for the record, superseded by this correction.

The `evenodd` punch is not decoration: it makes the tinted region equal (to within
tolerance) the region where a press starts a **source** drag, so the chrome never
promises a gesture the hit test won't deliver — including the fully-contained case, where
the tint correctly vanishes. Chrome only, lives in `canvas.ts`, never reaches
`exportPng()`.

### 6. Cursor map

| Pointer over | Unselected | Selected |
| --- | --- | --- |
| Lens disc | `move` | `move` |
| Source disc | `move` (new — discoverability win) | `move` |
| `src-zoom` grip | n/a (chrome hidden) | `nwse-resize` |
| Lens bbox corner | n/a | `nwse-` / `nesw-resize` |

No new cursor code: `onMove`'s hover branch resolves handles first, then falls back to
`hitTest → "move"`, so the source disc inherits `move` the moment it becomes
hit-testable. Only change: delete `case "src-move"` from `cursorForResizeHandle`.

### 7. Operability floor: `MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX` 16 → 20

The current 16 was justified by "the two source handles are separated by exactly the
source radius, so 16 leaves ~6 CSS px of clear space" — that rationale dies with
`src-move`. New rationale: the source disc is the **drag surface** and the grip's
24 CSS px touch radius eats into it from the rim, so at `minSource = 20` the
always-body-draggable lune is `2·20 − 24 = 16` CSS px (vs 8 at 16). Non-emptiness
`minLens ≥ MIN_ZOOM · minSource` → `28 ≥ 24` holds. Cost: TASK-46 AC#12's
aspect-independence threshold moves from `≥ 267` to `≥ 333` CSS px long side (`20/0.06`).

## Alternatives considered

- **`hitTest` returns `{annotation, part}`** — rejected: touches all call sites plus
  every `hitTest` test, and pushes one kind's private vocabulary into a generic API
  serving six kinds. The probe keeps the generic signature and is independently testable.
- **Lollipop tab outside the rim (stem + knob)** — the better "pull me" affordance, and
  genuinely close. Rejected on arithmetic: the grab point moves `stem + knobRadius ≈ 11`
  CSS px outward and `zoom = radius / dist` is absolute, so on a 20 px source at scale 1
  merely *touching* the knob drops zoom ~35 % before any movement. Compensating requires
  the offset in bitmap px inside `resize.ts` — either threading `scale` into
  `applyResize`, or a radius-proportional offset that breaks the screen-constant-chrome
  rule. The ridges carry the affordance without touching the math.
- **Auto-placing the grip opposite the lens** — rejected: avoids a few px of overlap
  with the connector's narrow end while making the grip's position move whenever the lens
  moves.
- **Radius-anchored lens border** — rejected: the border weight must stay under the
  S/M/L stroke picker, the user's only weight lever.
- **Enlarging the selection marquee to enclose the source** — rejected: the four corner
  handles are positioned from `boundsOf`, so this moves them off the lens and silently
  changes corner-resize semantics (TASK-46 AC#3). A dashed halo was also rejected (more
  ink next to an already two-pass ring; it says "boundary", not "surface").

## IPC / API contract

None — `src/`-only, no Tauri commands, no Rust, no new dependency, nothing that blocks
the macOS port. Internal TS contracts changed:

```ts
// model.ts
export type MagnifierPart = "lens" | "source";
export function translateAnnotation(a: Annotation, dx: number, dy: number,
                                    part: "all" | MagnifierPart = "all"): Annotation;

// hittest.ts
export function magnifierHitPart(a: MagnifierAnnotation, p: Point,
                                 tolerance: number): MagnifierPart | null;

// resize.ts
export type MagnifierHandle = "src-zoom";                  // "src-move" deleted
export interface HandleSpec { id: ResizeHandle; pos: Point; shape?: "square" | "grip" }

// render.ts
export const MAGNIFIER_LENS_STROKE_RATIO = 1.5;            // new
export const MAGNIFIER_MARKER_STROKE_RATIO = 0.9;          // was 0.6
```

## Open risks

1. **Touch collision at minimum source size** — mitigated by the raised floor and the
   self-correcting clamp direction, not eliminated; device-verified item.
2. **Clicks lost under the source disc** — accepted by the user; the only recovery for an
   annotation buried under a large source disc is to move the magnifier first.
3. **e2e pixel probes vs thicker strokes** — clearances (~38-44 px) dwarf the ~+1.8 px
   marker increase, but the probe comments state their arithmetic explicitly and must be
   re-derived, not assumed.
4. **Existing documents re-render heavier** — intended, but it silently changes exports;
   mention in release notes.
5. **The `?? "lens"` dead branch** in `onDown` — if a future refactor makes `hitTest` and
   `magnifierHitPart` disagree, the drag would be silently mis-assigned. The delegation
   (one geometry owner, same module) is what prevents that; keep them together.
