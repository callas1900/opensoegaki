# Magnifier — rectangular lens variant ("cube mode")

*Date: 2026-08-08 · Status: implemented · Extends `docs/design/2026-08-01-magnifier-loupe.md`
and its addendums (A: `2026-08-01a-magnifier-creation-revision.md`, B:
`2026-08-02-magnifier-connector-and-size-limits.md`, C:
`2026-08-02a-magnifier-tapered-connector.md`) and the "magnifier UX brush-up" note
(`2026-08-06-magnifier-ux-brushup.md`). Backlog id: TASK-XX ("Magnifier cube mode
(rect lens)").*

## Problem

The magnifier tool offers only a circular lens. A circle fits a small detail (an
icon, a UI control) well, but a wide detail — a line of text, a form field, a table
row — either has to be shrunk to fit inside a disc (wasting screen space around the
corners) or the disc has to grow so large it swallows unrelated content on either
side. Users asked for a **resizable rectangular lens** that hugs a text line the way
a highlight does, while keeping everything the circular loupe already does well:
slide-to-aim creation, a source-region marker with a tapered connector, and
free-aspect resize.

## Decision summary

| # | Question | Decision |
| --- | --- | --- |
| 1 | Model | Discriminated union inside the existing `"magnifier"` kind (`shape?: "circle" \| "rect"`), not a new `AnnotationKind` |
| 2 | Geometry convention | Lens `at` (center) + `width`/`height`; source region derived as `(width/zoom) x (height/zoom)` centered on `from` — the rect analog of the circle's `radius/zoom` |
| 3 | Connector | New straight-sided projection wedge (`magnifierRectConnectorShape`), no arc — both rims are already flat |
| 4 | Creation | Slide-to-aim gesture reused verbatim; new wide (8:3) default aspect for a fresh rect lens, tuned for a text line |
| 5 | Resize | 8 free box handles (rect/image family) + the `src-zoom` grip; zoom stays uniform on both axes, `from` never moves |
| 6 | Mode switch | Second tap on the already-active magnifier toolbar button toggles circle⇔rect and swaps the button icon (badge-tool second-tap precedent) |
| 7 | Not changed | Every circle code path stays byte-identical; no persisted-format migration (union is plain data, `structuredClone`-safe) |

## 1. Model — a discriminated union inside kind `"magnifier"`

```ts
interface MagnifierBase extends AnnotationBase {
  kind: "magnifier";
  at: Point;    // lens CENTER
  zoom: number; // > 1, uniform both axes
  from: Point;  // source CENTER; source is DERIVED (lens size / zoom)
}
export interface CircleMagnifierAnnotation extends MagnifierBase {
  shape?: "circle";  // absent == circle (pre-existing in-session/serialized annotations)
  radius: number;
}
export interface RectMagnifierAnnotation extends MagnifierBase {
  shape: "rect";
  width: number;   // full lens width, bitmap px
  height: number;  // full lens height, bitmap px
}
export type MagnifierAnnotation = CircleMagnifierAnnotation | RectMagnifierAnnotation;
```

**Why a union, not a new `AnnotationKind`.** Translate/part/undo/commit/degeneracy
logic is 100% shared between the two shapes — a new kind would duplicate an arm in
every exhaustive `switch (a.kind)` across the codebase (`render.ts`, `hittest.ts`,
`resize.ts`, `bounds.ts`, `canvas.ts`). The union keeps every shared path on ONE
`case "magnifier":` arm; narrowing `radius`/`width`/`height` behind `a.shape` makes
`pnpm check` flag exactly the call sites that need a rect branch — the work list
practically writes itself. `MagnifierPart`, `translateAnnotation` and part-drag
plumbing need **zero changes**: both variants key off the same `at`/`from` center
pair.

**Why `shape` is optional, not required.** Every in-session and serialized
annotation created before this feature has no `shape` field at all. Making `shape`
required would need a load-time migration (`docs/design/2026-08-01-magnifier-loupe.md`
already treats "no persisted format" as a design constraint — there is no format to
migrate). `shape?: "circle"` means "absent or `\"circle\"`" is the same case,
so old data stays valid with zero conversion.

## 2. Geometry — lens center `at` + full `width`/`height`

Mirrors the circle's center+radius convention (`at`, a center), not
`RectAnnotation`'s corner-pair convention (`a`/`b`) — this is deliberate: keeping
`at` a center is what lets `translateAnnotation`, the frozen-offset slide math
(`magnifierRectSlideUpdate`) and auto-placement (`placeRectLens`) stay center-based,
the same shapes the circle path already has. Derived source rect:
**`(width/zoom) x (height/zoom)`, centered on `from`.** `clampSampleRect`
(`magnifier.ts`) already operates on an arbitrary `Bounds`, so it is reused
unchanged for both shapes.

`magnifierSourceRect`/`magnifierLensRect` (`magnifier.ts`) and `boundsOf`'s
magnifier case (`bounds.ts`) become shape-aware (an `if (a.shape === "rect")`
branch each). `magnifierSourceRadius`/`clampZoom` stay **circle-only**, narrowed to
`CircleMagnifierAnnotation` — a rect magnifier has no single "radius", so its
source region is derived per-axis instead. Narrowing (rather than widening these to
accept the union and branch inside) is what makes the compiler flag every existing
caller (`render.ts`, `hittest.ts`, `resize.ts`, `canvas.ts`) that needs an
explicit rect answer, instead of silently calling circle-only math on a rect
annotation.

## 3. Connector — a straight-sided projection wedge, no arc

**Superseded by Addendum D §D8 (2026-08-08, reviewer bug B1, round 1) and
then by Addendum E (2026-08-08, reviewer bug B1, round 2): for a DIAGONAL
lens/source relation, the plain 4-point quad this section describes can cut
across the lens rect's own interior — and Addendum D's own first fix (the
`L±` "silhouette corners as seen from `from`", via `cross(u, corner −
from)`) turned out to still get this wrong in the near field and off-cardinal
placements, since that rule is an extreme perpendicular offset from the axis
LINE, not an angular extreme about a VIEWPOINT — the two agree only as
`dist(from, at) -> infinity`.** See "Addendum E" at the end of this note for
the corrected `L±` selection (each flank's tangent corner from that flank's
OWN endpoint `e±`, not from `from`) and the correctly-stated invariant; read
Addendum D §D8's own text as an intermediate, superseded step, not the
current rule. The description below is accurate only for the general SHAPE
of the construction (suppression guard, `e±` narrow end existing at all) —
read it together with Addendum E, not as authoritative on its own.

**Superseded again, wholesale, by Addendum G (2026-08-08, user requests (2)/(3)
from live iPhone testing): the whole single-polygon-with-a-narrow-end shape this
section and Addendum E describe is REPLACED by two independent CORNER-TO-CORNER
LINES (no shared apex, no fill) — see "Addendum G" at the end of this note. The
suppression guard (step 1 below) is KEPT, unchanged, and re-justified under the
new geometry; steps 2/3/4 (the `e±` narrow end, the `L±` silhouette-corner
selection, the quad fill) are gone entirely, not adapted.**

Addendum C gave the circle connector a lens-end ARC because a flat end sags away
from a curved rim by a size-dependent amount. A rect's rim has no curvature to sag
away from, so the rect connector needs no arc at all — a straight-sided wedge is
already flush at both ends.

```ts
function magnifierRectConnectorShape(
  sourceRect: Bounds, lensRect: Bounds, w1: number
): [Point, Point, Point, Point] | null   // [e+, L+, L-, e-], quad in draw order
```

1. **Suppression guard.** Two axis-aligned rects need a PER-AXIS rim gap, not the
   circle's single radius-sum test: `gx = max(0, |Δx| − (sourceRect.w/2 +
   lensRect.w/2))`, `gy` likewise; `null` when `hypot(gx, gy) <
   MAGNIFIER_CONNECTOR_MIN_GAP_PX` (the circle's constant, reused unchanged). This
   subsumes overlap and containment (both drive every axis's gap to 0) and,
   degenerately, `from === at` (both `|Δ|` terms are 0, so `gx = gy = 0 <
   MAGNIFIER_CONNECTOR_MIN_GAP_PX` — a positive constant — always trips the guard
   first, so the direction-vector division inside never sees a zero-length axis).
2. **Narrow end (`e+`/`e-`).** `p1` is where the ray `from -> at` exits the source
   rect's own boundary — for an axis-aligned rect this is a per-axis min-time
   raycast against an AABB (`tx = hw/|u.x|`, `ty = hh/|u.y|`, the smaller wins the
   binding wall), the rect analog of the circle's `c1 + r1·u`. `e+ = p1 + n·w1/2`,
   `e- = p1 − n·w1/2` (`n` the left-normal of `u`, `w1 = markerStroke` — the same
   "hidden under the marker band" trim rule the circle's `connectorShape` uses).
3. **Wide end (`L+`/`L-`).** The lens rect's two SILHOUETTE corners as seen from
   `from`: the pair with the most positive and most negative signed
   `cross(u, corner − from)`, ties broken toward the corner nearer `from`. Because
   `n` is `u` rotated +90°, the most-positive-cross corner pairs with `e+` and the
   most-negative with `e-` — this side-matching is what keeps the quad from
   self-crossing. The picked corners lie exactly ON the lens rect's outline by
   construction, buried under the lens border the same way the circle's arc lies
   exactly on the lens rim.
4. **Render.** Same two-pass as the circle: stroke the quad white at `lineWidth =
   4` (the house halo constant), then fill `a.color` — `render.ts`'s `drawMagnifier`
   dispatches to a rect branch that draws this quad instead of `connectorShape`'s
   arc-and-lines path, but the draw ORDER (connector → source marker → clipped
   content → lens border) and two-pass discipline are unchanged.

**Degenerate cases**, all handled by construction rather than a special case:

- **Overlapping/near-touching rects** — the suppression guard's `null` return,
  same editorial intent (not numerical necessity) as the circle's guard: a
  connector through an overlap communicates nothing the adjacency doesn't already
  say.
- **`from === at`** — covered by the guard, see step 1 above.
- **A silhouette tie** (a lens corner exactly on the `from -> at` axis, `cross ==
  0`) — broken toward the nearer corner, so a degenerate silhouette still picks a
  definite, stable pair rather than an arbitrary or unstable one.

## 4. Creation — slide-to-aim reused verbatim; wide text-line default

**Superseded by Addendum D §D11 (2026-08-08, reviewer nit N3): the `deriveRectLensSize`
steps below silently SQUARED UP the source (and lens) whenever the operability
floor lifted `sourceHalfH`, defeating `MAGNIFIER_RECT_ASPECT`'s whole point.**
See "Addendum D" at the end of this note for the fix (widen the source instead
of squaring it, and inherit the circle's preset zoom). The slide-to-aim
gesture itself (unaffected by D11) is still accurately described below.

`MAGNIFIER_RECT_ASPECT = 8/3` — deliberately wide, so a freshly-created rect lens
reads as a text-line strip rather than a small window; chosen over the
circle-derived square.

`deriveRectLensSize(size, canvasSize, limits)` composes the circle's own building
blocks rather than re-deriving them:

1. `sourceHalfW = defaultSourceRadius(canvasSize, limits)` — reused verbatim; the
   circle's "source radius" becomes the rect source's HALF WIDTH.
2. `sourceHalfH = max(sourceHalfW / MAGNIFIER_RECT_ASPECT, limits.minSource)` — the
   source rect is `MAGNIFIER_RECT_ASPECT` wide, floored at the operability minimum
   so a very wide/short source stays draggable.
3. `{radius: lensHalfW, zoom} = deriveLensSizeForSource(sourceHalfW, size,
   canvasSize, limits)` — reused verbatim on the WIDTH axis.
4. `lensHalfH = clamp(sourceHalfH * zoom, limits.minLens,
   MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h)` — the HEIGHT axis derives its own
   half-extent from the SAME zoom the width axis just settled on, capped per-axis
   against the canvas's own height (not `limits.maxLens`, which is short-side-based
   and already governs the width axis via step 3).
5. `zoom` is re-clamped once via a new `clampRectZoom` against the FINAL
   `lensHalfW`/`lensHalfH` pair — the same "recompute once from the clamped value"
   discipline `deriveLensSizeForSource` already documents for the circle, so a
   height-axis clamp in step 4 can never leave either axis's derived source
   half-extent below `limits.minSource`.

`placeRectLens`/`clampRectLensCenter`/`magnifierRectSlideUpdate` mirror
`placeLens`/`clampLensCenter`/`magnifierSlideUpdate` (both refactored around a
shared `clampCenterHalfExtents` core, so "keep a box fully on-canvas" has one
owner regardless of whether the box is a circle's bounding square or a rect's own
half-extents), taking independent per-axis half-extents (`halfW`/`halfH`) in place
of a single scalar radius. Candidate direction order (`PLACEMENT_DIRS`: E, W, S, N,
SE, SW, NE, NW) and the "first fully on-canvas candidate wins, else the
farthest-after-clamping candidate wins" fallback logic are unchanged.

`canvas.ts`'s slide-to-aim gesture (`onDown`/`onMove`) is otherwise unchanged: a
new `magnifierPlace` union (`{shape:"circle"; offset; radius; zoom} |
{shape:"rect"; offset; half: Point} | null`) and a new `magnifierRectGeometry(from)`
helper (mirroring `magnifierGeometry`) let `onDown` dispatch on `editor.magnifierShape`
once, at pointerdown; `onMove`'s draft-update branch dispatches on `this.draft.shape`;
`onUp` (commit + auto-select-and-switch-to-select) needs no shape branch at all.

## 5. Resize — 8 box handles + src-zoom grip; zoom stays uniform

**Superseded in part by Addendum D §D9/§D10 (2026-08-08, reviewer nits
N1/N2): the box-handle clamp described below (i) could silently break a
Shift-locked aspect ratio when a max cap tripped, and (ii) only clamped the
axis the dragged handle actually touched, leaving the other axis able to
stay out of range — a TASK-48 AC#6 regression.** See "Addendum D" at the end
of this note for the fix (uniform scale-back under Shift; both axes clamped,
the untouched one re-centered). The handle list and `src-zoom` mapping below
are unaffected by D9/D10 and still accurate.

**Superseded wholesale by Addendum I (2026-08-09, user decision after live
use of cube mode): the 8 box handles below move from the LENS to the SOURCE
rect, `zoom` stays FIXED during that drag (the lens follows as `source *
zoom`), and the `src-zoom` grip relocates to the LENS's own SE corner with an
inverted mapping — the exact inversion of this section's rule.** §D9/§D10's
CLAMP RULINGS survive verbatim, just re-expressed in source units — see
"Addendum I" at the end of this note. Kept below for the historical record of
what shipped through Addendum H, not the current behavior.

- **Handle list** (`resizeHandlesFor`, `resize.ts`): `[src-zoom grip,
  ...boxHandles(bounds)]` — 9 handles total, the grip still listed FIRST so it
  wins exact ties in `nearestHandle`. Grip position is the derived source rect's
  own SE corner — the rect analog of the circle's fixed `π/4` angle (which is
  ALSO geometrically SE from the source center).
- **Box-handle drag** (`applyMagnifierBoxResize`): reuses `resizeBox` — the exact
  function rect/image resize already share — so a corner drag pins the diagonally
  opposite corner and resizes both axes independently; an edge drag moves only
  that edge. `minPx = 2 * max(limits.minLens, zoom * limits.minSource)` (the same
  `lo` floor the circle's `applyMagnifierCornerResize` uses for its radius,
  doubled since `resizeBox` works in full dimensions, not half-extents), applied
  per axis via `resizeBox`'s own minimum-size clamp. A per-axis MAX clamp then
  keeps the anchored (non-dragged) edge fixed while capping that axis at
  `2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.{w,h}` — the rect analog of the
  circle's `limits.maxLens`, but per-axis and canvas-dimension-relative rather than
  short-side-relative, since a rect lens can legitimately be much longer on one
  axis than the other. Shift on a corner locks the pre-drag aspect ratio
  (`resizeBox`'s own built-in aspect-lock branch — the circle has no aspect
  concept to lock, so this is new behavior for the rect shape only).
  **`zoom` and `from` never change** on a box-handle drag — the source rect
  grows/shrinks with the lens, the same "corner resize never touches zoom"
  invariant the circle's center-pinned corner resize documents. **`at` DOES
  move** here (opposite-corner pinned), unlike the circle (whose lens center is
  resize-invariant under every gesture) — this follows directly from user
  decision 3 (free-aspect resize via 8 box handles, like a rect annotation) and is
  the one resize-semantics difference from the circle worth stating explicitly.
- **`src-zoom` drag** (`applyRectMagnifierResize`): `zoom = clampRectZoom(halfDiag
  / max(dist, ε), width, height, limits)`, `halfDiag = hypot(width, height)/2`
  standing in for the circle's `radius` term — so the dragged corner tracks the
  pointer exactly like the circle's rim point does (`zoom = radius/dist`). The new
  `clampRectZoom(z, width, height, limits)` keeps BOTH derived source
  half-extents `>= limits.minSource`:
  `clamp(z, MIN_ZOOM, min(MAX_ZOOM, min(width, height) / (2 * limits.minSource)))`
  — `min(width, height)` is the binding axis, since it derives the SMALLER of the
  two source half-extents. `width`/`height`/`at`/`from` never change on this
  gesture, same as the circle's `src-zoom`.
- **`applyResize` (`resize.ts`) gained a required 7th parameter, `canvasSize`** —
  read only by the rect-magnifier box-handle branch, for its per-axis max clamp.
  Every other kind (including circle magnifier) ignores it, the same "one
  parameter, one kind reads it, the rest ignore it" precedent Addendum B already
  set for `limits`. Required, not optional-with-a-default, so TypeScript forces
  the single real call site (`canvas.ts`'s resize branch) to supply it explicitly.
- `cursorForResizeHandle`/`anchorPointFor` need no functional change: the rect's
  8 handles reuse the SAME `BoxHandle` ids (`nw`/`n`/`ne`/`e`/`se`/`s`/`sw`/`w`)
  rect/image already use, so the existing directional-cursor and pinned-point
  logic for box handles already covers them; `anchorPointFor`'s magnifier case
  keeps returning `at` (technically imprecise for a rect box resize, since `at`
  DOES move there — see above — but this value is only ever consulted for a
  rotate-resize composition, and magnifiers cannot rotate
  (`canRotate("magnifier") === false`), so the inaccuracy is never actually
  exercised, the same "not really applicable" precedent `badge`/`highlight`
  already set for this same function).

## 6. Selection overlay

**§6's `drawZoomGrip` bullet is superseded by Addendum I (2026-08-09): the
grip itself relocates from the source rect's SE corner to the LENS's own SE
corner, and its outward-angle argument switches accordingly
(`atan2(a.height/2, a.width/2)` — the LENS's SE angle, not the source's). The
source tint, zoom readout, and delete-button avoidance bullets below are
unaffected and still accurate.** See "Addendum I" at the end of this note.

- **Source tint:** clip to the source RECT (instead of the source disc), then
  `evenodd`-fill a `Path2D` holding both the source rect and the lens rect — same
  clip-then-evenodd-punch technique the circle uses (`2026-08-06`'s round-1
  correction), generalized from `arc()` calls to `rect()` calls.
- **Zoom readout:** anchored at the source rect's NE corner + a fixed offset
  (the circle anchors at the source circle's own NE-ish point); the SW mirror
  placement is reused unchanged.
- **`drawZoomGrip`** gained an optional outward-angle parameter (default `π/4`,
  the circle's existing angle); the rect branch passes
  `atan2(sourceHalfH, sourceHalfW)` — the actual SE angle of the (generally
  non-square) source rect, so the grip's ridge orientation still reads as
  "radially outward from the source" instead of a fixed 45° that would look
  slightly off for a wide, short source rect. (Note: this parameter was
  documented here at the initial cube-mode design but not actually wired up
  in the first implementation pass — `drawZoomGrip` stayed hardcoded to
  `MAGNIFIER_ZOOM_HANDLE_ANGLE` for every magnifier shape. Reviewer bug B2;
  implemented per Addendum D §D12, 2026-08-08 — see the addendum at the end
  of this note.)
- **Delete-button avoidance:** the `AvoidCircle` radius is the source rect's
  half-diagonal (circumscribed around the rect, conservative) — the existing
  `deleteButtonCornerFor` machinery (a circle-vs-rect nearest-point test) is
  unchanged; only the radius fed into it differs per shape.

## 7. Mode toggle UI

`Editor.magnifierShape: "circle" | "rect" = "circle"` (session-scoped — not
persisted, not reset by tool switches, so the icon always reflects the current
mode with no `onToolChanged` hook needed) with `getMagnifierShape()`/
`toggleMagnifierShape()`, mirroring the badge tool's own `badgeFixedNumber` state
and its accessor pair.

`app.ts`'s toolbar click handler grows one more "already-active-tool, second tap"
branch, verbatim next to the badge tool's own: `if (btn.dataset.tool ===
"magnifier" && editor.tool === "magnifier") { updateMagnifierIcon(editor
.toggleMagnifierShape()); return; }` — placed before the generic
`editor.setTool(...)` fallthrough, so a second tap on the already-active magnifier
button toggles the lens shape instead of re-selecting the tool (which would be a
no-op anyway, but would also incorrectly close an open size/color popover).

Icon swap: `index.html` and `pwa/index.html` (kept in sync, same as every other
toolbar glyph pair) tag the existing circle-loupe SVG `data-magnifier-icon="circle"`
and add a hidden sibling `data-magnifier-icon="rect"` (a rect-loupe glyph). The
swap uses `toggleAttribute("hidden", …)`, not the `HTMLElement.hidden` IDL
property — `SVGElement` doesn't expose `hidden` as a typed property even though
the boundary attribute works identically at the DOM level, the same note
`badgebar.ts`'s own icon-swap code already carries.

## Deviations from a strict circle/rect mirror

- **`deriveRectLensSize`'s return shape** is `{sourceHalfW, sourceHalfH, width,
  height, zoom}`, not just `{width, height, zoom}` mirroring the circle's
  `{radius, zoom}`. It also hands back the intermediate source half-extents,
  because the rect path derives its OWN source half-height internally (step 2
  above has no circle counterpart to split the derivation from — the circle's
  `canvas.ts`-side `magnifierGeometry` computes `defaultSourceRadius` itself and
  feeds it to both `deriveLensSizeForSource` AND `placeLens`), and
  `canvas.ts`'s `magnifierRectGeometry` needs those same half-extents a second
  time, for `placeRectLens`. Returning them avoids a second, redundant
  derivation at the call site.
- **`anchorPointFor`'s magnifier case is imprecise for a rect box resize** (see
  §5) — documented there rather than fixed, since the imprecision is provably
  inert (magnifiers cannot rotate).

## Explicitly NOT changed

Every circle magnifier code path stays byte-identical: `connectorShape`,
`magnifierSlideUpdate`, `placeLens`, `clampLensCenter`, `applyMagnifierCornerResize`,
`deriveLensSizeForSource`, `magnifierSizeLimits`, `defaultSourceRadius`. Also
unchanged: `MagnifierPart`/`translateAnnotation`'s part-drag plumbing; history
(`structuredClone` already handles a discriminated union as plain data); the
exporter (magnifiers rasterize through the same `renderAnnotations` path every
other annotation does); crop translation; rotation exclusion (a rect lens is
equally rotation-unsafe — `canRotate` still excludes `"magnifier"` outright, not
per-shape); `magnifierSizeLimits`'s formula; keyboard shortcuts (`M` still selects
the magnifier tool, regardless of which shape it last used).

## IPC / API contract

None — `src/`-only, no Tauri commands, no Rust, no new dependency, nothing that
blocks the macOS port. New internal TS contracts, all in `src/editor/`:

```ts
// model.ts
export interface RectMagnifierAnnotation extends MagnifierBase {
  shape: "rect";
  width: number;
  height: number;
}
export type MagnifierAnnotation = CircleMagnifierAnnotation | RectMagnifierAnnotation;

