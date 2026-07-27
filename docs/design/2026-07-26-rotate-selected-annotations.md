# TASK-41 — Rotate selected annotations with the select tool

Design note, 2026-07-26 (architect). Scope: TASK-41 only, single selection.
All rotation math lives in a pure, DOM-free module so TASK-42 (multi-select)
can reuse it for group rotation.

## Problem

The select tool can move (TASK-8), delete and resize (TASK-29) a single
annotation, but there is no way to tilt one. Rotation must be *data*
(`angle`), never baked into points (project invariant + AC#2), must render
identically on the live canvas and in exports (they already share
`renderAnnotations`), must be undoable, and must not break the existing
select-tool gestures on a rotated object. The hard parts are (a) where the
pivot function lives (`render.ts` must not import `hittest.ts`, and
`exporter.ts` must not transitively reach selection/interaction modules), and
(b) how resize composes with rotation without drift.

## Decisions

1. **`angle?: number` on `AnnotationBase`** — radians, clockwise in canvas
   coordinates (y-down, exactly what `ctx.rotate()` consumes), normalized to
   `(-π, π]`, absent/`0` = unrotated. All kinds carry the field so TASK-42 can
   rotate a mixed group; the *affordance* is gated separately.
2. **Uniform pivot: the center of the annotation's unrotated (local-frame)
   `boundsOf`.** One rule, one function, no per-kind special cases. For badge
   this degenerates to `a.at`; for rect/image the box center; for text the
   center of the measured box.
3. **Rotation is honored everywhere by a single generic transform** —
   `renderAnnotations` wraps each draw in
   `translate(pivot)/rotate(angle)/translate(-pivot)`, and `hitsAnnotation`
   inverse-rotates the pointer about the pivot before running the existing,
   unchanged per-kind test. Both are guarded by `if (a.angle)`, so an
   unrotated document takes byte-identical code paths and pays zero extra
   `measureText` calls.
4. **Rotate handle offered on rect, image, text, badge.** Exempt: **arrow**
   (its direction is already first-class in the model — `from`/`to`; an
   `angle` field would be a second, redundant representation of the same fact,
   and the existing `to`-endpoint drag with Shift-45° snap already rotates it)
   and **highlight** (freehand marker stroke; move/delete-only, the same
   rationale as its TASK-29 resize exemption). Both remain *renderable*
   rotated, so TASK-42 group rotation needs no new render work. Following the
   TASK-29 precedent, these exclusions are recorded, not silent.
5. **New leaf module `src/editor/bounds.ts`** owns "where a shape is":
   `Bounds`, `boundsOf`, `fontString`, `badgeHalfWidth` (moved out of
   `render.ts`/`hittest.ts`). This is the enabling refactor — it gives
   `render.ts` a legal way to reach `boundsOf` (today it cannot, because
   `hittest.ts` imports `render.ts`) with **one** owner of the pivot, instead
   of a duplicated per-kind pivot formula that would drift from `boundsOf`
   exactly the way TASK-38's second layout authority did.
6. **New leaf module `src/editor/rotate.ts`** — pure rotation math only
   (pivot, rotate/unrotate, normalize, drag→angle, snap, re-anchor,
   `canRotate`). Selection-chrome geometry (rotate-knob layout/hit) goes into
   **`resize.ts`**, which already owns handle layout and is never in the
   exporter's import graph.
7. **Resize composes by operating in the shape's unrotated local frame**, plus
   a **re-anchor translation** so the pinned corner stays world-fixed (see the
   geometry contract below). Drift-free by construction; exact no-op at 0.
8. **Rotated text re-edit** keeps the DOM `<input>` overlay and applies the
   same transform via CSS: place it at the world position of `at` and
   `transform: rotate(θ)` with `transform-origin: 0 0`. Mathematically
   identical to the canvas transform, no pivot needed in CSS, keeps
   TASK-23/TASK-35.10 flows intact. No transform is set at all when angle = 0.
9. **One undo step per rotate gesture**, lazy-pushed on the first frame that
   actually changes the angle — the exact `move`/`resize` pattern.

## Alternatives considered

| Decision | Alternative | Why rejected |
| --- | --- | --- |
| Pivot helper via new `bounds.ts` leaf | `pivotOf` per-kind inside `render.ts` | Duplicates `boundsOf`'s math (text `measureText`, manual-badge `badgeHalfWidth`). Two owners of "where is the center" → drift between render and hit-test; the failure mode of the "one property, one owner" rule. |
| | Move `boundsOf` into `render.ts` | `exporter.ts` then transitively imports bounds *and* `render.ts` becomes metrics+bounds+drawing; contradicts ARCHITECTURE's documented home for `boundsOf`. |
| | `rotate.ts` imports `hittest.ts` for `boundsOf` | Breaks the boundary: `exporter → render → rotate → hittest` puts selection code in the exporter's graph. |
| `angle` on every kind, handle on four | `angle` only on rotatable interfaces | Type churn for `translateAnnotation`/`applyResize`/snapshots; TASK-42 group rotation needs it on all kinds anyway. Uniform base field + `canRotate()` policy predicate is cheaper. |
| Arrow rotates by endpoint drag | Give arrow an `angle` too | Redundant representation: direction in both `from/to` and `angle`; bounds/hit-test/45° snap would compose two rotations. TASK-42 can rotate arrows losslessly by transforming the endpoints. |
| Overlay drawn inside the rotated transform | Counter-rotate handles so squares stay screen-aligned | More code, negligible gain; tilted handles match Figma/PowerPoint and make rotation state obvious. |
| Resize in local frame + re-anchor | Resize in world frame | Would rewrite all five per-kind transforms in `applyResize`, re-litigating every TASK-29 AC. Local-frame + re-anchor reuses `applyResize` verbatim and is a no-op at `angle === 0`. |
| Radians | Degrees in the model | Every producer/consumer (`atan2`, `ctx.rotate`) is radians. |
| CSS-transformed text input | Render text upright while editing | Not WYSIWYG; visible jump on commit. |
| | Disallow re-edit / reset angle on edit | Silent data loss; breaks TASK-23 AC. |

## Geometry contract

**Local frame.** `boundsOf(a, measure)` keeps returning the **unrotated**
axis-aligned box — the shape's *local* frame. Every handle position,
`applyResize` call and marquee coordinate is expressed there.
World = `rotate(local, pivot, angle)`.

**Re-anchor invariant (why resize cannot drift).** During a resize gesture,
`pivot0 = center(bounds_predrag)` is fixed. Each frame:

1. `localPointer = unrotatePoint(pointer, pivot0, angle)`
2. `updated = applyResize(original, bounds_predrag, handle, localPointer, shift)`
   — unchanged TASK-29 code; `angle` survives via spread
3. `anchor = anchorPointFor(original, bounds_predrag, handle)` — the pinned
   point; by construction of `applyResize`, its **local coordinates are
   identical** in `bounds_predrag` and `boundsOf(updated)`
4. `d = reanchorDelta(anchor, bounds_predrag, boundsOf(updated), angle)`
   = `rotate(anchor, pivotBefore, θ) − rotate(anchor, pivotAfter, θ)`
5. `updated = translateAnnotation(updated, d.x, d.y)`

Translating a shape translates its pivot by the same vector, so step 5 lands
the anchor exactly on its pre-drag world position. The composite local→world
map is then a rigid motion of angle θ fixing the anchor — and so is "rotate
about `pivot0`"; two rigid maps with the same angle agreeing at one point are
the same map. Inverse-mapping the pointer with the fixed `pivot0` for the
whole gesture is therefore exactly consistent, and `d = (0,0)` identically at
`θ = 0` (TASK-29 behavior bit-for-bit preserved).

The same helper fixes rotated-text commit: typing widens the local box, moving
the pivot, which would slide a rotated string;
`reanchorDelta(at, boundsBefore, boundsAfter, angle)` pins `at`. No-op at 0,
so TASK-23 is untouched.

## Module layout & API signatures

### `src/editor/bounds.ts` (new, leaf — imports `model.ts` only)

Pure move, no behavior change. Owns text/badge metrics + the unrotated
(local-frame) axis-aligned bounds. Imported by `render.ts`, `hittest.ts`,
`resize.ts`, `rotate.ts`, `canvas.ts`; imports nothing but the model.

```ts
export interface Bounds { x: number; y: number; w: number; h: number }
export const FONT_STACK: string;
export function fontString(fontSize: number): string;
export function badgeHalfWidth(a: BadgeAnnotation): number;
/** The annotation's UNROTATED, local-frame axis-aligned box. */
export function boundsOf(a: Annotation, measure: CanvasRenderingContext2D): Bounds;
```

### `src/editor/rotate.ts` (new, leaf — imports `model.ts` types + `bounds.ts`)

```ts
export const ROTATION_SNAP_RAD: number;              // Math.PI / 12 (15°)
export function canRotate(kind: AnnotationKind): boolean;  // rect/image/text/badge
export function angleOf(a: Annotation): number;            // a.angle ?? 0, normalized
export function normalizeAngle(angle: number): number;     // to (-PI, PI]
export function pivotOf(b: Bounds): Point;
export function pivotOfAnnotation(a: Annotation, measure: CanvasRenderingContext2D): Point;
export function rotatePoint(p: Point, pivot: Point, angle: number): Point;
export function unrotatePoint(p: Point, pivot: Point, angle: number): Point;
export function pointerAngle(pivot: Point, p: Point): number;  // atan2
/**
 * Relative drag: startAngle + (pointerAngle(now) - pointerAngle(start)) — grabbing
 * the knob never snaps the shape to the pointer. `snap` rounds the ABSOLUTE result
 * to ROTATION_SNAP_RAD (so 0 is always reachable). Returns a normalized angle.
 */
export function rotationFromDrag(
  pivot: Point, startPointer: Point, pointer: Point, startAngle: number, snap: boolean,
): number;
/** World-space corners of a local box, in nw, ne, se, sw order. */
export function rotatedCorners(b: Bounds, angle: number): [Point, Point, Point, Point];
/**
 * Translation that keeps `anchorLocal` world-fixed when a shape's local bounds
 * change from `before` to `after` at constant `angle`. Returns {0,0} when
 * angle === 0 or the pivots match.
 */
export function reanchorDelta(anchorLocal: Point, before: Bounds, after: Bounds, angle: number): Point;
/** {...a, angle: normalized}; returns `a` unchanged when angle is unchanged. */
export function applyRotation(a: Annotation, angle: number): Annotation;
```

### `src/editor/resize.ts` (additions only)

```ts
/**
 * The rotate knob for `bounds` at `angle`, `offset` bitmap px outside the north
 * edge. Returns the LOCAL position (draw inside the rotated overlay transform)
 * and the WORLD position (hit-test directly). If the north-side knob would fall
 * outside `canvasSize`, it flips to the south side; if both are outside, north
 * wins. Draw and hit-test MUST both use this one function.
 */
export function rotateHandleFor(
  bounds: Bounds, angle: number, offset: number, canvasSize: { w: number; h: number },
): { local: Point; world: Point; flipped: boolean };

/**
 * The point pinned by `handle` (diagonally opposite corner for box/text handles,
 * fixed endpoint for arrow, center for badge/highlight), in LOCAL coordinates.
 * Its local coordinates are invariant across `applyResize`.
 */
export function anchorPointFor(a: Annotation, bounds: Bounds, handle: ResizeHandle): Point;
```

`resize.ts` gains an import of `rotate.ts` (leaf) for `rotatePoint`.
`resizeHandlesFor`/`handleAt`/`applyResize` stay exactly as they are.

### `src/editor/render.ts`

Extract the per-kind `switch` into a private `drawOne(ctx, a, images)`:

```ts
for (const a of list) {
  if (!a.angle) { drawOne(ctx, a, images); continue; }
  ctx.save();
  const pivot = pivotOfAnnotation(a, ctx);
  ctx.translate(pivot.x, pivot.y); ctx.rotate(a.angle); ctx.translate(-pivot.x, -pivot.y);
  drawOne(ctx, a, images);
  ctx.restore();
}
```

Export path gets rotation for free (`exporter.ts` untouched — AC#3).

### `src/editor/hittest.ts`

`hitTest` unchanged. In `hitsAnnotation`, before the switch:

```ts
const angle = a.angle ?? 0;
if (angle) p = unrotatePoint(p, pivotOfAnnotation(a, measure), angle);
```

Rotation is an isometry, so every distance-based tolerance test stays valid.

### `src/editor/canvas.ts`

Constants (CSS px, `cropScale()`-compensated at use):
`ROTATE_HANDLE_OFFSET_PX = 24`, `ROTATE_HANDLE_DRAW_PX = 11` (circle knob,
deliberately a different shape than the square resize grabbers).

New drag state, mirroring `resize`:

```ts
private rotateDrag: {
  original: Annotation; pivot: Point; startAngle: number; startPointer: Point; changed: boolean;
} | null = null;
```

Cleared at every state-reset site (`setBackground`, `restore`,
`clearSelection`, `clearDocument`, `applyCrop`, `openTextEditor` edit-mode,
`onUp`).

- `onDown` (select branch): rotate-knob world hit **before** the resize-handle
  check (tie-break for tiny shapes), which stays before the re-`hitTest`.
  Knob offered only when `canRotate(selected.kind)`.
- `onMove` priority: **rotate → resize → move → crop drag → draft → hover**.
  Rotate frame: `applyRotation(original, rotationFromDrag(...))`; lazy
  `history.push` on first changed frame; replace by `original.id`.
- Resize frame: local-frame + re-anchor steps (no-ops at angle 0); `onDown`'s
  resize-handle hit-test also inverse-rotates the pointer first.
- Cursors: knob hover `"grab"`, rotate drag `"grabbing"`. No standard CSS
  rotate cursor; a `url()` SVG cursor is deferred polish.
- `drawSelectionOverlay`: wrap marquee + resize handles in
  `save/translate/rotate/translate … restore` (body unchanged, coords stay
  local); when `canRotate`, draw connector line from padded north-edge
  midpoint to `rotateHandleFor(...).local` + circle knob (same
  white-fill/PALETTE[0]-stroke styling). `positionSelectionControls` called
  outside the transform.
- `positionSelectionControls`: anchor to `rotatedCorners(paddedBounds, angle)[1]`
  (rotated NE corner); keep viewport clamp and "drop below" fallback; also
  trigger the fallback when the button rect lands near the knob. Knob
  (N-edge midpoint) and button (NE corner) are separated by w/2 independently
  of angle, so rotation adds no new collision case beyond narrow shapes.
- Text overlay: `textEdit` carries `angle`/`pivot`; `positionTextEditor` sets
  `left/top` from `rotatePoint(at, pivot, angle)` and
  `transform: rotate(<angle>rad)` + `transform-origin: 0 0` (no transform at
  angle 0); `commitTextEditor`'s edit branch applies
  `reanchorDelta(at, boundsBefore, boundsAfter, angle)` via
  `translateAnnotation`. Both re-edit entry points pass the angle through.

## Test plan

1. `rotate.test.ts` (node env, fake measure ctx): rotate/unrotate round-trip
   and θ=0 identity; `normalizeAngle` wrap at ±π; `pivotOfAnnotation` per kind
   matches `boundsOf` center (badge ⇒ `at`); `rotationFromDrag` is relative
   (no jump on grab) and snaps to 15° incl. exactly 0; `rotatedCorners` order;
   `reanchorDelta` = (0,0) at θ=0 / matching pivots, and satisfies
   `rotate(anchor, pivotBefore, θ) === rotate(anchor, pivotAfter, θ) + d`;
   `applyRotation` identity-reference when unchanged, never mutates;
   `canRotate` table.
2. `hittest.test.ts`: rotated hit / unrotated miss per kind; existing cases
   re-pass with `angle: 0` and with the field absent.
3. `resize.test.ts`: `anchorPointFor` per handle/kind; composition test —
   resize a 45°-rotated rect, pinned world corner unchanged after re-anchor;
   `angle` survives `applyResize`.
4. `bounds.test.ts`: the `boundsOf` describe block moved out of
   `hittest.test.ts` unchanged (regression proof the extraction changed
   nothing).
5. E2E `tests/e2e/rotate.spec.ts` (iphone-webkit style): draw rect → select →
   drag knob ~45° → assert `.selection-delete` moved and the unrotated
   top-edge-midpoint pixel is no longer stroke color. If mouse-drag proves
   flaky under mobile emulation, drop the spec rather than ship a flaky test
   and record device verification in the task. `pnpm test:e2e` must pass
   regardless; rendered check on Windows (`pnpm tauri dev`).
6. Manual AC verification: rotate → export PNG and copy (rotated text and a
   *manual* badge specifically — both exercise the `measureText` pivot on the
   exporter's offscreen ctx); undo/redo; move/resize/re-edit/delete a rotated
   annotation; crop a document containing one.

## Risks / AC-regression watchlist

- **TASK-29 (resize)** — highest risk. `applyResize` is not edited at all;
  `reanchorDelta` returns (0,0) at θ=0. `resize.test.ts` must pass unmodified.
- **TASK-8** — `translateAnnotation` preserves `angle` via spread; delete
  button must look pixel-identical at 0°.
- **TASK-23 / 35.10** — text input transform strictly absent at 0°; re-audit
  iOS soft-keyboard `visualViewport`/`scrollIntoView` guards (a rotated
  element's client rect is its bounding box).
- **TASK-40** — crop translation commutes with rotation; manual pass.
- **TASK-35.11/.16 (touch)** — knob inherits `TOUCH_HIT_MULTIPLIER`; the
  north-edge flip rule must be device-verified with an annotation at the very
  top of the capture.
- **Performance** — pivot needs `measureText` for text/manual-badge per frame;
  the `if (!a.angle)` guard confines this to rotated annotations only.
- **Import boundary** — exporter's transitive graph must remain
  `exporter → render → rotate → bounds → model` only (blocking review item).
- **Out of scope** (do not creep in): group rotation (TASK-42),
  Escape-to-cancel, double-click-knob reset, custom `url()` cursor, live angle
  readout.