// magnifier.ts
export const MAGNIFIER_RECT_ASPECT: number;
export function clampRectZoom(z: number, width: number, height: number, limits: MagnifierSizeLimits): number;
export function deriveRectLensSize(size: SizeName, canvasSize: {w:number;h:number}, limits: MagnifierSizeLimits):
  { sourceHalfW: number; sourceHalfH: number; width: number; height: number; zoom: number };
export function clampRectLensCenter(center: Point, halfW: number, halfH: number, canvasSize: {w:number;h:number}): Point;
export function placeRectLens(from: Point, sourceHalfW: number, sourceHalfH: number,
  lensHalfW: number, lensHalfH: number, canvasSize: {w:number;h:number}, gap: number): Point;
export function magnifierRectSlideUpdate(p: Point, frozen: { offset: Point; half: Point },
  canvasSize: {w:number;h:number}): { from: Point; at: Point };
export function magnifierRectConnectorShape(sourceRect: Bounds, lensRect: Bounds, w1: number):
  Point[] | null;   // 4 or 5 points as of Addendum D §D8 — was [Point,Point,Point,Point] pre-Addendum-D

// resize.ts
export function applyResize(original: Annotation, bounds: Bounds, handle: ResizeHandle,
  pointer: Point, shiftKey: boolean, limits: MagnifierSizeLimits,
  canvasSize: { w: number; h: number }): Annotation;   // canvasSize is a NEW, required 7th param

// canvas.ts (Editor)
getMagnifierShape(): "circle" | "rect";
toggleMagnifierShape(): "circle" | "rect";
```

## Process & verification

- `pnpm check` (TypeScript), `pnpm test` (vitest units — `magnifier.test.ts`,
  `resize.test.ts`, `hittest.test.ts`, `bounds.test.ts`, `model.test.ts` all gained
  rect-branch coverage), and `pnpm test:e2e` (Playwright — new
  `tests/e2e/magnifier-rect.spec.ts` plus the untouched
  `tests/e2e/magnifier.spec.ts` as the circle-regression gate) all pass.
- Final AC exercise in the running app is on Windows (`pnpm tauri dev` via
  PowerShell — WSL cannot compile the Tauri app); the backlog task stays In
  Progress until that hands-on pass happens, per this project's "Done means
  verified" rule.

## Addendum D — reviewer rulings (2026-08-08)

*Status: implemented. Binding rulings from the architect in response to the
`reviewer` agent's findings on the initial cube-mode diff (2 blocking issues,
B1/B2, plus non-blocking nits N1-N7). Appended verbatim below, per the
architect's own instruction; §3/§4/§5 above carry "superseded by Addendum D"
pointers where this addendum overrides them.*

### D8. B1 — the connector must not cover the lens interior: fix the geometry, not the paint

**Superseded again, wholesale, by Addendum G (2026-08-08): the polygon
construction this section specifies (and Addendum E's fix to it) is replaced
entirely by two corner-to-corner lines — see "Addendum G" at the end of this
note. Nothing below (the 4-or-5-point shape, the near-corner insertion, the
`pointInPolygon` interior-grid test) survives; it is kept for the historical
record only.**

**Superseded by Addendum E (2026-08-08, reviewer bug B1, round 2): the
`L±` selection rule this section ratifies (`cross(u, corner − from)`
extremes, i.e. "silhouette corners as seen from `from`") is not actually a
tangent/supporting-corner rule — it is an extreme PERPENDICULAR OFFSET FROM
THE AXIS LINE, which coincides with a true tangent corner (an angular
extreme about a VIEWPOINT) only as `dist(from, at) -> infinity`. This
section's own D8 test suite was far-field-only and so never caught it; the
reviewer's near-field and off-cardinal repros did. See "Addendum E" at the
end of this note for the corrected construction
(`tangentCornerIndex(corners, e±, sign)`) and the correctly-stated
no-interior invariant — this section's "Implementation"/"Invariant obtained"
text below is the SUPERSEDED rule, kept for the historical record of what
Addendum D actually shipped, not the current one.**

**Decision: option (b), the geometrically honest one.** `magnifierRectConnectorShape` returns the near-side lens *outline* between the two silhouette corners, not a chord. Option (a) (an `evenodd` clip in `drawRectMagnifier`) is rejected: it puts the invariant in the renderer while the geometry keeps lying, needs a canvas to test (the vitest suite is pure functions only), and would leave a second, silent owner of "where does the connector end" alongside the pure function. It is also conceptually the wrong analog: the circle's *arc* exists precisely so the wide end lies **on** the rim; the straight-sided analog of that arc is the rim polyline. §3's claim "no arc needed (straight rim edges)" is true only for cardinal relations — for a diagonal the near-side rim path has a bend (the near corner), and that missing bend is exactly bug B1.

**Spec.**

```ts
// magnifier.ts — signature change (single caller: render.ts's drawRectMagnifier)
export function magnifierRectConnectorShape(
  sourceRect: Bounds, lensRect: Bounds, w1: number,
): Point[] | null;   // [e+, L+, (nearCorner)?, L-, e-] — 4 or 5 points, closed by the caller
```

Body: keep steps 1-3 exactly as they are (suppression guard, `e±` from `trimmedRectConnectorAxis`, silhouette pair `L±` by extreme `cross(u, c - from)` with the "nearer corner wins" tie-break — that tie-break is load-bearing, it is what makes cardinal relations pick the near *edge*). Then add, tracking **indices** into `rectCorners(lensRect)` rather than point objects:

1. `iNear = argmin over corners of dot(u, c - at)` (first index wins ties).
2. If `iNear === iPlus || iNear === iMinus` → return the 4-point quad, byte-identical to today's output. (This is exactly the cardinal case; that is why B1 is diagonal-only.)
3. Otherwise return 5 points, `[e+, corners[iPlus], corners[iNear], corners[iMinus], e-]`.

Why at most one insertion, and why it is always adjacent to both silhouette corners: for a rect the four corner values of `dot(u, c - at)` are `±a ±b` (`a = |u.x|·hw`, `b = |u.y|·hh`); the strict min and strict max are the non-silhouette corners, and the two "middle" values are precisely the `cross`-extreme (silhouette) corners. So the far corner is always dropped, the near corner is inserted iff it is distinct, and `L+ → near → L-` walks two rect edges. Put that paragraph in the doc comment.

**Invariant obtained (state it in the doc comment):** the returned polygon never meets the lens interior. `L±` are supporting corners, so the whole lens lies on the `−n` side of the ray `from → L+` and the `+n` side of `from → L-`; `e±` are displaced *outward* along `±n`, which moves them further outside those supporting lines, so neither flank can dip in; the inserted rim path lies on the boundary. This replaces §3's "buried under the lens border" hand-wave, which only covered the corners, not the closing edge.

**render.ts:** `drawRectMagnifier` step 1 becomes `moveTo(pts[0])` + a `for` loop of `lineTo` + `closePath()`. Nothing else changes — no clip, no new state. The existing `lineJoin = "round"` wrap now also covers the two rim bends, which is why it stays.

**Unit test (magnifier.test.ts), all on the pure function — no render-level check needed:**
- Local helper `pointInPolygon(pts, p)` (even-odd ray cast) in the test file.
- Fixtures: source rect `60×30` at a fixed centre, lens rect `120×80` displaced in the 8 `PLACEMENT_DIRS` directions plus 2 obliques (e.g. `(+260, +70)` and `(−100, +240)`), separations well above `MAGNIFIER_CONNECTOR_MIN_GAP_PX`, `w1 = 6`.
- Per fixture assert: (i) result non-null; (ii) `length === 4` for the 4 cardinals, `length === 5` for the 4 diagonals and both obliques; (iii) every `L`/near point lies on the lens rect boundary (`x` or `y` equals an edge coordinate within `1e-9`, and the point is inside the closed rect); (iv) **for an 11×11 grid of strictly interior lens points (fractions `k/12`, `k = 1..11`, both axes), `pointInPolygon` is `false`** — the B1 regression contract; (v) the polygon is simple (no non-adjacent edge pair intersects) — extend the existing non-self-crossing test to the pentagon.
- Keep the existing suppression-guard and `from === at` tests untouched.

### D9. N1 — Shift aspect-lock survives the max clamp (uniform scale-back)

**Units only, re-expressed by Addendum I (2026-08-09) — the ruling itself
stands verbatim.** §D9/§D10 were written when the box handles resized the
LENS; Addendum I re-bases the same handles onto the SOURCE, so every `w`/`h`/
`minPx`/`maxW`/`maxH` term below is now a SOURCE-unit quantity (divided
through by `zoom`) — see "Addendum I" §I4 at the end of this note for the
re-expressed code. Nothing about WHICH axes get clamped, when the aspect
survives a tripped cap, or how the untouched axis gets re-centered has
changed; only the coordinate system the clamp operates in has.

**Decision: fix.** When either cap trips during an aspect-locked corner drag, **both** axes scale by the same factor about the pinned corner. On the min/max conflict: the per-axis floor wins over the aspect (a lens axis under `minPx` is unusable); that regime is documented, not prevented.

### D10. N2 — the max clamp touches both axes, center-pinned on the untouched one

**Decision: adopt.** TASK-48 AC #6 ("snap into range on their first size-affecting edit") is a regression contract. The untouched axis is clamped about its **pre-drag centre** (`a.at` on that axis), two-sided (`minPx` as well as the cap). `src-zoom` unchanged.

**Combined spec for `applyMagnifierBoxResize` (D9 + D10), replacing its current clamp block:**

```ts
const dir = BOX_HANDLE_DIR[handle];
const isCorner = (dir.west || dir.east) && (dir.north || dir.south);
const minPx = 2 * Math.max(limits.minLens, a.zoom * limits.minSource);
const box = resizeBox(bounds, handle, pointer, minPx, shiftKey);

const maxW = 2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.w;
const maxH = 2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h;
// "hi wins" — the same clamp discipline magnifierSizeLimits documents for its
// own bounds: on a degenerate canvas the cap beats the finger-sized floor.
const loW = Math.min(minPx, maxW);
const loH = Math.min(minPx, maxH);

let w = box.w;
let h = box.h;
if (shiftKey && isCorner) {
  // N1: resizeBox already produced an aspect-locked box; a per-axis pull-back
  // would silently break that ratio, so a tripped cap scales BOTH axes.
  const s = Math.min(1, maxW / w, maxH / h);
  if (s < 1) { w *= s; h *= s; }
}
// N2/TASK-48 #6: clamp BOTH axes, not just the dragged one. On the aspect-locked
// path this is a no-op except in the documented floor-vs-cap conflict regime,
// where the floor wins and the ratio is lost.
w = clamp(w, loW, maxW);
h = clamp(h, loH, maxH);

// Anchoring: an edge the handle moved keeps its opposite edge pinned; an axis
// the handle never touched is re-centred on its pre-drag centre (== a.at on
// that axis, since `bounds` is the pre-drag lens rect).
const cx = box.x + box.w / 2;
const cy = box.y + box.h / 2;
const x0 = dir.west ? box.x + box.w - w : dir.east ? box.x : cx - w / 2;
const y0 = dir.north ? box.y + box.h - h : dir.south ? box.y : cy - h / 2;
return { ...a, at: { x: x0 + w / 2, y: y0 + h / 2 }, width: w, height: h };
```

`zoom`/`from` still never change. Update the doc comments (two-axis clamp, uniform scale-back, TASK-48 #6 citation).

**resize.test.ts additions:** (1) Shift+corner drag on a canvas where the height cap trips → result aspect equals pre-drag aspect within `1e-9`; (2) oversized-on-both-axes rect magnifier dragged one pixel on `e` → both `width` and `height` within caps and `at.y` unchanged; (3) under-floor `height` snaps up to `minPx` centre-pinned on a `w` drag; (4) the source-min invariant (`width/zoom ≥ 2·minSource` and `height/zoom ≥ 2·minSource`) holds after every case above (this is also N7).

### D11. N3 — preserve the 8:3 default by widening the source, and inherit the circle's preset zoom

**Decision: adopt widening, plus:** the rect path takes the **zoom** the circle would have chosen for that preset and lets the lens width follow from the widened source, bounded by existing caps. Widening capped at `MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide`.

**Spec — `deriveRectLensSize` body, exact clamp order:**

```ts
const shortSide = Math.min(canvasSize.w, canvasSize.h);

// 1. Unchanged: the circle's own default source radius, as the rect's half WIDTH.
const baseHalfW = defaultSourceRadius(canvasSize, limits);

// 2. Unchanged: the aspect-derived half height, floored at the operability minimum.
const sourceHalfH = Math.max(baseHalfW / MAGNIFIER_RECT_ASPECT, limits.minSource);

// 3. NEW (N3): when step 2's floor LIFTED the half height, restore the aspect by
//    WIDENING instead of squaring up — capped by the same panorama guard
//    defaultSourceRadius uses, so the source can never swallow the image (and a
//    degenerate canvas, where minSource sits on the MIN_MAGNIFIER_SOURCE_RADIUS_PX
//    backstop, is left at baseHalfW). Identity when the floor did not bite.
const sourceHalfW = Math.max(
  baseHalfW,
  Math.min(MAGNIFIER_RECT_ASPECT * sourceHalfH, MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide),
);

// 4. The preset's zoom comes from the UNWIDENED source — i.e. it is exactly the
//    zoom the circle path would pick for this preset, so cube mode never
//    magnifies less than the circle does for the same S/M/L.
const { radius: baseLensHalfW, zoom: zoom0 } = deriveLensSizeForSource(baseHalfW, size, canvasSize, limits);

// 5. Lens half-extents at that zoom; the width axis carries the widening factor,
//    so lens aspect == source aspect exactly.
let lensHalfW = baseLensHalfW * (sourceHalfW / baseHalfW);
let lensHalfH = sourceHalfH * zoom0;

// 6. Caps shrink BOTH axes by one factor — the aspect is the whole point of cube
//    mode, so a cap must not skew it. Width cap stays limits.maxLens; height
//    cap stays MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h.
const s = Math.min(1, limits.maxLens / lensHalfW, (MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / lensHalfH);
if (s < 1) { lensHalfW *= s; lensHalfH *= s; }

// 7. Floors last, per axis, never above that axis's own cap (hi wins). Rare; when
//    one bites the aspect is lost — documented, not prevented.
lensHalfW = Math.max(lensHalfW, Math.min(limits.minLens, limits.maxLens));
lensHalfH = Math.max(lensHalfH, Math.min(limits.minLens, MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h));

// 8. Unchanged: one re-clamp of the zoom against the FINAL pair.
const zoom = clampRectZoom(zoom0, 2 * lensHalfW, 2 * lensHalfH, limits);

// 9. NEW: return the source half-extents the annotation will ACTUALLY have
//    (source == lens / zoom), not the pre-clamp intermediates — placeRectLens
//    computes its gap from these, and after step 6/7 the intermediates can differ.
return {
  sourceHalfW: lensHalfW / zoom,
  sourceHalfH: lensHalfH / zoom,
  width: 2 * lensHalfW,
  height: 2 * lensHalfH,
  zoom,
};
```

(Adapt the `clampRectZoom` call to its actual current signature if it differs — the semantic is: re-clamp zoom0 against the final width/height pair.)

**Expected values (hand-computed by architect) to check against:**

**Superseded by Addendum G §G2 (2026-08-08): step 2's floor
(`limits.minSource`, above) became `limits.minRectSource` — the rect's own,
much smaller, legibility-only floor — so it binds far less often, and every
row below except the first two changed. See "Addendum G" at the end of this
note for the recomputed table; the table immediately below is kept for the
historical record of what Addendum D actually shipped, not the current
values.**

| canvas / scale / preset | after |
| --- | --- |
| 1000×800, s=1, M | identical to before (no widening): src 60/22.5, lens 300×112.5, zoom 2.5 |
| 10×10, s=0.01, S | identical to before (widening capped away) |
| 600×500, s=1, M | src 53.33/20, lens 266.67×100, zoom 2.5 (aspect exactly 8:3) |
| 2048×1536, s=5, M | src 230.4/100, lens 1152×500, zoom 2.5 (aspect 2.30) |
| 1170×2532, s=3.55, S | src 175.5/71, lens 643.5×260.3, zoom 1.833 (aspect 2.47) |

Update the existing `deriveRectLensSize` "floor pass" test to the new numbers, rename it ("floor pass: the minSource floor widens the source instead of squaring the lens"), add an assertion `result.width / result.height ≈ MAGNIFIER_RECT_ASPECT` for that case, and add a post-condition-table row for `{ M, 2048×1536, scale 5 }` asserting lens aspect `> 2`. The other tests must still pass unchanged.

### D12. Confirmations
- **B2** — implement the optional angle parameter on `drawZoomGrip` (`angle = MAGNIFIER_ZOOM_HANDLE_ANGLE` default; rect call passes `Math.atan2(srcHalfH, srcHalfW)`).
- **N4** — correct the stale `applyResize` signature at `docs/ARCHITECTURE.md:152` to the 7-parameter form (with `canvasSize`).
- **N5** — extend the `styles.css` `svg[hidden]` comment: two owners now (badge + magnifier).
- **N6** — hoist the duplicated `magnifierSourceRect(a)` call in canvas.ts's overlay path to a local.
- **N7** — folded into D10's test (4).
- **Toolbar titles** — static hint in both `index.html` and `pwa/index.html` (e.g. "Magnifier (M) — tap again for rectangle lens"), badge title untouched. Do **not** make the title dynamic on toggle (icon is the mode indicator; one property, one owner).

### Implementation tasks (in order)
1. magnifier.ts — `magnifierRectConnectorShape` (D8): Point[] return, iNear insertion, doc comment with invariant paragraph.
2. render.ts — `drawRectMagnifier` (D8): moveTo + lineTo loop + closePath. No clip.
3. magnifier.ts — `deriveRectLensSize` (D11): replace body with the 9-step order; rewrite doc comment.
4. resize.ts — `applyMagnifierBoxResize` (D9+D10): replace clamp block; update doc comments.
5. canvas.ts — drawZoomGrip angle param (B2) + magnifierSourceRect hoist (N6).
6. Docs: append this addendum to docs/design/2026-08-08-magnifier-cube-mode.md as "Addendum D — reviewer rulings"; add "superseded by Addendum D" pointers in §3/§4/§5; fix ARCHITECTURE.md:152 (N4) — and also fix the ARCHITECTURE.md/design-doc claims about drawZoomGrip so they now match the implemented reality; extend styles.css comment (N5).
7. Toolbar title strings in index.html + pwa/index.html.
8. Unit tests per D8/D10/D11.
9. Verify: `pnpm check`, `pnpm test`, `pnpm test:e2e` (magnifier.spec.ts must pass untouched; also re-run your magnifier-rect.spec.ts — if the D11 default-size change breaks its mirrored constants, update the spec's mirrored arithmetic accordingly, with the "must be updated if retuned" comment style).

## Addendum E — connector corner selection (B1, round 2, 2026-08-08)

*Status: implemented. Amends Addendum D §D8 (§D9/§D10/§D11 stand as
verified — unaffected by this addendum). `src/editor/`-only; no IPC, no
Rust, nothing that blocks the macOS port.*

**Root cause.** `cross(u, c − from)` (the D8 corner-selection rule) is a
LINEAR functional along `n` (the extreme perpendicular offset from the axis
*line*), not an ANGULAR extreme about a *viewpoint*. Those two coincide only
as `dist(from, at) -> infinity`, which is why D8's own far-field test
fixtures all passed. D8's doc-comment proof asserted "extreme cross product
⇒ supporting corner"; that implication is false, so both the code and the
proof needed to change.

Reproduced by hand before ruling: 1920×1080 M preset (source 230.4×86.4,
lens 576×216), lens centre 5° off due-south — the shipped (D8) rule picks
`L+ =` the FAR bottom-left corner (cross 296.4 vs 277.5), giving a chord
straight across the lens. The tangent-from-`e±` rule (below) picks the near
top-left/top-right pair — the near *edge* — which is also continuous with
the exact-cardinal answer.

### E1. Ratified: each flank's lens corner is the tangent corner **from that flank's own endpoint**

**Superseded by Addendum G (2026-08-08): the tangent-corner-from-`e±`
construction below (and its `tangentCornerIndex` helper) is deleted, not
adapted — the corner-to-corner bridge model (`connectorBridge`, Addendum G
§G4) finds both connector endpoints directly, without an intermediate `e±`
narrow-end point at all. Kept here for the historical record.**

**Decision: adopt the reviewer's construction verbatim.** `L+` is the
angular extreme of the lens rect about `e+`; `L−` about `e−`. Tangent-from-
`from` was also considered and explicitly rejected (a sweep against it still
left 401 interior-coverage and 7,876 self-intersection cases at low zoom,
where the source is large and `e±` sit far from `from`): the segment that
must not cut the lens is `e+ → L+`, so the supporting line must pass
through `e+`, not through `from`. `cross(u, c − from)` selection is
**deleted, not kept as a fallback**.

**Implementation (replaces the pre-Addendum-E `magnifierRectConnectorShape`
selection block), including the E3 tie-break and the E2 insertion:**

```ts
/**
 * Index of the corner of `corners` that is the angular extreme about `p` in
 * direction `sign` (+1: every other corner j satisfies
 * cross(corners[i] - p, corners[j] - p) <= 0; -1: >= 0). Precondition: `p` is
 * strictly outside the convex hull of `corners` (guaranteed by the guard in
 * `trimmedRectConnectorAxis`) — that is what makes the angular order about `p`
 * TOTAL (a convex body subtends < 180 deg at an external point), so this
 * single pairwise scan is well-defined. Collinear ties (two corners on one ray
 * from `p`) resolve to the NEARER corner, so the flank ends at the first
 * boundary point instead of running along an edge and past it.
 */
function tangentCornerIndex(corners: readonly Point[], p: Point, sign: 1 | -1): number {
  let best = 0;
  for (let j = 1; j < corners.length; j++) {
    const ax = corners[best].x - p.x, ay = corners[best].y - p.y;
    const bx = corners[j].x - p.x, by = corners[j].y - p.y;
    const cr = ax * by - ay * bx;
    if (cr * sign > 0) best = j;
    else if (cr === 0 && bx * bx + by * by < ax * ax + ay * ay) best = j;
  }
  return best;
}

// ...inside magnifierRectConnectorShape, after ePlus/eMinus:
const corners = rectCorners(lensRect);
const iPlus = tangentCornerIndex(corners, ePlus, 1);
const iMinus = tangentCornerIndex(corners, eMinus, -1);
const lPlus = corners[iPlus];
const lMinus = corners[iMinus];

// E2: insert the near-side rim vertex, if there is one — the unique remaining
// corner on the SAME side of the chord L+..L- as the source centre.
const ex = lMinus.x - lPlus.x;
const ey = lMinus.y - lPlus.y;
const sideOf = (q: Point): number => Math.sign(ex * (q.y - lPlus.y) - ey * (q.x - lPlus.x));
const sideFrom = sideOf(from);
let iNear = -1;
for (let i = 0; i < corners.length; i++) {
  if (i === iPlus || i === iMinus) continue;
  if (sideFrom !== 0 && sideOf(corners[i]) === sideFrom) { iNear = i; break; }
}

return iNear < 0 ? [ePlus, lPlus, lMinus, eMinus] : [ePlus, lPlus, corners[iNear], lMinus, eMinus];
```

**The invariant, correctly stated (this paragraph replaces D8's "supporting
corners" block in the doc comment):**

> Let `P` be strictly outside the closed lens rect `K` — guaranteed for both
> `e+` and `e−` by the band-aware guard (E4). `K` is convex, so it subtends
> less than 180° at `P`; its corners therefore have a *total* angular order
> about `P`, whose two extremes are exactly the tangent corners, and `K`
> lies in the closed wedge between the two supporting rays. `L+` is the `+`
> extreme about `e+`, so `K ⊆ { q : cross(L+ − e+, q − e+) ≤ 0 }`: the flank
> `e+ → L+` lies **on the boundary line of a half-plane that contains all of
> `K`**, hence meets `K` only on `K`'s boundary — and only at `L+`, because
> the collinear tie-break ends the flank at the nearest boundary point
> rather than letting it run along an edge. Symmetrically for `e− → L−`.
> The middle chain runs along the rim by construction. The base edge
> `e− → e+` lies inside the source rect inflated by `w1/2`, which the guard
> makes disjoint from the lens rect. No edge of the polygon crosses the lens
> interior; the polygon is simple; therefore its interior is disjoint from
> the lens interior. Note what is *not* claimed: extremity of
> `cross(u, c − from)` (perpendicular offset from the axis line) is **not**
> angular extremity about a viewpoint — the two agree only in the far field,
> and assuming they agreed was reviewer bug B1's second round.

Bonus property worth one sentence in the comment: unlike the deleted rule,
this one is **continuous through the cardinals** (a 2°-off-south lens picks
the same near edge as a due-south one), so there is no visual snap as the
user drags past an axis.

### E2. Near-corner insertion: kept, but selected by the chord-side test

**Superseded by Addendum G (2026-08-08): the near-corner insertion concept
this section keeps is deleted outright — there is no more polygon to keep
off the lens rim, so there is nothing to insert a vertex into. Kept here for
the historical record.**

**Decision: keep the insertion, replace its selection rule.** D8's
`iNear = argmin dot(u, c − at)` happened to agree with the correct answer in
every case checked, but its *justification* was the same middle-vs-extreme
case analysis that B1 round 2 just falsified, and it needed a separate
`iNear === iPlus || iNear === iMinus` special case. The chord-side test
above is tied directly to the property actually needed and subsumes that
special case.

**At most one insertion, always adjacent — the correct argument:**

- `L+` and `L−` are corners of a rect, so they are either **adjacent**
  (share an edge) or **diagonal**. There is no third possibility.
- *Diagonal*: the chord is a diagonal of the rect; the two remaining corners
  lie on **opposite** sides of it, so exactly one matches `sideFrom`, and
  that corner is adjacent to both `L+` and `L−` on the perimeter — the walk
  `L+ → near → L−` traverses exactly two rect edges, never a jump across the
  interior.
- *Adjacent*: the chord is an edge of the rect, and the rect lies entirely
  on one side of its own edge — the side *away* from `from` (the tangent
  chord separates the viewpoint from the far corner). So neither remaining
  corner matches `sideFrom`: no insertion, and the result is the 4-point
  quad, unchanged in shape from cardinal placements today.
- `sideFrom === 0` (source centre exactly on the chord line) is unreachable
  for the same separation reason; the code degrades to the quad rather than
  branching on it.
- If `iPlus === iMinus` (would need a degenerate lens), the result is a quad
  with a duplicated vertex — a zero-length segment that `Path2D` fill/stroke
  handles harmlessly. Documented, not branched.

Drop `at` from the `trimmedRectConnectorAxis` destructure in this function
once it becomes unused (it is, per E2's rule — the insertion no longer needs
`at`, only `from`).

### E3. Tie-break machinery: deleted and replaced

**Superseded by Addendum G (2026-08-08): the tangent-corner collinear
tie-break this section describes goes away along with `tangentCornerIndex`
itself (E1) — `connectorBridge` (Addendum G §G4) has its own tie-break, a
shortest-bridge-length rule over the 4×4 corner-pair scan, unrelated to this
one. Kept here for the historical record.**

**Decision: delete** `nearestAtMax`/`nearestAtMin` and the `dist` from
`from`. Their stated purpose (make a cardinal relation pick the near *edge*)
is now produced by the tangent rule itself — verified by hand: source due
west, `e± = (10, ±3)`, lens `x ∈ [70,130], y ∈ [−20,20]` ⇒ `L+ = (70,20)`,
`L− = (70,−20)`, the near edge, with no tie-break involved.

They are **not** deleted without replacement: the collinear case moves into
`tangentCornerIndex` as "on `cr === 0`, the nearer corner to `p` wins".
Different reference point (`e±`, not `from`), different trigger (exact
collinearity, not equal cross), and it is load-bearing for the E1 invariant
(it is what stops a grazing flank from running along an edge and re-entering).

### E4. Degenerate branch: **suppress**, by folding the band width into the existing guard

**Kept, unlike E1/E2/E3, by Addendum G (2026-08-08) — with a NEW
justification.** The `w1/2`-inflated gap test below survives the corner-to-
corner bridge rewrite essentially verbatim (it moves into
`magnifierRectConnectorLines` itself, `trimmedRectConnectorAxis` having been
deleted along with `e±`), but its precondition argument changes: it no
longer needs to guarantee `e±` sits strictly outside the lens (there is no
more `e±`) — instead it guarantees the two rects are far enough apart that
`connectorBridge`'s "all corners on one side" tangent-pair search is
well-defined and meaningful (a connector through a near-touching or
overlapping pair communicates nothing the adjacency doesn't already say,
same editorial intent as ever). See "Addendum G §G4" at the end of this note
for the restated justification in full.

**Decision: suppress (`null`), and do it inside the existing suppression
guard rather than as a separate `-1`-index branch.** `trimmedRectConnectorAxis`
gains a third parameter `w1`, and both gaps inflate the *source* half-extents
by `w1/2`:

```ts
function trimmedRectConnectorAxis(sourceRect: Bounds, lensRect: Bounds, w1: number): {...} | null {
  const from = rectCenter(sourceRect);
  const at = rectCenter(lensRect);
  const gx = Math.max(0, Math.abs(at.x - from.x) - (sourceRect.w / 2 + w1 / 2 + lensRect.w / 2));
  const gy = Math.max(0, Math.abs(at.y - from.y) - (sourceRect.h / 2 + w1 / 2 + lensRect.h / 2));
  if (Math.hypot(gx, gy) < MAGNIFIER_CONNECTOR_MIN_GAP_PX) return null;
  /* ...unchanged... */
}
```

**Why this is the right shape.** `e±` and the whole base edge lie within
`w1/2` of `p1`, and `p1` is on the source rect's boundary — so the base edge
is contained in the source AABB inflated by `w1/2`. `hypot(gx, gy) ≥
MAGNIFIER_CONNECTOR_MIN_GAP_PX > 0` forces at least one axis to be strictly
separated, which makes that inflated AABB disjoint from the lens AABB. That
single change delivers *both* preconditions E1 needs (`e±` strictly outside
`K`, base edge outside `K`) and keeps **one owner** of suppression — no
second guard, no unguarded `-1`. It strictly widens the old guard
(`w1 > 0`), so it never *adds* a connector anywhere.

**When it fires despite the old guard passing.** The old gap is measured
rect-to-rect, but the connector's own band sticks out `w1/2`
**perpendicular** to the axis. When the axis is near-vertical while the two
rects overlap vertically and are separated by only a few px horizontally (a
tall lens dragged alongside the source — reachable via the source/lens body
drags), `e−` or `e+` can land inside the lens even though `gx ≈ 3 ≥ 2`.
Worked example: source `{x:−50,y:−20,w:100,h:40}`, lens
`{x:55,y:−170,w:40,h:400}`, `w1 = 30` ⇒ old `gx = 5` (passes), `e− ≈ (55.6,
6.1)` inside the lens; inflated `gx' = 0` ⇒ `null`.

**What the user sees:** nothing new. In that regime the source and lens are
within a stroke width of touching and the connector was already a
sub-stroke-width stub — precisely the "a connector through an overlap
communicates nothing the adjacency doesn't already say" case the guard's
editorial intent has documented since Addendum B. A *fallback* (clamping
`e±`, or reverting to a chord) is rejected: it would put ink back across the
magnified content, which is the bug being fixed.

**Churn note:** any existing suppression unit test whose fixture sits within
`w1/2` of the old threshold flips to `null`. That is the intended new
behaviour — the affected fixtures (the original `magnifierRectConnectorShape`
suppression-guard tests) were moved to the new, correct threshold rather
than the guard being weakened to keep them passing; see the implementer's
report for the exact before/after numbers. Fixtures with generous separation
(the D8 suite) are unaffected.

### E5. Unit-test additions (magnifier.test.ts)

Shared helpers: `pointInPolygon(pts, p)` (even-odd ray cast),
`segmentsProperlyIntersect(a,b,c,d)`, and one
`assertConnectorSane(sourceRect, lensRect, w1)` that, for a non-null result,
asserts: (a) length 4 or 5; (b) every lens-side point lies on the lens rect
boundary within `1e-9`; (c) **no point of an 11×11 interior grid (fractions
`k/12`, `k = 1..11`) is inside the polygon**; (d) no non-adjacent edge pair
properly intersects.

1. **Parameterise the D8 suite** over `dist ∈ {300, 450}` × lens size
   `∈ {120×80, 576×216}` (8 directions + 2 obliques each) through
   `assertConnectorSane`. This alone would have caught the bug.
2. **Near-field repro (regression contract for B1 round 2):** source
   `230.4×86.4` centred at the origin, `w1 = 5.4`, lens `576×216` at centres
   `(60, −420)` and `(−40, 400)` — the reviewer's own cases. Assert
   `assertConnectorSane`, and pin the selected corners explicitly (`L+`/`L−`
   are the two corners of the lens edge facing the source), so a future rule
   change cannot silently re-break it while still passing the coverage probe.
3. **Off-cardinal band:** for each of the 4 cardinals, lens centre rotated
   by `±2°`, `±8°`, `±14°` at `dist = 400` (the reviewer's failing bands).
   Assert `assertConnectorSane` **and** `length === 4` at `±2°` (near-cardinal
   must still resolve to the near edge — the continuity property).
4. **Sweep:** 120 angles (3° steps) × `dist ∈ {1.2, 1.5, 2.5}` × source/lens
   pairs taken from two real creation presets, all through
   `assertConnectorSane`. Pure arithmetic, well under a second; skip
   non-null assertions (suppressed configs are legitimate).
5. **Insertion rule:** a 45° diagonal case asserts `length === 5` and that
   the inserted vertex is the corner nearest the source; a cardinal case
   asserts `length === 4`.
6. **Guard (E4):** the worked fixture above returns `null`; and a control
   fixture with the same rects moved 20 px further apart returns non-null
   (the inflation must not suppress ordinary configurations).
7. Delete or rewrite any existing test that asserted the
   `cross(u, c − from)` selection or the `from`-distance tie-break — they
   encode the wrong rule.

**Verification scope note:** cardinal placements are pixel-unchanged, so
`magnifier-rect.spec.ts` and `magnifier.spec.ts` should pass untouched;
diagonal and near-cardinal connectors change shape, so TASK-50's device
pass must re-check a diagonal auto-placement and a dragged-lens
configuration on Windows before the task leaves In Progress.

### E6. Documentation rewrites (same pass)

1. `docs/design/2026-08-08-magnifier-cube-mode.md` — append this note as
   "Addendum E — connector corner selection (B1, round 2)"; add "superseded
   by Addendum E" pointers on §3 step 3, on Addendum D §D8's step 3 and its
   invariant block.
2. `docs/ARCHITECTURE.md`'s *Connector* bullet — rewrite: pentagon-or-quad
   `[e+, L+, (near)?, L−, e−]`; wide end = tangent corner from each flank's
   own endpoint `e±`; near-side rim vertex by the chord-side test;
   suppression guard is per-axis AABB rim gap **with the source inflated by
   `w1/2`**; state the no-interior invariant in one sentence.
3. `docs/ARCHITECTURE.md`'s *Creation* bullet — rewrite to Addendum D §D11:
   the `minSource` floor **widens the source** (capped at
   `MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide`) instead of squaring the
   lens; the preset **zoom** comes from the unwidened source; caps shrink
   both axes by one factor; floors last, per axis.
4. `docs/ARCHITECTURE.md`'s *Resize* bullet — rewrite to §D9/§D10: the max
   clamp applies to **both** axes (untouched axis centre-pinned, TASK-48 AC
   #6), the floor is two-sided with `hi wins` (`lo = min(minPx, max)`), and
   a Shift-locked corner drag scales **both** axes by one factor when a cap
   trips, the floor winning in the documented conflict regime.
5. `docs/ARCHITECTURE.md`'s *Deviation from a strict mirror* bullet —
   `deriveRectLensSize` returns the **final** source half-extents
   (`lens / zoom`, the annotation's true derived source per D2), not the
   pre-clamp intermediates; keep the "why it returns them at all" rationale
   (`placeRectLens`).

### Implementation tasks

1. **magnifier.ts** — add `w1` to `trimmedRectConnectorAxis` and inflate
   both gaps by `w1/2`; update its doc comment (new clause + when it fires +
   what the user sees).
2. **magnifier.ts** — add `tangentCornerIndex`; replace the
   selection/insertion block in `magnifierRectConnectorShape` with the code
   in E1/E2; delete the `cross(u, ·)` scan and the `nearestAt*` tie-break;
   rewrite steps 3–4 and the invariant block of the doc comment per E1/E2
   (including the explicit "cross-extreme ≠ angular extreme" caveat).
3. **magnifier.test.ts** — the seven items in E5.
4. **Docs** — the five rewrites in E6.
5. **Verify** — `pnpm check`, `pnpm test`, `pnpm test:e2e`; then the device
   pass noted in E5.

`render.ts` needs no further change — it already iterates the returned
point list via a `moveTo` + `lineTo` loop (added in Addendum D's own D8
implementation task, before this addendum existed).

## Addendum F — creation gap must clear the band-aware guard (post-E4, 2026-08-08)

*Status: implemented. Amends Addendum E §E4's interaction with creation.
Ruling only; `src/`-only, no IPC/Rust, macOS-neutral.*

**Problem (round-3 review finding).** Addendum E's guard correctly inflates
the SOURCE half-extents by `markerStroke/2` when deciding whether a
connector should draw — but the CREATION-TIME placement gap
(`MAGNIFIER_GAP_PX`, bare, rect-to-rect) was never inflated to match. On the
web target's large `docScale`, `markerStroke/2` can exceed
`MAGNIFIER_GAP_PX - MAGNIFIER_CONNECTOR_MIN_GAP_PX`, so a freshly created
rect magnifier's own connector is silently suppressed on creation — e.g. a
2532×1170 iPhone photo at the L preset: `strokeWidth ~= 33.8`,
`markerStroke/2 ~= 15.2 > MAGNIFIER_GAP_PX (12)`.

### F1. Ruling: option 1, inflate the gap argument at the rect call site by `markerStroke / 2`

**Decision.** `magnifierRectGeometry` (`canvas.ts`) passes

```ts
const gap = MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth) / 2;
```

to `placeRectLens`, where `strokeWidth` is the EFFECTIVE creation stroke
(`base.strokeWidth`, i.e. `this.strokeWidth * this.docScale`) threaded in as
a new second parameter:

```ts
private magnifierRectGeometry(from: Point, strokeWidth: number): { at: Point; width: number; height: number; zoom: number }
// call site (onDown's magnifier branch): this.magnifierRectGeometry(p, base.strokeWidth)
```

**Rationale — this is not a fudge factor, it is the same quantity on both
sides.** The source marker is stroked CENTERED on the source rect's
boundary, so the painted rim extends `markerStroke / 2` beyond
`magnifierSourceRect`, and that is exactly the term Addendum E's guard
subtracts. With the inflation, `MAGNIFIER_GAP_PX` becomes "clear space
between the PAINTED source rim and the lens rect" — a better definition than
the current rect-to-rect one — and yields the invariant: **a freshly
created rect magnifier always clears its own suppression guard by
`MAGNIFIER_GAP_PX` (12 px), versus the 2 px `MAGNIFIER_CONNECTOR_MIN_GAP_PX`
minimum.** It also self-corrects if `MAGNIFIER_MARKER_STROKE_RATIO` is ever
retuned again (it was, in TASK-49).

**Why not `max(MAGNIFIER_GAP_PX, w1/2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX)`:**
it keeps the desktop number at exactly 12 but clears the guard by only 2 px
in the web case — a stub connector, which the guard's own doc comment calls
out as rendering "as a blob". The sum form degrades gracefully instead of
sitting on the threshold. The desktop change it causes (12 → 14.7 px
placement reach for the rect lens only) is invisible in kind and touches no
Done AC: the rect variant is TASK-50, still In Progress.

**Why not option 2 (scale `MAGNIFIER_GAP_PX` by `docScale` for both
shapes).** Two independent reasons: (a) it changes CIRCLE creation layout,
which is device-verified Done surface (TASK-46 #2/#8, TASK-48, TASK-49) for
a problem the circle does not have — `trimmedConnectorAxis` has no
band-width term, so a circle connector is suppressed only on true rim
overlap; (b) `docScale` is the wrong variable. The guard subtracts `w1/2`,
not a global scale; tying the fix to `docScale` would be correct only by
coincidence today and would drift the moment the marker ratio or the scale
curve changes. Fix the term that is actually subtracted.

Option 3 (accept + document) is rejected: a silently missing connector is
unexplainable to the user, and it fails TASK-50 AC #2 on the PWA's main
import path.

### F2. One-owner cleanup that comes with it

`Math.max(1, strokeWidth * MAGNIFIER_MARKER_STROKE_RATIO)` was written out
independently at `render.ts` (twice — `drawCircleMagnifier` and
`drawRectMagnifier`) and `hittest.ts`'s `magnifierHitPart`; `canvas.ts`
became the fourth. This whole bug IS a drift between two expressions of one
quantity, so it is extracted next to the constant that defines it:

```ts
// render.ts, immediately below MAGNIFIER_MARKER_STROKE_RATIO
export function magnifierMarkerStroke(strokeWidth: number): number {
  return Math.max(1, strokeWidth * MAGNIFIER_MARKER_STROKE_RATIO);
}
```

and called from all four sites. `render.ts` is the right home (it owns the
ratio; `hittest.ts` already imports from it; `magnifier.ts` must NOT import
`render.ts` — that would create a cycle, since `render.ts` imports
`magnifier.ts`'s geometry helpers).

### F3. `placeRectLens` itself is unchanged — only the gap argument

**Ruling: do not add a `w1` term inside `placeRectLens`.** It is a pure
"place a box with `gap` clearance" function whose circle twin has no such
parameter; `distX`/`distY` both derive from the single `gap` argument, so an
inflated gap already covers both axes and all 8 `PLACEMENT_DIRS` uniformly.
Putting the term inside would also double-count for any future caller that
pre-inflates.

Two consequences recorded in `magnifierRectGeometry`'s own doc comment
rather than "fixed":

- **Clamp fallback.** When no candidate fits (canvas too small for source +
  gap + lens), `placeRectLens` returns a clamped candidate and the
  clearance can fall below the guard — the one documented exception to the
  F1 invariant. Same for the circle, which simply overlaps there.
- **Slide-to-aim.** `magnifierRectSlideUpdate` translates a frozen `offset`,
  so the creation clearance is preserved for the whole gesture, except
  where the per-frame on-canvas clamp pulls the lens back toward the source
  at a canvas edge. Pre-existing, shape-symmetric, and legitimate (the user
  is pushing them together) — not to be "corrected".

### F4. Unit tests (magnifier.test.ts)

1. **Reviewer's repro, pinned.** `canvasSize = { w: 2532, h: 1170 }`, preset
   `L`, `strokeWidth = STROKE_PRESETS.L * computeAnnotationScale(2532,
   ANNOTATION_SCALE_BASELINE)` (≈ 33.8). Build the annotation from
   `deriveRectLensSize` + `placeRectLens(..., MAGNIFIER_GAP_PX +
   magnifierMarkerStroke(strokeWidth) / 2)`, then assert
   `magnifierRectConnectorShape(magnifierSourceRect(a), magnifierLensRect(a),
   magnifierMarkerStroke(a.strokeWidth))` is NOT null. Uses
   `magnifierSourceRect`/`magnifierLensRect` (not raw half-extents) so the
   test exercises the geometry the renderer actually feeds the guard.
2. **Negative control (pins the bug).** Same fixture, gap = bare
   `MAGNIFIER_GAP_PX` ⇒ null. Commented as "this is the pre-Addendum-F
   behaviour; if this stops being null, the guard or the marker ratio moved
   and F1's arithmetic needs re-checking".
3. **Parametric invariant.** For presets S/M/L × `docScale ∈ {1, 2.81, 6}` ×
   canvas sizes `{2532×1170, 1920×1080, 4000×3000}`, with `from` at the
   canvas centre (so a cardinal candidate always fits, keeping the
   clamp-fallback exception out of scope): the connector is non-null for
   every combination — "a fresh rect magnifier always clears its own guard".

### F5. Two nits, both taken

- **(a)** In the near-field repro tests (Addendum E §E5.2),
  `expect(poly).toHaveLength(4)` (or `5`) BEFORE reading `poly[1]` /
  `poly[n-2]` as `L±`. Cheap, and it stops a shape change from silently
  re-interpreting indices.
- **(b)** The `assertConnectorSane` doc comment now states explicitly that a
  `null` (suppressed) input passes vacuously, AND the E5.4 dense sweep now
  asserts a floor on non-suppressed configurations
  (`drawnCount > sweepLength / 2`), so a future guard change that suppresses
  everything cannot turn the sweep green-and-empty.

### F6. Tasks

1. `render.ts` — add `magnifierMarkerStroke`; use it at both `render.ts`
   call sites and `hittest.ts`'s.
2. `canvas.ts` — `magnifierRectGeometry(from, strokeWidth)`; gap per F1;
   call site passes `base.strokeWidth`; doc comment carries F1's rationale
   plus F3's two recorded consequences. `magnifierGeometry` (circle)
   untouched.
3. `magnifier.test.ts` — F4's three tests; F5's two nits.
4. Docs — append this addendum here; add one sentence to
   `docs/ARCHITECTURE.md`'s rect *Creation* bullet: the rect creation gap is
   `MAGNIFIER_GAP_PX + markerStroke/2` so auto-placement always clears the
   band-aware suppression guard (circle unchanged).
5. Device checklist for TASK-50 gains: L preset on a large phone photo ⇒
   connector present (plus S and M as controls).

`pnpm check`, `pnpm test`, `pnpm test:e2e` before sign-off; circle e2e
(`magnifier.spec.ts`) must still pass untouched — nothing here touches a
circle path.

## Addendum G — smaller rect source, corner-to-corner connector, lines-only (2026-08-08)

*Status: implemented. Extends Addenda D/E/F. Scope: rect ("cube mode")
variant only — every circle path stays byte-identical. `src/`-only; no IPC,
no Rust, no new dependency, nothing that blocks the macOS port. Ruled from
three user requests during live iPhone testing: (1) the rect source must
shrink much further; (2) the connector must join corner to corner; (3) the
connector must be lines only, no fill.*

**Done-AC conflict, decided by the user: option 1 (the recommended one).**
`magnifierSizeLimits.minSource` (20 CSS px, a fingertip floor) was applied to
the rect's derived source half-extent on both axes, via `clampRectZoom`'s
ceiling — on a 2532×1170 iPhone screenshot at PWA `cropScale ≈ 7.0` that
floored the smallest source at 280 × 747 bitmap px (40 × 107 CSS px, ~7 text
lines) and capped zoom under 1.9×, defeating the point of a "magnify one
line of text" tool. The floor split in two, rect-only: the DRAWN source
keeps only a legibility floor (`MIN_MAGNIFIER_RECT_SOURCE_CSS_PX = 4`, new
`minRectSource` limit); OPERABILITY moves to a hit-target floor in
`hittest.ts` (`MAGNIFIER_SOURCE_MIN_HIT_HALF_PX = 11` CSS px, touch-
multiplied). The circle's `minSource` is untouched — every circle-scoped
Done AC (TASK-46/48/49) keeps its letter; TASK-50 AC#4 was amended (below)
since it is In Progress and was the user's own wording, and TASK-48 gained a
one-line note that its AC#3 intent is now delivered via the rect's hit
target rather than its drawn size.

### G1. Two floors, rect only

`MIN_MAGNIFIER_RECT_SOURCE_CSS_PX = 4` (`magnifier.ts`) is a LEGIBILITY
floor, not a fingertip one — the marker band (`markerStroke`, centred on the
source rect's boundary) must not swallow the frame it draws.
`MagnifierSizeLimits` gained a fourth field, `minRectSource`, computed by the
same clamp shape as `minSource` (absolute `MIN_MAGNIFIER_SOURCE_RADIUS_PX`
backstop outside, `MAGNIFIER_SOURCE_SHORT_SIDE_CAP * shortSide` canvas cap
inside), different CSS-px input. `minSource` keeps its value, formula and
meaning — circle only, from now on. Exactly three rect readers switched to
`minRectSource`: `clampRectZoom`'s ceiling, `applyMagnifierBoxResize`'s
`minPx`, and `deriveRectLensSize` step 2's `sourceHalfH` floor (step 3's
widening and its own `SHORT_SIDE_CAP` cap are unchanged — the floor now
rarely bites, so the 8:3 default survives more often).

**`applyMagnifierBoxResize`'s `minPx` sentence above is units-only superseded
by Addendum I (2026-08-09):** the same `minRectSource` reader survives,
renamed `minSrcPx` and divided through by `zoom` (the handles now resize the
SOURCE, not the LENS) — see "Addendum I" §I4. `clampRectZoom`'s ceiling
becomes creation-only under Addendum I; the grip's own runtime clamp moved to
a new function, `clampRectZoomForSource`, which reads `minLens` (not
`minRectSource`) — see "Addendum I" §I5.

`MAX_MAGNIFIER_ZOOM` and `MIN_MAGNIFIER_LENS_RADIUS_CSS_PX` are unchanged. `deriveRectLensSize`
step 1 (`baseHalfW = defaultSourceRadius(...)`) is left reading `minSource`,
not `minRectSource` — a rect dimension the two floors above don't cover,
recorded here rather than left implicit; harmless in practice (the
`MAGNIFIER_SOURCE_RADIUS_FRACTION * longSide` term wins over that floor in
every checked canvas/scale combination) and freely shrinkable afterward via
the resize handles regardless of where creation started.

**Accepted, documented regime (not a bug):** at the L stroke preset on a
canvas near 1:1, a fully-shrunk source marker paints as a solid tick rather
than a visible frame — bounded, self-inflicted, recoverable. No
`strokeWidth`-dependent floor was added: `magnifierSizeLimits` stays a
per-canvas function, not a per-annotation one.

### G2. `deriveRectLensSize` — expected values changed

D11's pinned table (§D11 above) recomputes as follows; see
`magnifier.test.ts`'s `deriveRectLensSize` describe block for the exact
pinned assertions:

| canvas / scale / preset | after G1 |
| --- | --- |
| 1000×800, s=1, M | unchanged: src 60 / 22.5, lens 300 × 112.5, zoom 2.5 |
| 10×10, s=0.01, S | unchanged: src 2 / 2, widening capped away |
| 600×500, s=1, M | **src 36 / 13.5, lens 180 × 67.5, zoom 2.5** (aspect exactly 8:3 — the floor no longer bites here at all; was src 53.33/20, lens 266.67×100) |
| 2048×1536, s=5, M | **src 122.88 / 56, lens 614.4 × 280, zoom 2.5** (aspect 2.194 — `minLens = 140` floors the height axis; was 1152×500 / 2.30) |
| 1170×2532, s=3.55, S | **src 151.92 / 56.97, lens 557 × 208.8, zoom 1.833** (aspect exactly 8:3; was 643.5×260.3 / 2.47) |

### G3. Operability moved to the hit target

`hittest.ts`'s `magnifierHitPart` and `hitTest` both gained a **required**
final parameter (`sourceMinHitHalf`) — the same "required so TypeScript
names every call site" precedent `applyResize`'s `canvasSize` set (§D9/§D10).
The circle branch ignores it entirely (its own `minSource` floor already
exceeds any minimum this would apply). The rect branch inflates the source
hit half-extents (per axis) to at least `sourceMinHitHalf`, independent of
the drawn source's own (now much smaller) size:

```ts
const src = magnifierSourceRect(a);
const pad = tolerance + markerStroke / 2;
const hw = Math.max(src.w / 2 + pad, sourceMinHitHalf);
const hh = Math.max(src.h / 2 + pad, sourceMinHitHalf);
```

`canvas.ts`'s `MAGNIFIER_SOURCE_MIN_HIT_HALF_PX = 11` (CSS px half-extent —
22 CSS px across, under Apple HIG's 44 px touch-target guidance because the
src-zoom grip needs its own clear space nearby) feeds a new
`magnifierSourceMinHit(pointerType)` helper mirroring `handleHitRadius`
exactly (touch-multiplied, `cropScale()`-scaled). All four `hitTest`/
`magnifierHitPart` call sites in `canvas.ts` pass it. The selection tint
stays drawn on the source rect itself (not the inflated hit region) — its
comment now notes that, for a rect, the tint is a LOWER BOUND on the
draggable region, not an exact match.

### G4. Connector geometry — the two convex-hull bridges ("corner to corner")

**Superseded by Addendum H (2026-08-08, live iPhone feedback: 「上辺と上辺が
つながってますが、近い辺と辺が繋がるようにしください」 — "the top edges are
connecting to each other, please make the near edges connect to each
other"). The hull-bridge SELECTION this section rules — `connectorBridge`'s
4x4 scan and shortest-pair tie-break — connects the pair's SILHOUETTE, which
for a lens wider than the source sitting below it draws BOTH segments from
the source's TOP corners to the lens's TOP corners: a correct convex-hull
answer and the wrong picture for a zoom callout, which is expected to
bridge the FACING edges across the gap. See "Addendum H" at the end of this
note for the corrected dominant-axis / facing-edge rule; this section is
kept for the historical record of what Addendum G actually shipped, not the
current rule. The suppression guard this section describes (item 1 below)
is UNCHANGED, byte-identical, carried forward by Addendum H — only the
post-guard body (item 2/3, the bridge construction and tie-break) is
replaced.**

**Ruling: the common external tangents of the two rects, computed by brute
force.** For two disjoint convex bodies the joint convex hull has exactly
two bridge edges, each touching one corner of each rect — literally "corner
to corner", crossing-free by construction, and — because a bridge line is a
*supporting* line of both rects — provably unable to enter either interior.
`magnifierRectConnectorShape` is replaced by:

```ts
export type MagnifierConnectorLine = [Point, Point];   // [sourceCorner, lensCorner]

export function magnifierRectConnectorLines(
  sourceRect: Bounds, lensRect: Bounds, w1: number,
): [MagnifierConnectorLine, MagnifierConnectorLine] | null
```

1. **Suppression guard — unchanged expression, kept, re-justified.** The
   `w1/2`-inflated per-axis AABB gap test (formerly
   `trimmedRectConnectorAxis`) is inlined directly. Addendum E's original
   justification (`e±` landing inside the lens) no longer applies — there is
   no more `e±` — but the same expression now carries a simpler one: it
   measures the gap from the PAINTED source rim (the marker band extends
   `w1/2` beyond the rect) to the lens rect, so the guard means "there is
   real clear space between the painted rim and the lens". Addendum F is
   **not** reverted — its creation-gap inflation keeps the same
   justification under the restated guard, and its three tests (the
   negative control included) stay valid unchanged, mechanically renamed.
2. **The two bridges.** `connectorBridge(S, L, sign)` scans all 4×4 corner
   pairs `(S[i], L[j])`; a pair qualifies when all 8 corners of both rects
   lie on the closed `sign`-negative side of the directed line
   `S[i] -> L[j]`. Returns `[connectorBridge(S,L,1), connectorBridge(S,L,-1)]`,
   or `null` if either is `null` (provably unreachable given the guard, kept
   as a defensive, documented-unreachable check).
3. **Tie-break: shortest qualifying pair wins.** Ties happen exactly when
   three-plus corners are collinear on the supporting line (axis-aligned
   cardinal relations) — minimum length picks the gap-spanning segment, the
   direct generalisation of Addendum E's "collinear ties resolve to the
   nearer corner". Load-bearing; pinned by a dedicated test (§G7 T6).

The near-corner insertion (`iNear`, E2's chord-side test) is gone — there is
no polygon to keep off the lens rim. `tangentCornerIndex` is dead and
deleted (a single-viewpoint angular extreme cannot express a double
tangent).

**The no-ink-inside invariant (B1), restated:** each returned segment lies
on a supporting line of both rects, so it meets each rect only on that
rect's own boundary. The painted connector is that segment dilated by its
stroke half-width, so all connector ink stays within `(markerStroke + 4)/2`
of the touching boundary. The lens border is stroked at
`max(1, strokeWidth * MAGNIFIER_LENS_STROKE_RATIO)`, and
`magnifierMarkerStroke(sw) <= max(1, sw * MAGNIFIER_LENS_STROKE_RATIO)` for
every `sw` — so the connector's corner ink is contained in the border's own
join band. Both frames paint after the connector (draw order unchanged), so
no connector ink survives inside either interior.

### G5. Rendering — lines only (rect variant only)

`render.ts`'s `drawRectMagnifier` step 1 replaced the closed-path
stroke+fill with two independent open, stroked segments — no fill, no
`closePath()`. Line width is `markerStroke`
(`magnifierMarkerStroke(a.strokeWidth)`, already computed in this function):
it is the weight the connector's narrow end already used pre-Addendum-G, it
reads as an extension of the source marker's own frame, and
`markerStroke < lensStroke` is exactly what makes §G4's containment argument
hold at the lens corner. No `save()/restore()`/`lineJoin` around this block
— a two-point subpath has no joins (`lineCap = "round"`, already set
unconditionally at the top of the function, stays for seamless junctions
with both frames, but is not load-bearing for the invariant). The source
marker rect and the lens border keep their existing two-pass `strokeRect`
rendering, unchanged. `drawCircleMagnifier` is untouched.

### G6. Deletions

`magnifier.ts`: `trimmedRectConnectorAxis`, `rayFromRectCenter`,
`tangentCornerIndex`, and the old `magnifierRectConnectorShape`'s internal
`p1`/`u`/`n`/`ePlus`/`eMinus`/`sideOf`/`sideFrom`/`iNear` machinery and its
`Point[]` return type — all deleted, not left inert. `rectCenter` and
`rectCorners` stay (guard + bridges both use them). `magnifier.test.ts`: the
`pointInPolygon` and `isSimplePolygon` helpers and every assertion built on
them (the 11×11 interior-grid probe, the closed-polygon-simplicity check),
the old `assertConnectorSane`'s "length 4 or 5"/"lens-side point on
boundary" clauses, the E5.5 insertion-rule describe block, and the E5.2
`L±`-index pinning (replaced by an explicit expected corner pair per
fixture, §G7 T7). Addendum F's gap inflation, `magnifierMarkerStroke`, the
suppression constant, the circle connector and `MAGNIFIER_RECT_ASPECT` all
stay untouched.

### G7. Tests

**T1 is superseded by Addendum H §H5 (2026-08-08): once the connector joins
FACING edges instead of hull bridges, a segment is deliberately no longer a
supporting line of both rects, so T1's own check (and the reviewer's later
T1b hull-edge strengthening, added and then superseded within the same
implementation pass) both fail on every correct post-Addendum-H result. See
"Addendum H" at the end of this note for the replacement contract (T1').**

`magnifier.test.ts`'s connector suite was rewritten around a new
`assertConnectorSane`, implementing T1 (all 8 corners of both rects lie on
one closed side of each segment's line — the B1 replacement contract, exact
and exhaustive), T2 (each segment's endpoints are exactly members of
`rectCorners(sourceRect)`/`rectCorners(lensRect)`), T3 (the two segments
don't properly intersect), T4 (the two segments are distinct pairs) — a
`null` result still passes vacuously (F5b, kept). The fixture SET is kept
(E5.1 parameterised sweep, E5.2 near-field repros — now with an explicit
expected corner pair per fixture instead of `L±` index pinning, E5.3
off-cardinal band — its old "length 4" near-cardinal assertion dropped, since
every non-null result is now exactly two lines regardless of angle, E5.4
dense sweep with F5b's `drawnCount > sweepLength/2` floor, the E4 guard
block, F4's three creation-gap tests). New: a markerStroke-vs-lensStroke
inequality test (T5, 8 strokeWidth values incl. the F4 web-docScale
extreme), and an explicit tie-break fixture (T6). The E5.5 insertion-rule
block is deleted outright (§G6). `magnifierSizeLimits`/`deriveRectLensSize`
gained a parallel `minRectSource` suite (scaling, canvas cap, backstop,
non-emptiness) mirroring the existing `minSource` one, and the
`deriveRectLensSize` pinned rows were updated to §G2's table.
`resize.test.ts`'s every `minPx`-dependent expectation switched to
`minRectSource`; a new phone-scale (2532×1170, `scale 7`) `src-zoom`
regression contract asserts zoom reaches >= 8 on a lens whose short side is
>= 900 bitmap px. `hittest.test.ts` got a mechanical `, 0` on every existing
call plus three new rect/circle `sourceMinHitHalf` cases.

### G8. e2e and docs

`tests/e2e/magnifier.spec.ts` (circle) passes untouched — the circle
regression gate. `tests/e2e/magnifier-rect.spec.ts`'s mirrored arithmetic
gained `MIN_RECT_SOURCE_CSS_PX = 4` and `minRectSource`, and its mirrored
`clampRectZoom`/`deriveRectLensSize` step 2 switched to it — the created
lens gets smaller, which gives the existing on-canvas fit precondition MORE
slack, not less, so no assertion needed loosening. This design note and
`docs/ARCHITECTURE.md` were updated with "superseded by Addendum G" pointers
and the current signatures/geometry.

### Implementation tasks

1. `magnifier.ts` — `MIN_MAGNIFIER_RECT_SOURCE_CSS_PX` + `minRectSource`
   (§G1); switch `clampRectZoom` and `deriveRectLensSize` step 2.
2. `resize.ts` — `applyMagnifierBoxResize`'s `minPx` → `minRectSource`.
3. `magnifier.ts` — `magnifierRectConnectorShape` replaced by
   `magnifierRectConnectorLines` + `connectorBridge` (§G4); guard inlined;
   `trimmedRectConnectorAxis`/`rayFromRectCenter`/`tangentCornerIndex`
   deleted.
4. `render.ts` — `drawRectMagnifier` step 1 → two stroked open segments,
   no fill (§G5).
5. `hittest.ts` — required parameters + rect hit-target inflation (§G3).
6. `canvas.ts` — `MAGNIFIER_SOURCE_MIN_HIT_HALF_PX`,
   `magnifierSourceMinHit(pointerType)`, all four call sites, tint comment.
7. Tests per §G7.
8. e2e mirror + docs per §G8.
9. Device pass (Windows `pnpm tauri dev` + the user's iPhone): shrink the
   source to the floor on a phone screenshot and confirm it frames a single
   line of text; confirm the source stays finger-draggable at that size,
   selected and unselected; confirm the connector reads as two corner-to-
   corner lines with no fill and no ink over the magnified content, across
   cardinal/diagonal/near-cardinal placements; confirm S/M/L creation on a
   large phone photo still shows a connector; confirm export parity.

`pnpm check`, `pnpm test`, `pnpm build:web && pnpm test:e2e` before sign-off;
circle e2e (`magnifier.spec.ts`) must still pass untouched.

## Addendum H — connector joins the FACING edges, not the hull bridges (2026-08-08)

*Architect ruling, after live iPhone feedback on Addendum G's connector:
「上辺と上辺がつながってますが、近い辺と辺が繋がるようにしください」 ("the
top edges are connecting to each other, please make the near edges connect
to each other"). Replaces G4 (bridge selection) and G7 T1/T1b outright. G5
(rendering: two open segments at `markerStroke`, two-pass white-then-colour,
no fill), G1-G3 and the suppression guard are UNCHANGED. `src/editor/` only.*

**Why G4 was wrong for this feature.** The joint-hull bridges are the
SILHOUETTE of the pair — when the lens is wider than the source and sits
below it, both bridges run from the source's TOP corners to the lens's TOP
corners (they graze past the source's sides). That is a correct convex-hull
answer and the wrong picture: the classic zoom callout bridges the FACING
edges across the gap. Hull-bridge selection is deleted, not kept as a
fallback.

### H1. Geometry — dominant separation axis, facing edges, same-side pairing

**Ruling: adopt the dominant-axis rule, with the dominant axis chosen by the
guard's own per-axis gaps (`gx`, `gy`), larger gap wins, ties to x.** That
choice is not a heuristic: `hypot(gx, gy) >= MAGNIFIER_CONNECTOR_MIN_GAP_PX
> 0` forces `max(gx, gy) > 0`, so the dominant axis is ALWAYS STRICTLY
SEPARATED — exactly the precondition H2's invariant needs. (Rejected:
dominance by `|Δ|` or by a normalised `|Δ|/halfExtents` — both can select an
axis whose gap is 0, destroying the proof.)

`magnifierRectConnectorLines` body, replacing everything after the guard
(the guard block itself is byte-identical):

```ts
if (gx >= gy) {
  // Horizontal separation dominates (gx > 0): the facing edges are VERTICAL.
  const east = at.x > from.x;
  const sx = east ? sourceRect.x + sourceRect.w : sourceRect.x;   // source's facing edge
  const lx = east ? lensRect.x : lensRect.x + lensRect.w;         // lens's facing edge
  const sy1 = sourceRect.y, sy2 = sourceRect.y + sourceRect.h;
  const ly1 = lensRect.y,   ly2 = lensRect.y + lensRect.h;
  return [                                     // [top pair, bottom pair] — pinned order
    [{ x: sx, y: sy1 }, { x: lx, y: ly1 }],
    [{ x: sx, y: sy2 }, { x: lx, y: ly2 }],
  ];
}
// Vertical separation dominates (gy > 0): the facing edges are HORIZONTAL.
const south = at.y > from.y;
const sy = south ? sourceRect.y + sourceRect.h : sourceRect.y;
const ly = south ? lensRect.y : lensRect.y + lensRect.h;
return [                                       // [left pair, right pair] — pinned order
  [{ x: sourceRect.x, y: sy },                   { x: lensRect.x, y: ly }],
  [{ x: sourceRect.x + sourceRect.w, y: sy },    { x: lensRect.x + lensRect.w, y: ly }],
];
```

Pairing is SAME-SIDE: top↔top / bottom↔bottom when the facing edges are
vertical, left↔left / right↔right when horizontal. `Math.sign(Δ)` on the
dominant axis is never 0 (a positive gap forces `|Δ| > halfExtents + w1/2`).
The user's case falls out directly: lens below source ⇒ `gy` dominates,
`south` ⇒ source BL→lens TL and source BR→lens TR.

**Diagonal / oblique (both gaps positive): the dominant-axis rule applies
unchanged** — the segments attach to the facing edges of the larger-gap
axis and both lean sideways toward the lens. That is visually correct (it
still reads as the source box opening into the lens box) and is
crossing-free by H3. No third "diagonal" regime — it would add two more
switching loci for no gain.

**Continuity.** The rule is continuous through every CARDINAL relation
(near due-south, `gx = 0 << gy`, so a few degrees of drag never changes the
answer) — the property Addendum E valued and the place auto-placement
actually parks the lens (`PLACEMENT_DIRS` tries E/W/S/N first). The one
discontinuity sits at the EXACT diagonal locus `gx === gy`, where the answer
flips between the two facing-edge pairs. Accepted and documented: a
discrete rule must switch somewhere, and this is the least-visited locus.
Tie-break at `gx === gy`: x wins (`gx >= gy`), deterministic and stable.

### H2. The no-ink-inside invariant (B1 contract), restated

These segments are no longer supporting lines of both rects; G4's argument
is void and is replaced by a stronger, simpler SLAB argument. WLOG the
dominant axis is x and `at.x > from.x` (the other three cases are
mirrors/transposes):

> `gx > 0` gives `at.x − from.x > sourceRect.w/2 + w1/2 + lensRect.w/2`,
> hence `sourceRight = sourceRect.x + sourceRect.w < lensRect.x = lensLeft`,
> STRICTLY, with `gx + w1/2` to spare. Both returned segments have their
> source endpoint on the line `x = sourceRight` and their lens endpoint on
> `x = lensLeft`, so every point of either segment satisfies `sourceRight <=
> x <= lensLeft`, strictly on both sides for relative-interior points. The
> source rect lies in `{x <= sourceRight}` and the lens rect in `{x >=
> lensLeft}`. Therefore each segment meets each rect only at its own
> endpoint corner; its relative interior is disjoint from both closed rects.

This covers the case the guard permits with only one positive gap (`gx > 0`,
`gy = 0`, i.e. a taller lens due east overlapping the source vertically):
the segments live in the vertical slab between `x = sourceRight` and `x =
lensLeft`, outside both rects regardless of the vertical overlap. That is
precisely why dominance is chosen by gap, not by displacement.

The painted-ink consequence is unchanged from G4 and still holds verbatim:
because each segment lies in a closed half-plane bounded by the rect's own
facing edge line and touches it only at the endpoint, the segment dilated by
the stroke half-width intersects that rect only inside the disc of radius
`(markerStroke + 4)/2` centred on the endpoint corner. The source marker's
round-join disc there has exactly that radius; the lens border's has
`(lensStroke + 4)/2 >= (markerStroke + 4)/2` since `magnifierMarkerStroke(sw)
= max(1, 0.9·sw) <= max(1, 1.5·sw)`. Both frames are painted AFTER the
connector, so no connector ink survives inside either interior —
independently of the lens-content pass (TASK-46 AC#6). §G7 T5 (the ratio
inequality test) stays exactly as is.

### H3. Crossing-freedom

WLOG x dominant. Both segments span the same x-interval `[sourceRight,
lensLeft]` (non-degenerate) and are affine in x: at any x, segment A is at
`yA(x) = lerp(sourceTop, lensTop)` and segment B at `yB(x) =
lerp(sourceBottom, lensBottom)`. `sourceTop < sourceBottom` and `lensTop <
lensBottom` for any positive-height rect, and a convex combination of two
strict inequalities is strict, so `yA(x) < yB(x)` everywhere: the segments
are DISJOINT, not merely non-crossing. Degenerate zero-height rects make
them coincide — a harmless `Path2D` case, documented, not branched.
Symmetric for the y-dominant case.

### H4. Deletions

1. `magnifier.ts`: `connectorBridge` (the whole 4×4 scan, its epsilon and
   its shortest-pair tie-break) and the `if (!plus || !minus) return null`
   defensive branch. `rectCorners` becomes dead once the new body builds its
   points from edge coordinates — confirmed dead by grep, then deleted
   (`rectCenter` stays, the guard needs it).
2. `magnifier.test.ts`: `convexHull`, `liesOnHullEdge`, the T1b joint-hull-
   edge assertion — it was added minutes earlier as a reviewer nit fix; it
   is now WRONG, not merely redundant: these segments are deliberately NOT
   hull edges, so T1b would fail on every correct result. Also deleted: the
   "collinear hull edge, reviewer's T1b false-flag repro" describe block
   wholesale (its entire subject was `convexHull` collapsing collinear
   points), and the old T1 cross-product assertion.
3. Doc-comment prose about bridges/supporting lines/hull in `magnifier.ts`
   (`MagnifierConnectorLine`, `magnifierRectConnectorLines`) and in
   `render.ts`'s `drawRectMagnifier` step-1 comment — rewritten to H1/H2,
   not annotated as history.

### H5. Tests

`assertConnectorSane` — new contract set (fixture SETS all unchanged: E5.1
parameterised suite, E5.3 off-cardinal band, E5.4 dense sweep with F5(b)'s
`drawnCount > sweepLength/2` floor, E5.6 guard + control, F4's three
creation tests; `null` still passes vacuously):

- T1' (replaces T1/T1b — the B1 regression contract, exact and algorithm-
  independent). For each segment × each of the two rects: clip the segment
  to the CLOSED rect with a Liang–Barsky parametric clip returning `[t0,
  t1] | null`; assert the result is `null`, or degenerate at an endpoint
  (`t1 - t0 <= 1e-12 && (t0 <= 1e-12 || t0 >= 1 - 1e-12)`). This states
  "meets the rect only at an endpoint" directly, without mirroring the
  production construction.
- T2 (unchanged). Each segment's first point is exactly a member of
  `rectCornersOf(sourceRect)`, its second exactly a member of
  `rectCornersOf(lensRect)` (strict equality). Keep the local
  `rectCornersOf` helper.
- T3 (unchanged). `segmentsProperlyIntersect` is `false` for the pair —
  keep the helper.
- T4 (unchanged). The two segments are distinct.
- T8 (new, replaces T1b's role as the independent structural check). The
  two source endpoints share one coordinate (they are the two ends of a
  single source edge) and the two lens endpoints share one coordinate; and
  those edges FACE each other: the source's shared coordinate is on the
  lens's side of the source centre, and the lens's shared coordinate is on
  the source's side of the lens centre. This is the user's request
  expressed as a contract.

Fixture-level updates: T6 (was "resolves to a fixed, reproducible pair of
bridges") became two tests — (a) dominant-axis tie: a fixture with `gx ===
gy` exactly, asserting the x-dominant answer (vertical facing edges), pinning
the tie-break; (b) cardinal continuity: a due-south fixture plus the same
rotated ±2° and ±8°, asserting all resolve to the same y-dominant
facing-edge answer (source BL→lens TL, source BR→lens TR) — no snap near a
cardinal. T7 (near-field repros): both reviewer fixtures kept, pinned corner
pairs replaced — for the near-north case (source 230.4×86.4 at the origin,
lens 576×216 centred `(60, −420)`, `w1 = 5.4`): `gx = 0`, so y dominates and
the expected pairs are `(−115.2, −43.2) → (−228, −312)` and `(115.2, −43.2)
→ (348, −312)` — the source's north corners to the lens's south corners,
which is what that test's own prose always claimed and what the hull rule
did NOT deliver (it returned the south-west pair). The near-south fixture
was recomputed the same way. §G7 T5 (`markerStroke <= lensStroke`) and
every §G1/§G2/§G3 test are untouched.

### H6. Docs

`docs/ARCHITECTURE.md`'s rect Connector bullet was rewritten to state the
facing-edge rule directly. TASK-50 AC#2's wording (already amended by
Addendum G) reads "corner-to-corner connector lines" — no further amendment
needed.

### Implementation tasks

1. `magnifier.ts` — replace the post-guard body per H1; delete
   `connectorBridge`, the defensive null branch and `rectCorners`; rewrite
   the doc comment (H1 rule, H2 invariant, H3 crossing-freedom, the
   exact-diagonal discontinuity note, the pinned return order).
2. `render.ts` — comment-only update in `drawRectMagnifier` step 1
   (rendering itself unchanged).
3. `magnifier.test.ts` — H4.2 deletions; `assertConnectorSane` →
   T1'/T2/T3/T4/T8; T6a/T6b; T7 expected pairs.
4. Docs per H6.
5. Verify: `pnpm check`, `pnpm test`, `pnpm build:web && pnpm test:e2e`
   (`magnifier.spec.ts`, the circle gate, must pass untouched). Device pass
   adds: lens above/below/left/right of the source ⇒ the two lines visibly
   bridge the facing edges; drag the lens through a diagonal and confirm the
   single switch at `gx ≈ gy` is the only jump, with none near the
   cardinals.

# Addendum I — shape the SOURCE, the lens follows (2026-08-09)

*Architect ruling, from a user decision after live use of Addendum G/H's cube
mode: the rect magnifier's 8 box handles move from the lens to the SOURCE
rect, zoom stays fixed during that drag, and the lens follows as `source *
zoom` — the exact inversion of §5/§D9/§D10's rule. Supersedes §5's handle
list and box-drag semantics, §D9/§D10's clamp UNITS (their two rulings
survive verbatim, re-expressed), §6's grip placement, and §G1's `minPx`
expression. Everything else in Addenda A–H — creation (§4/§D11/§G1/§G2), the
connector (§H1–H3), the suppression guard, the hit-target split (§G3),
rendering (§G5) and every CIRCLE path — is untouched and stays
byte-identical. `src/editor/` only: no IPC, no Rust, no new dependency,
nothing that blocks the macOS port.*

## Problem

Cube mode today is lens-authoritative at the gesture level: the 8 box
handles sit on the lens, the lens is what the pointer resizes, and the
source is whatever `lens / zoom` happens to be. In use that is backwards —
the user is framing *a line of text in the picture*, so the rect they want
under their finger is the SOURCE rect; the lens is just the output surface,
whose size they only care about via magnification. The user has decided:
the 8 handles move to the source, `zoom` is held fixed during that drag, and
the lens follows as `source * zoom`.

## Decision summary

| § | Question | Ruling |
| --- | --- | --- |
| I1 | Where does authority live? | **Serialized model unchanged** (`width`/`height` stay LENS dims). The gesture, not the data, is re-based: box handles solve `lensW = srcW * zoom`. |
| I2 | Handle geometry | 8 box handles on `inflate(magnifierSourceRect(a), srcHandleOutset)` — an OUTSET ring, not the bare source rect. `boundsOf` keeps meaning "the lens rect", unchanged. |
| I3 | Pinning | Opposite SOURCE corner pinned (`from` moves, exactly like rect/image). `at` stays FIXED — the lens grows about its own centre. New global invariant: **`at` changes only under a lens-body drag.** |
| I4 | Clamps | The whole §D9/§D10 clamp block survives, divided by `zoom`: `minSrcPx = 2*max(minLens/zoom, minRectSource)`, `maxSrc{W,H} = 2*MAX_LENS_FRACTION*canvas{w,h}/zoom`. Shift scale-back and the both-axes clamp are unchanged in form. |
| I5 | `src-zoom` grip | **Relocated to the LENS rect's SE corner**, mapping inverted: `zoom = dist(pointer, at) / sourceHalfDiag`, source held fixed, lens follows. Zero collisions with the source box handles (when the lens overlaps the source, legal under §I3, the grip can land inside the handle ring — `src-zoom` is listed first in `resizeHandlesFor` and still wins exact ties). Grabbing it is an exact no-op. |
| I6 | Hit-test order | Unchanged structure (handles before body). One new rect-only rule: a press at least as near `from` as to the nearest handle falls through to the source-body drag (`magnifierSourceBodyWins`). |
| I7 | Not changed | model.ts, bounds.ts, hittest.ts, render.ts, creation, connector, export, the circle. |
| I8 | ACs | TASK-50 #3/#4 rewritten (text below); TASK-48 AC#6 re-satisfied in source units. |

### I1. Authority stays where it is: the model keeps LENS dimensions

Do not re-base the model. `RectMagnifierAnnotation.width/height` remain the
LENS's full dimensions; the source stays derived. The box-handle gesture
*solves* for them: it computes a new source rect from the pointer, then
writes `width = srcW * zoom`, `height = srcH * zoom`. (Re-basing to source
dims was rejected on churn/blast radius: bounds.ts reads width/height
directly as the lens rect and must stay a magnifier.ts-free leaf; every doc
comment and pinned test assumes lens dims; user-visible behaviour is
identical either way.)

### I2. Handle geometry — box handles ring the source; `boundsOf` still means the lens

`resizeHandlesFor` gains a third, REQUIRED parameter `srcHandleOutset`
(bitmap px), and its rect-magnifier arm becomes:

```ts
case "magnifier": {
  if (a.shape === "rect") {
    // Grip on the LENS's own SE corner (I5) — `bounds` IS the lens rect for a
    // magnifier, so no magnifierLensRect import is needed here.
    const grip = { x: bounds.x + bounds.w, y: bounds.y + bounds.h };
    return [
      { id: "src-zoom", pos: grip, shape: "grip" },
      ...boxHandles(inflate(magnifierSourceRect(a), srcHandleOutset)),
    ];
  }
  /* circle arm: byte-identical */
}
```

`boundsOf(magnifier)` stays the LENS rect, unchanged — marquee, padded
bounds, delete button, `pivotOf`, `anchorPointFor` all still track the lens.

The one real coupling that must be broken by hand: `applyResize(original,
bounds, ...)` passes `bounds` (the lens rect) as "the box being resized".
The rect magnifier's box branch must now derive its own box from
`magnifierSourceRect(original)` and IGNORE `bounds`. State it in the doc
comment: *for a rect magnifier's box handles, `bounds` is not the resized
box.*

Why an OUTSET ring: at the §G1 floor the source is 8 CSS px across; eight
`HANDLE_DRAW_PX = 10` squares on its corners/edges would cover it
completely. `MAGNIFIER_SRC_HANDLE_OUTSET_PX = 14` CSS px (`* cropScale()`,
screen-constant like `HANDLE_DRAW_PX`) puts a drawn handle's inner edge 9
CSS px outside the source's edge, leaving ~6 CSS px clear of the marker band
at every source size, and guarantees a non-empty body core on mouse.

The outset must be inverted in the drag math, or grabbing a handle jumps
the source outward by 14 CSS px. The resize contract is "the pointer sets
the edge" (stateless, recomputed from pre-drag geometry each frame — no grab-
offset state). Preserve it by deflating the pointer along the handle's own
direction before `resizeBox`, which exactly inverts `inflate`:

```ts
const dir = BOX_HANDLE_DIR[handle];
const p = {
  x: dir.east ? pointer.x - srcHandleOutset : dir.west ? pointer.x + srcHandleOutset : pointer.x,
  y: dir.south ? pointer.y - srcHandleOutset : dir.north ? pointer.y + srcHandleOutset : pointer.y,
};
```

Grabbing without moving is then an exact no-op, including on the Shift-locked
path.

**Round-3 correction (reviewer, 2026-08-09): the deflate-then-`resizeBox`
reconstruction above is NOT actually a reliable exactness mechanism on
production-shaped geometry**, even though the claim above ("an exact no-op")
is correct — it was, and stays, TRUE, but for a different reason than
originally stated. Measured: the deflation itself (`(x +/- outset) -/+
outset`) drifts by 1 ulp in ~63% of sampled non-dyadic fixtures, and
`resizeBox`'s own edge-difference reconstruction (`(src.y + src.h) - src.y`)
drifts in ~98% — a fixture like `257x97, zoom 3.3, from(200.5, 200.25)` fails
on all 8 handles under the deflate-and-trust approach. The fix (same
mechanism §I5's grip branch already uses): BEFORE any deflation/`resizeBox`
math runs, recompute the dragged handle's own ring position with the exact
same call `resizeHandlesFor` used to draw it
(`boxHandles(inflate(magnifierSourceRect(a), srcHandleOutset))` — the same
two functions, same argument order, hence bit-identical by construction) and
short-circuit to the original annotation on an exact pointer match. Only a
genuine drag reaches the deflation/`resizeBox` code below.

### I3. Pinning — opposite SOURCE corner pinned; `at` never moves

The dragged source edge/corner follows the pointer, the diagonally opposite
SOURCE corner is pinned (`from` moves), and `at` is FIXED — the lens
grows/shrinks about its own centre. Global invariant, now true for BOTH
shapes: **`at` changes only under a lens-body drag; `from` changes only
under a source-body drag or a source box-handle drag; `zoom` changes only
under the grip.** Bonus cleanup: `anchorPointFor`'s magnifier case (`return
a.at`) becomes EXACT for every gesture — delete the D5 "technically
imprecise / provably inert" caveat rather than leaving it stale. Consequence:
the lens can grow toward and overlap the source; this is legal and already
handled (connector suppression on overlap §H1; lens-first hit rule;
recoverable by a lens-body drag). Do NOT add repulsion/auto-reposition.

### I4. Clamps, re-expressed in source units — §D9/§D10 survive verbatim

`applyMagnifierBoxResize` becomes:

```ts
const src = magnifierSourceRect(a);                    // pre-drag source rect — NOT `bounds`
const dir = BOX_HANDLE_DIR[handle];
const isCorner = (dir.west || dir.east) && (dir.north || dir.south);

// I2: invert the ring outset so the pointer sets the SOURCE edge exactly.
const p = { /* deflated pointer, see I2 */ };

// I4: the §D9/§D10 bounds, divided by zoom. minPx was
// 2*max(minLens, zoom*minRectSource); /zoom gives the form below, which also
// shows the two floors' different natures: minLens is a LENS floor seen
// through the zoom, minRectSource is the source's own legibility floor (§G1).
const minSrcPx = 2 * Math.max(limits.minLens / a.zoom, limits.minRectSource);
const maxSrcW = (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.w) / a.zoom;
const maxSrcH = (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / a.zoom;
const loW = Math.min(minSrcPx, maxSrcW);               // "hi wins", unchanged discipline
const loH = Math.min(minSrcPx, maxSrcH);

const box = resizeBox(src, handle, p, minSrcPx, shiftKey);
let w = box.w, h = box.h;
if (shiftKey && isCorner) {                            // §D9 uniform scale-back, unchanged
  const s = Math.min(1, maxSrcW / w, maxSrcH / h);
  if (s < 1) { w *= s; h *= s; }
}
w = clamp(w, loW, maxSrcW);                            // §D10 both axes, unchanged
h = clamp(h, loH, maxSrcH);

// §D10 anchoring, unchanged in form; the untouched axis re-centres on its
// pre-drag centre, which is now `a.from`'s coordinate on that axis.
const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
const x0 = dir.west ? box.x + box.w - w : dir.east ? box.x : cx - w / 2;
const y0 = dir.north ? box.y + box.h - h : dir.south ? box.y : cy - h / 2;
return { ...a, from: { x: x0 + w / 2, y: y0 + h / 2 }, width: w * a.zoom, height: h * a.zoom };
```

Notes for the doc comment: division by `a.zoom` needs no epsilon guard (zoom
>= MIN_MAGNIFIER_ZOOM always); Shift locks the source's pre-drag aspect,
which IS the lens's aspect; TASK-48 AC#6 still holds (both axes clamped,
same lens caps divided through); `minRectSource` is now enforced ONLY by
this function (the new grip holds the source fixed and cannot/must not
enforce it).

### I5. The `src-zoom` grip moves to the LENS's SE corner — mapping inverted

```ts
const src = magnifierSourceRect(a);
const srcHalfDiag = Math.max(Math.hypot(src.w, src.h) / 2, Number.EPSILON);
const dist = Math.hypot(pointer.x - a.at.x, pointer.y - a.at.y);
const zoom = clampRectZoomForSource(dist / srcHalfDiag, src.w, src.h, canvasSize, limits);
return { ...a, zoom, width: src.w * zoom, height: src.h * zoom };   // `at`/`from` unchanged
```

Grabbing it without moving is an exact no-op (at grab, dist === zoom *
srcHalfDiag). Ridge angle: `drawZoomGrip`'s angle parameter now takes
`atan2(a.height/2, a.width/2)` — the LENS rect's SE angle.
`MAGNIFIER_ZOOM_HANDLE_ANGLE` stays the circle's default. Zoom readout stays
anchored at the SOURCE rect's NE/SW corner, unchanged.

New clamp function in `magnifier.ts` (the existing `clampRectZoom` takes
LENS dims, which are the unknown here):

```ts
export function clampRectZoomForSource(
  z: number, sourceW: number, sourceH: number,
  canvasSize: { w: number; h: number }, limits: MagnifierSizeLimits,
): number {
  const sw = Math.max(sourceW, Number.EPSILON), sh = Math.max(sourceH, Number.EPSILON);
  const hi = Math.min(
    MAX_MAGNIFIER_ZOOM,
    (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.w) / sw,
    (2 * MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h) / sh,
  );
  const lo = Math.max(MIN_MAGNIFIER_ZOOM, (2 * limits.minLens) / Math.min(sw, sh));
  return clamp(z, Math.min(lo, hi), hi);   // "hi wins", same discipline as magnifierSizeLimits
}
```

`clampRectZoom` keeps its creation role (`deriveRectLensSize` step 8)
unchanged; add one sentence to its comment saying it is now creation-only.

### I6. Hit-test order — unchanged structure, one rect-only tie-break

Existing order stands (grip listed FIRST; lens before source in
`magnifierHitPart`). The lens no longer has box-handle zones. New required
rule — with 8 handles ringing a source whose short half-extent can be 4 CSS
px, the handles' 24 CSS px touch hit discs swallow the source's fingertip-
floored hit square, making the source-body (aiming) drag unreachable on
touch. Ruling: `from` competes in the same nearest-wins comparison as the
handles. New pure predicate in `resize.ts`, consulted by
`rotateOrResizeTarget` immediately after `nearestHandle`:

```ts
export function magnifierSourceBodyWins(
  a: Annotation, p: Point, nearest: { id: ResizeHandle; dist: number } | null,
): boolean;
```

Body: `a.kind === "magnifier" && a.shape === "rect" && nearest !== null &&
Math.hypot(p.x - a.from.x, p.y - a.from.y) <= nearest.dist`. Doc comment:
same nearest-wins shape as the knob-vs-handle tie-break (TASK-41 round 2);
circle is always false (its grip sits >= 20 CSS px out on the source rim —
applying this would change TASK-49-verified behaviour for a problem the
circle does not have). Two properties to assert in tests: (1) the body core
is never empty (radius ≈ (srcHalfShort + outset)/2, >= 9 CSS px at the
floor); (2) the core is always inside the source's own hit region, so "body
wins" never means "deselect".

### I7. Explicitly NOT changed

model.ts, bounds.ts, hittest.ts, render.ts, creation (`deriveRectLensSize`,
`placeRectLens`, `clampRectLensCenter`, `magnifierRectSlideUpdate`),
`magnifierRectConnectorLines`, source tint, `MAGNIFIER_RECT_ASPECT`,
`magnifierSizeLimits`, exporter, undo/history, mode toggle, every circle
path. Delete-button AvoidCircle stays the SOURCE half-diagonal — record in
the call-site comment: `positionSelectionControls` already inflates by 24
CSS px + margin, and the ring adds at most outset*sqrt(2) ≈ 19.8 CSS px.

### I8. AC migration — TASK-50 #3/#4 amended (user-decided 2026-08-09)

> **#3** — The rect magnifier's SOURCE rect resizes via 8 box handles, drawn
> on a ring outset from the source frame, with free aspect (Shift on a
> corner locks the pre-drag aspect). During the drag `zoom` and the lens
> centre `at` are constant and the lens follows exactly as `source * zoom`;
> both axes stay within the lens size limits. The LENS has no box handles
> and is not directly resizable; it remains draggable by its body.
>
> **#4** — The zoom grip sits on the LENS rect's SE corner and adjusts
> `zoom` with the SOURCE rect held fixed (the lens follows as `source *
> zoom`), clamped so zoom stays in `[MIN, MAX]` and the lens stays within
> `[2*minLens, 2*MAGNIFIER_MAX_LENS_FRACTION*canvas]` per axis; grabbing it
> without moving changes nothing. The source's legibility floor is enforced
> by the source box handles, and the source's drag target stays
> independently floored at a fingertip size — a press at least as near the
> source centre as to any handle always starts a source-body drag.

## New/changed internal TS contracts

```ts
// magnifier.ts
export function clampRectZoomForSource(z, sourceW, sourceH, canvasSize, limits): number;  // NEW

// resize.ts
export function resizeHandlesFor(a, bounds, srcHandleOutset): HandleSpec[];               // 3rd param NEW, required
export function applyResize(original, bounds, handle, pointer, shiftKey, limits, canvasSize, srcHandleOutset): Annotation;  // 8th param NEW, required
export function magnifierSourceBodyWins(a, p, nearest): boolean;                          // NEW

// canvas.ts (private)
const MAGNIFIER_SRC_HANDLE_OUTSET_PX = 14;  // CSS px, * cropScale() at the call site
private srcHandleOutset(): number;          // the one owner of that multiplication
```

Both new required params follow the "required so TypeScript names every call
site" precedent (limits/canvasSize/sourceMinHitHalf). `srcHandleOutset` is
NOT touch-multiplied (drawn geometry, like HANDLE_DRAW_PX).

### Implementation tasks (in order)

1. **`src/editor/magnifier.ts`** — add `clampRectZoomForSource` per §I5 with
   a doc comment covering the per-axis lens bounds, "hi wins" order,
   `Number.EPSILON` guards, and its division of labour vs `clampRectZoom`
   (creation, lens-dims-known). Add one sentence to `clampRectZoom`'s
   comment: creation-only now.
2. **`src/editor/resize.ts` — handle layout (§I2/§I5).** Add required
   `srcHandleOutset` param to `resizeHandlesFor`; rewrite the rect-magnifier
   arm (grip at `bounds`'s SE corner; `boxHandles` on the source rect
   inflated by the outset — add a small module-private `inflate` helper).
   Update the `MagnifierHandle` type comment and the function doc comment.
   Circle arm byte-identical.
3. **`src/editor/resize.ts` — the two gestures (§I3/§I4/§I5).** Add required
   `srcHandleOutset` 8th param to `applyResize`, thread through
   `applyMagnifierResize`/`applyRectMagnifierResize`. Rewrite the `src-zoom`
   branch per §I5. Rewrite `applyMagnifierBoxResize` per §I2/§I4 (pointer
   deflation, source-unit clamps, writes `from`, never `at`,
   `width`/`height` = source * zoom).
4. **`src/editor/resize.ts` — arbitration + cleanup (§I6/§I3).** Add
   `magnifierSourceBodyWins`. Update `anchorPointFor`'s magnifier comment.
5. **`src/editor/canvas.ts`** — add `MAGNIFIER_SRC_HANDLE_OUTSET_PX = 14` and
   private `srcHandleOutset()`; pass it at both `resizeHandlesFor` call
   sites and the `applyResize` call; consult `magnifierSourceBodyWins` in
   `rotateOrResizeTarget`; switch the rect grip's ridge angle to the LENS
   rect; add the delete-button AvoidCircle clearance note.
6. **`src/editor/resize.test.ts`** — migrate the handle-layout, box-drag,
   §D9/§D10, and src-zoom/phone-scale suites to source units; add
   grab-without-moving no-op tests, `lens === source * zoom` invariant
   tests, and `magnifierSourceBodyWins` coverage; update every other call
   site of `resizeHandlesFor`/`applyResize` for the new required params.
7. **`src/editor/magnifier.test.ts`** — add a `clampRectZoomForSource` suite.
8. **Docs** — append this addendum; add "superseded by Addendum I" pointer
   notes on §5, §6, §D9/§D10 (units only), and §G1's `minPx` sentence.
   Update `docs/ARCHITECTURE.md`'s rect magnifier Resize bullet and the
   `applyResize`/`resizeHandlesFor` signatures.
9. **Backlog** — replace TASK-50 AC#3/#4 with the §I8 wording; record the
   user decision; add device-checklist items (floor-size source handle
   visibility/draggability, no grab-jump, grip independence, undo
   granularity).

### Verification

`pnpm check`, `pnpm test` (including the rewritten suites), and — if a web
build + Playwright e2e exists in the environment — `pnpm build:web && pnpm
test:e2e` (`magnifier.spec.ts`, the circle gate, must pass untouched;
`magnifier-rect.spec.ts` drags no handles and should pass unaffected).
