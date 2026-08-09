# OpenSoegaki — Architecture

## Overview

OpenSoegaki is a tray-resident screenshot annotation tool built on Tauri 2.

```
┌─────────────────────────── OpenSoegaki ───────────────────────────┐
│                                                                  │
│  Rust core (src-tauri/)              TypeScript UI (src/)        │
│  ─────────────────────               ───────────────────         │
│  tray icon & lifecycle               editor (Canvas)             │
│  screen capture (xcap)    ← invoke   annotation object model     │
│  drag-out temp files                 undo/redo history           │
│  clipboard plugin                    PNG export (OffscreenCanvas)│
│                                       paste (clipboard) handler   │
│                                       toolbar / palette UI        │
└──────────────────────────────────────────────────────────────────┘
```

## Responsibility split

- **Rust owns the OS.** Everything that touches the operating system — tray,
  monitor capture, temp files for drag-and-drop — lives in `src-tauri/`.
- **TypeScript owns the canvas.** All drawing, hit-testing, interaction and export
  logic lives in `src/`. It never touches the filesystem directly.

## The annotation object model

The core design decision: **annotations are data, not pixels.**

`src/editor/model.ts` defines `Annotation` (arrow / rect / text / highlight / badge /
image) as plain objects. The live canvas (`canvas.ts`) and the exporter (`exporter.ts`)
both render the same model through one pure function (`render.ts`). Benefits:

- Undo/redo is a list snapshot, not a bitmap diff (`history.ts`)
- Select/move/delete (below) and a re-editable ".soegaki" file format or SVG export
  fall out naturally from the same object model

Selection itself is **not** part of the document: `Editor.selectedId` is transient
view state (a `string | null` keyed by annotation `id`), never stored on `doc`,
never `structuredClone`d into a history snapshot, and never passed through
`renderAnnotations` — so it cannot be undone/redone as data and cannot leak into
an exported PNG.

## Crop

The crop tool is a **destructive, re-rasterizing** operation, not a stored
crop rectangle: on apply, the editor re-rasterizes the background to the
selected region (`createImageBitmap(oldBitmap, x, y, w, h)`) and translates
every annotation by the crop origin (`translateAnnotation`, reused unchanged
from the select/move feature). This is a single `history.push(snapshot())` —
the same `{ imageBitmap, annotations }` mechanism already used for background
replacement — so one `Ctrl+Z` undoes both the bitmap and the annotation
positions, and `Ctrl+Shift+Z` redoes it, with no new history machinery.
Annotations outside the cropped region are **kept, translated (possibly to
off-canvas coordinates), never clipped or deleted** — clipping would mutate
annotation geometry and deleting would lose data; translate-and-keep is fully
reversible via undo and consistent with the select tool already allowing
annotations to be dragged partly off-canvas. `src/editor/crop.ts` holds the
pure `computeCrop` geometry (apply-time no-op/min-size guard and integer
normalizer) plus the handle geometry (`fullImageRect`, `handleAt`,
`applyHandleDrag`), and is deliberately not imported by `exporter.ts`.

The crop **region starts as the full loaded image** with a draggable corner
handle (`nw`/`ne`/`sw`/`se`) at each vertex. Dragging a corner shrinks or
expands that corner while the diagonally-opposite corner stays pinned,
clamped to the image bounds and to `MIN_CROP_PX` in each dimension (never
flipping past the pinned corner). Dragging inside the region (not on a
handle) is inert — the app deliberately does not support whole-region
translation in the MVP. An on-canvas **✓ Apply / ✗ Cancel** overlay (a small
floating `div.crop-controls`, positioned near the region's bottom-right
corner, offset clear of the SE handle so it never steals the handle's
clicks) commits or resets the crop with the mouse alone; `Enter`/`Esc`
remain as optional keyboard accelerators for the same two actions.

**Invariant: while the crop tool is active and an image is loaded, a region
with handles and ✓/✗ controls is always visible** (v2.1, 2026-07-16 —
revised from user E2E feedback on the v2 mouse-only-apply UI). Neither
cancel nor apply tears crop mode down:
- **✗ / `Esc`** resets the region to the full image (`cancelCrop()` sets
  `crop.rect = fullImageRect(...)`) — crop mode stays active with fresh
  handles, ready for another attempt. The document is never touched.
- **✓ / `Enter`** on a shrunk region applies the crop (single undoable step,
  as above) and then re-arms the region to the *new* cropped image's full
  extent, so the user can immediately crop again. On an unshrunk full-image
  region (or a below-`MIN_CROP_PX` region), it is the existing no-op guard:
  no document change, no history push, and the region simply stays as-is.

Because the region always starts (and resets to) full-image,
`hasPendingCrop()` is true for the entire time the crop tool is active.
Crop UI teardown (removing the ✓/✗ controls and clearing crop state) now
happens **only** when the user switches to a different tool, or a new
document replaces the current one (new paste/capture, or undo/redo) — each
of those immediately re-initializes a fresh full-image region if the crop
tool is still the active tool, so switching *away* from and back to crop, or
undoing/redoing while cropping, never leaves a dead toolbar state.

## Selection & hit-testing

`src/editor/bounds.ts` is a pure, leaf, format-agnostic module (imports only
`model.ts`) owning "where a shape is": `Bounds`, `boundsOf`, plus the text/badge
metrics (`fontString`, `badgeHalfWidth`) — moved here from `hittest.ts`/`render.ts`
(TASK-41) so `render.ts` has a legal way to reach `boundsOf` without a
`hittest.ts` import cycle. **`boundsOf` always returns the shape's UNROTATED,
local-frame axis-aligned box** — it never consults `a.angle`. Every resize
handle, marquee coordinate, and hit-test below is expressed in this local
frame; world position is `rotate(local, pivot, a.angle)` (see "Rotating
selected annotations" below). `src/editor/hittest.ts` (`hitTest`) is likewise
pure and format-agnostic — the same code a future `.soegaki` loader or SVG
exporter could reuse. It is deliberately **never imported by `exporter.ts`**;
that import boundary is the mechanical guarantee that selection chrome cannot
be rasterized into exported/copied images. The selection marquee itself is
drawn by a private `Editor.drawSelectionOverlay` method, called from
`Editor.render()` after `renderAnnotations` and the draft — i.e. only
reachable from the live canvas path.

Hit-testing rules:
- **Rects use an edge band, not the filled interior** — since rects render as
  outlines, clicking the hollow center must not select a large rect that visually
  contains other shapes. A hit requires the point to be within tolerance of the
  perimeter (inflated outer bounds minus deflated inner bounds).
- **Arrows** hit-test against distance to the shaft segment; **text** hit-tests
  against the filled measured bounding box.
- Tolerance is computed in **bitmap pixels**, scale-compensated at the call site
  in `canvas.ts` (`BASE_TOL_PX * (canvas.width / rect.width)`), since the canvas
  is CSS-scaled but `hittest.ts` itself stays unit-agnostic.
- **Rotated annotations (TASK-41):** before running the per-kind test above,
  `hitsAnnotation` inverse-rotates the pointer about the shape's pivot
  (`unrotatePoint(p, pivotOfAnnotation(a, measure), a.angle)`) — rotation is an
  isometry, so every distance-based tolerance test above stays valid unchanged.
  Guarded by `if (a.angle)`, so an unrotated annotation (the overwhelming
  majority) takes the exact pre-TASK-41 code path.

## Resizing selected annotations

`src/editor/resize.ts` (TASK-29) is a pure module — same import-boundary
discipline as `crop.ts`/`hittest.ts`: DOM-free, ctx-free, and deliberately
**never imported by `exporter.ts`**. It owns handle layout, hit-testing, and
per-kind resize transforms:

- `resizeHandlesFor(a, bounds, srcHandleOutset)` returns the `HandleSpec[]`
  for an annotation, positioned from the `Bounds` the caller already has via
  `bounds.ts`'s `boundsOf`. Box kinds (rect, image) get all 8 corner+edge
  handles; text and badge get the 4 corners only; arrow's 2 handles are its
  `from`/`to` points read directly off the annotation (not the normalized
  bounds), so each endpoint keeps its own identity. **Highlight returns
  `[]`** — bbox-scaling a freehand polyline would distort the stroke shape
  unpredictably, so it stays move/delete-only, same rationale as its resize
  exemption. `srcHandleOutset` (bitmap px, Addendum I, 2026-08-09) is read
  only by a rect magnifier's box-handle arm — see "Magnifier (loupe)" below.
- `handleAt(handles, p, hitRadius)` is the nearest-within-radius pick, the
  same pattern as `crop.ts`'s corner `handleAt`.
- `applyResize(original, bounds, handle, pointer, shiftKey, limits, canvasSize, srcHandleOutset)`
  returns a new annotation for the dragged handle + pointer position — never
  mutates `original`. `limits: MagnifierSizeLimits` (Addendum B, 2026-08-02),
  `canvasSize` (added alongside the rect magnifier variant, D5, 2026-08-08),
  and `srcHandleOutset` (Addendum I, 2026-08-09) are read only by the
  magnifier branch (`limits` by both shapes, `canvasSize` and
  `srcHandleOutset` by the rect shape's box-handle gesture); every other
  kind ignores them — see "Magnifier (loupe)" below. Per-kind transforms (no
  clamping to canvas bounds, consistent with move — only per-kind min/max and
  no-flip-past-anchor):
  - **rect**: corner drag pins the diagonally opposite corner and resizes
    freely; edge drag moves only that edge; **Shift on a corner locks the
    pre-drag aspect ratio**; minimum 8px per axis (`MIN_RECT_PX`).
  - **image**: same 8-handle layout as rect, but corner drag is
    **aspect-locked by default and Shift frees it** — the inverse of rect's
    modifier. Rationale: the modifier is the *less-common* intent per kind —
    stretching an image out of proportion usually looks broken, so it is
    locked by default; free-distortion is normal for a rect. Minimum 16px per
    axis (`MIN_IMAGE_PX`).
  - **arrow**: only 2 handles (`from`/`to`); the dragged endpoint follows the
    pointer, the other stays fixed; **Shift snaps the dragged endpoint's
    angle** (relative to the fixed one) to 45° increments, magnitude
    unchanged; updates that would bring the endpoints closer than
    `MIN_ARROW_LEN` (4px) are clamped along the same direction (or rejected
    outright if the pointer lands exactly on the fixed endpoint).
  - **text**: 4 corner handles; the vertical distance from the pointer to the
    pinned (diagonally opposite) corner, as a ratio of the pre-drag bounds
    height, scales `fontSize` (clamped to 8–400); the effective scale is then
    recomputed from the *clamped* fontSize so `at` repositions consistently
    with the actually-rendered size, keeping the pinned corner fixed. Shift
    has no effect — text has no free-aspect concept distinct from its single
    `fontSize` scalar.
  - **badge**: 4 corner handles; `radius = clamp(max(|dx|,|dy|) from center, 8,
    400)`; `at` and `number` never change.
  - **highlight**: `applyResize` returns `original` unchanged (handles are
    already `[]`, so a drag can never even start).

**`canvas.ts` wiring:** a `this.resize` drag-state field mirrors `this.move` —
armed in the select-tool `onDown` branch when a resize handle hit wins over
reselecting an overlapping annotation (checked *before* the plain `hitTest`
reselect path), holding a `structuredClone` of the pre-drag annotation plus
its pre-drag `boundsOf` so every `onMove` frame recomputes the resize from the
same fixed base rather than incrementally (same anti-drift rationale as
`move`). `onMove`'s priority order is **resize → move → crop drag → draft →
hover**; the history push happens lazily, once, on the first frame whose
result actually differs from the pre-drag original (a cheap `JSON.stringify`
deep-equal — same lazy-push pattern as `move`'s `dx !== 0 || dy !== 0` check,
just without a scalar delta to compare). `drawSelectionOverlay` draws the
handles as screen-constant-size squares (`HANDLE_DRAW_PX` × `cropScale()`,
same styling as the crop tool's corner handles) at the exact positions
`resizeHandlesFor` reports — the same unpadded `boundsOf` used for hit-testing,
so drawn position and hit region never drift apart. Hovering a handle while
the select tool is active shows a matching directional cursor
(`cursorForResizeHandle`: nwse/nesw/ns/ew for box handles, "move" for arrow
endpoints, since dragging an endpoint repositions a point rather than
resizing along an axis).

## Rotating selected annotations

`src/editor/rotate.ts` (TASK-41) is a pure, leaf module (imports only `model.ts`
types and `bounds.ts`) owning rotation math: pivot/rotate/unrotate, angle
normalization, drag→angle conversion with Shift-snap, corner rotation, and the
re-anchor translation that lets resize compose with rotation without drift.
Like `hittest.ts`/`resize.ts`/`crop.ts`, it is **never imported by
`exporter.ts`**.

**Semantics.** `angle?: number` on `AnnotationBase` (every kind carries it) is
radians, **clockwise in canvas y-down coordinates** — exactly what
`ctx.rotate()` and CSS `transform: rotate()` both consume — normalized to
`(-π, π]`; absent or `0` means unrotated. Rotation is render-time only, never
baked into a shape's points (arrow's `from`/`to`, rect's `a`/`b`, etc.) — the
same "annotations are data, not pixels" invariant every other transform in the
model follows. **The pivot is always the center of the annotation's unrotated
`boundsOf` box** (`rotate.ts`'s `pivotOfAnnotation`) — one rule, no per-kind
special case; for a badge this box is already centered on `a.at`, so the pivot
degenerates to `a.at` with no extra code.

**Rendering and hit-testing get rotation from one generic transform.**
`render.ts`'s `renderAnnotations` wraps a rotated shape's draw call in
`save/translate(pivot)/rotate/translate(-pivot)/restore`; `hittest.ts`'s
`hitsAnnotation` inverse-rotates the pointer about the same pivot before
running the unchanged per-kind test (see "Selection & hit-testing" above).
Both are guarded by `if (a.angle)`, so an unrotated document — still the
overwhelming majority — takes the byte-identical pre-TASK-41 code path and
pays zero extra `measureText` calls. Because `exporter.ts` calls the same
`renderAnnotations`, export/copy rasterize rotation for free with no changes
to `exporter.ts` itself.

**Rotatable kinds.**

| Kind | Rotatable? | Rationale |
| --- | --- | --- |
| rect, image, text, badge | Yes | Standard select-tool rotate-knob affordance |
| arrow | No | Direction is already first-class in `from`/`to`; an `angle` field would be a second, redundant representation of the same fact, and the existing `to`-endpoint drag with Shift-45° snap (see "Resizing selected annotations") already rotates it |
| highlight | No | Freehand marker stroke; move/delete-only, the same rationale as its TASK-29 resize exemption |
| magnifier | No | Correctness, not taste: `ctx.drawImage`'s SOURCE rectangle is always axis-aligned in image space and unaffected by the ctx transform, while the source ring drawn inside `renderAnnotations`'s generic rotate transform WOULD swing around the lens's pivot — pointing at a region the loupe does not actually sample, breaking the annotation's entire spatial claim. (A circle is rotationally symmetric anyway, so the affordance would be visually meaningless even where it were safe.) **TASK-42 hazard:** a future multi-select group rotation must treat magnifier as translation-only — rigidly rotate `from`/`at`, never set `angle` — setting `angle` on a magnifier reproduces the broken state above |

Both exempt kinds still **render** rotated if given an angle (the generic
transform doesn't check `canRotate`) — only the select-tool affordance is
gated, via `rotate.ts`'s `canRotate(kind)` — so a future multi-select group
rotation (TASK-42, out of scope here) needs no new render work.

**Resize composes with rotation via a re-anchor translation (drift-free by
construction).** `boundsOf` always stays local-frame/unrotated, so resizing a
rotated shape works entirely in that local frame: `canvas.ts`'s resize gesture
inverse-rotates the pointer about the **pre-drag** pivot
(`pivotOf(bounds)`, fixed for the whole gesture, same anti-drift rationale as
`move`/`resize`'s existing fixed-`original` pattern), calls the existing
`applyResize` verbatim, then translates the result so the handle's pinned
point (`resize.ts`'s `anchorPointFor` — the diagonally opposite corner for
box/text handles, the fixed endpoint for arrow, the center for badge/
highlight) lands back on its exact pre-drag world position
(`rotate.ts`'s `reanchorDelta`). Every one of these steps is gated on
`angle`, so at `angle === 0` the composed gesture is the exact pre-TASK-41
code path — `reanchorDelta` returns `{0, 0}` identically there, and
`applyResize`/`resizeHandlesFor`/`handleAt` are untouched by TASK-41 (the
TASK-29 regression proof: `resize.test.ts` passes unmodified). The same
`reanchorDelta` also fixes rotated-text re-edit: typing changes the local box
width, which would otherwise slide a rotated string, so `commitTextEditor`'s
edit branch re-anchors `at` the same way.

**Rotate-knob UX.** `resize.ts`'s `rotateHandleFor(bounds, angle, offset,
canvasSize, margin)` is the one function both drawing and hit-testing call —
`ROTATE_HANDLE_OFFSET_PX` (24 CSS px, `cropScale()`-compensated) outside the
selection marquee's padded north edge. **Three placements** are tried in
order against an inset rect (`canvasSize` shrunk by `margin` —
`(ROTATE_HANDLE_DRAW_PX / 2 + 2) * cropScale()`, keeping the knob's own drawn
radius, not just its center point, on-canvas): `"north"` if the natural
position's world point falls inside the inset; else `"south"` (the shape's
south edge instead — a rotated shape near the top of the capture can swing
"north" off-canvas); else `"clamped"` — component-wise clamp of the north
world position into the inset rect, with `local` recomputed by
inverse-rotating the clamped world point about the same pivot (load-bearing:
the connector line, drawn in local coordinates inside the rotated overlay
transform, must still point at the actual knob). `canvas.ts`'s `rotateDrag`
gesture state mirrors `move`/`resize`.

**Knob appearance (round 4, user-chosen design "A3").** The rotate knob is a
naked circular-arrow glyph — a 260° arc (-65°…195°, clockwise) with a filled
arrowhead and a centre pivot dot, in `PALETTE[0]` over a white casing stroke
with a soft drop shadow, drawn inside the rotated selection overlay so its
tilt reads as the current angle. All of its geometry is expressed as ratios
of `ROTATE_HANDLE_DRAW_PX × cropScale()`; `ROTATE_GLYPH_SEAM_RATIO` (0.705)
places the connector's seam at the arc casing's outer edge, and
`ROTATE_GLYPH_OUTER_RATIO` (0.80, the arrowhead base corner plus its casing —
the glyph's true maximum extent) feeds `knobMargin()`, which the `"clamped"`
placement of `rotateHandleFor` uses to keep the glyph fully on-canvas. Drawn
size is independent of grab size: `handleHitRadius()` (12 CSS px, ×2 for
touch, × `cropScale()`) is unchanged, and knob-vs-resize-handle arbitration
stays nearest-wins with the knob winning ties. Hover/drag use the inline
data-SVG rotate cursor with `grab`/`grabbing` fallbacks.

**Knob vs. resize-handle priority is nearest-wins, knob as tie-break**
(round 2 review fix — giving the knob absolute priority stole clicks meant
for a resize handle that happened to be nearer). `resize.ts`'s
`nearestHandle(handles, p, hitRadius)` is the one owner of "nearest handle
within radius, plus how far" — `handleAt` is now a thin delegate to it.
`canvas.ts`'s private `rotateOrResizeTarget` computes `nearest =
nearestHandle(...)` (pointer inverse-rotated into the local frame first, an
exact no-op at angle 0) and `knobDist = hypot(p − knob.world)` (only when
`canRotate(kind)`) with the **same** `r = handleHitRadius(pointerType)` for
both, then arms/hovers rotate iff `knobDist <= r && (nearest === null ||
knobDist <= nearest.dist)`, else resize iff `nearest !== null`, else falls
through to `hitTest` (reselect). Both `onDown`'s arm logic and `onMove`'s
hover-cursor logic call this one method, so they can never disagree about
which control a pointer position lands on; the knob's draw offset itself is
never touch-enlarged, only the hit radius `r` is (via `handleHitRadius`'s
existing `TOUCH_HIT_MULTIPLIER`).

The rotate drag itself is **relative** (`rotate.ts`'s `rotationFromDrag`:
`startAngle +` the pointer's own angular delta from the pivot, so grabbing the
knob never snaps the shape to the pointer), with Shift snapping the absolute
result to 15° (`ROTATION_SNAP_RAD`) so 0° stays reachable; a lazy
`history.push` on the first frame that actually changes the angle keeps this
a single undo step, same pattern as move/resize. `onMove`'s priority is
**rotate → resize → move → crop drag → draft → hover**. The floating delete
button (`positionSelectionControls`) anchors to the *rotated* NE corner
(`rotate.ts`'s `rotatedCorners`) instead of the raw padded box, and its
existing "drop below the corner" viewport-clamp fallback now has **two
independent triggers**, checked before the fallback applies: (1) the original
top-edge clamp (selection near the stage's top edge, no room above the
corner) and (2) the rotate knob (TASK-41) landing within
`HANDLE_HIT_PX * TOUCH_HIT_MULTIPLIER + SELECTION_CONTROLS_MARGIN_PX` of the
*ideal* (unclamped) button rect — using the touch-worst-case radius
unconditionally, since layout must not depend on which pointer type happens
to be active. **Cursor (round 3):** a custom `url()` data-SVG cursor —
`ROTATE_CURSOR_HOVER`/`ROTATE_CURSOR_ACTIVE` module constants in `canvas.ts`,
set where the knob is hovered/actively dragged (no other cursor site
changes). There is no standard CSS rotate cursor, so this was deferred at
TASK-41's first pass; adopted once real-app feedback showed the plain
`grab`/`grabbing` keywords alone didn't read as "rotate" either. The glyph is
two overlaid arc+arrow strokes — a wider white one underneath, a narrower
black one on top — so it stays legible over both light and dark backgrounds
(the same white-outline-then-color-pass trick `render.ts`'s arrow/rect/text
drawing already uses), with a `, grab` / `, grabbing` keyword fallback for a
browser that rejects the custom cursor image. `#` stays percent-encoded as
`%23` in the data URI — WebView2 (the desktop app's webview) truncates at a
literal `#`, reading it as a fragment separator.

**Out of scope (TASK-41):** multi-select group rotation (TASK-42, though the
pure math in `rotate.ts` is written to be reusable there), Escape-to-cancel a
rotate drag, double-click-the-knob-to-reset, and a live angle readout while
dragging (the knob glyph's own tilt serves as a coarse one).

## Inserting images as annotations

Arbitrary images (logos, screenshots-of-screenshots, etc.) can be overlaid on
top of the captured background as a first-class `"image"` annotation kind
(`ImageAnnotation` in `model.ts`), rendered and exported through the same
`renderAnnotations` path as every other shape. Three intake paths all funnel
into one method, `Editor.insertImage(bitmap)`:

1. **Toolbar button** (`#insert-image`) invokes the `pick_image` Rust command,
   which shows a native file-open dialog filtered to image extensions and
   returns the chosen file's raw bytes.
2. **Drag-and-drop** onto the editor. Tauri's `dragDropEnabled` defaults to
   `true`, which intercepts the OS drag before it ever reaches the DOM as
   HTML5 `drop` events — so this is wired through
   `getCurrentWebview().onDragDropEvent(...)` instead, filtering to the first
   dropped path with an image extension and reading it via the
   `read_image_file` command. The drop has dual behavior depending on editor
   state: if a background is already loaded, the dropped image is inserted as
   an annotation (as above); if the editor is empty, the dropped image becomes
   the background instead, via the same `loadImage` path the capture button
   and paste handler use.
3. **Ctrl+Shift+V** reads the OS clipboard image via
   `@tauri-apps/plugin-clipboard-manager`'s `readImage()` and decodes its RGBA
   bytes into an `ImageBitmap`. This is deliberately distinct from plain
   Ctrl+V, which keeps its existing background-replace semantics (see
   "Capture flow" below) — the two are split by a `keydown`-vs-`paste` event
   split with a `suppressNextPaste` flag so a single Ctrl+Shift+V keystroke
   never also fires the plain-paste background-replace path.

`insertImage` scales the bitmap to fit within 90% of the canvas (never
upscaling a smaller image) and centers it, then commits a new
`ImageAnnotation` through the same `history.push` + append path used by every
other tool — so insertion is undoable like any other annotation.

**Pixel storage: `Doc.images`.** Unlike every other annotation kind, an image
annotation's pixels don't fit in a small JSON-shaped object. `Doc` carries a
side-table, `images: Map<string, ImageBitmap>`, keyed by annotation id;
`ImageAnnotation` itself stores only position/size (`at`, `width`, `height`).
This map is a **monotonic session cache**: entries are added on
`insertImage()` and never pruned by `setBackground`/`restore`. It is
deliberately **excluded from history snapshots** — `history.ts` `structuredClone`s
the annotation array per undo step, and `ImageBitmap` cannot be structurally
cloned that way (nor would re-cloning a large bitmap per step be cheap); since
the map is append-only and keyed by id, a `redo()` that brings an
`ImageAnnotation` back into `doc.annotations` can always find its bitmap
again in the same never-pruned map. `renderAnnotations` takes `images` as an
explicit third parameter and silently skips drawing if an id's bitmap is
missing, rather than throwing.

**Scope note (AC #6):** placed images are selectable, movable, deletable and
resizable through the standard select tool — `hittest.ts`'s `hitsAnnotation`
treats `"image"` as a filled-bounds hit, just like `"text"`, and
`translateAnnotation`/`deleteSelected` already handle them generically; resize
is handled generically too, see "Resizing selected annotations" below
(TASK-29).

**Future serialization (TASK-16):** a `.soegaki` file format will need to
encode each image annotation's pixels alongside its id — the natural approach
is one PNG blob per id, keyed the same way `Doc.images` is keyed today.

## Magnifier (loupe)

A `"magnifier"` annotation (`MagnifierAnnotation` in `model.ts`, TASK-46) puts
a wide-context screenshot and a zoomed-in detail in one image: a **source**
region on the background and a magnified **lens** drawn elsewhere on the same
canvas, joined by a connector — so the recipient sees both the context and
the detail without a second cropped image. Two lens shapes exist, a circle
(the original) and a resizable rectangle ("cube mode", added 2026-08-08 —
see "Rect variant" below); this section describes the circle unless stated
otherwise. Design history: `docs/design/2026-08-01-magnifier-loupe.md`
(original design), Addendum A `docs/design/2026-08-01a-magnifier-creation-revision.md`
(touch-first slide-to-aim creation gesture), Addendum B
`docs/design/2026-08-02-magnifier-connector-and-size-limits.md`
(single-segment connector; operability-based size limits), Addendum C
`docs/design/2026-08-02a-magnifier-tapered-connector.md` (the connector
widens toward the lens), the "magnifier UX brush-up" note
`docs/design/2026-08-06-magnifier-ux-brushup.md` (source-body drag, zoom grip
redesign, frame weight), and `docs/design/2026-08-08-magnifier-cube-mode.md`
(the rectangular lens variant) — each addendum's header cross-links the
note(s) it partially supersedes or overrides.

**Data model and the derived-source rule.** The lens (`at`: center, `radius`)
and `zoom` are stored and authoritative, along with `from` (the source
region's center); the source region itself is **derived**, never stored: a
circle of radius `radius / zoom` centered on `from`. With a circle there is
exactly one size scalar per object, so uniform magnification is
structural — there is no representable state where the magnified content is
distorted, and no invariant to maintain across call sites (the same argument
`rotate.ts` already makes for arrow not having a redundant `angle`). The lens
is what the user directly frames and drags, so keeping it authoritative lets
it reuse the existing badge-shaped resize/hit-test machinery almost
verbatim — deriving the lens from the source instead would fight that
machinery and make "resize the lens at constant zoom" unexpressible. All of
this derived geometry — `magnifierSourceRadius`, `magnifierSourceRect`,
`magnifierLensRect`, the sample-rect clamp, the fan-and-arc connector
construction, the operability size limits, auto-placement, and the S/M/L size
derivation — lives in one pure leaf module, `src/editor/magnifier.ts` (imports
only `model.ts`/`bounds.ts` types), so no other file re-implements "where does
the source circle sit."

**Model union (2026-08-08).** `MagnifierAnnotation` is a discriminated union,
`CircleMagnifierAnnotation | RectMagnifierAnnotation`, narrowed on an optional
`shape` field (`shape` absent, or `"circle"`, means circle — every
pre-existing annotation predates the rect variant and never carries the
field, so no migration is needed; `shape: "rect"` carries `width`/`height`
instead of `radius`). Translate/undo/commit/degeneracy logic is 100% shared
between the two shapes, so this is a union inside the existing `"magnifier"`
kind, not a new `AnnotationKind` — a new kind would duplicate an arm in every
exhaustive `switch (a.kind)` this codebase already has. See "Rect variant"
below for the full geometry/resize/UI delta; `magnifierSourceRadius`/
`clampZoom` are narrowed to `CircleMagnifierAnnotation` (a rect has no single
radius, so its source is derived per-axis instead), while
`magnifierSourceRect`/`magnifierLensRect` and `boundsOf`'s magnifier case
became shape-aware.

**Circle marker, not the sampled square.** `ctx.drawImage` samples an
axis-aligned rectangle internally (the source circle's bounding square), but
the only marker actually drawn on the image is the **source circle**: the
square's corners are clipped away by the lens's circular clip and never
appear in the output, so drawing the square would over-claim what the loupe
shows. The circular marker also turns the connector into a clean
circle-to-circle construction instead of an ugly circle↔rect one.

**Connector: an aperture-anchored fan that ends in an arc flush with the lens
rim (Addendum C, 2026-08-02a §8 — overrides Addendum C's own first cut,
which in turn overrode Addendum B's stroked segment).** Addendum B's single
rim-to-rim line fixed the original "busy cone" complaint; Addendum C's first
cut turned that into a flat-ended, weight-anchored tapered quad (narrow at
the source, `Math.max(markerStroke, a.strokeWidth)` at the lens) after
real-device feedback asked the connector to read heavier and widen toward
the lens. A follow-up device check asked for the taper to be **much more
extreme** — enough that a stroke-weight ceiling could never deliver it — so
§8 changes what the lens end is anchored to: instead of a border weight, it
is an **aperture** of the lens itself. `connectorShape(c1, r1, c2, r2, w1,
w2)` still builds on the same trimmed rim-to-rim axis (`p1`, `n`) Addendum B
derived, but now returns `{source: [p1 + n·w1/2, p1 − n·w1/2], lens: {center,
radius, startAngle, endAngle, counterclockwise}}`: the source end is an
unchanged straight edge at `w1 = markerStroke`, while the lens end is an ARC
along the lens's own rim, spanning the angle `θ = asin(w2 / (2·r2))` on
either side of the axis. Because `w2` (`render.ts`'s
`MAGNIFIER_CONNECTOR_FAN_RATIO × a.radius`, `FAN_RATIO = 0.6`, floored by the
stroke weights so the taper direction can't invert) scales with the lens
radius itself, `θ` is a FIXED angle — **17.46°** (a ~35° mouth) — at every
lens size, document scale, and display scale: an aperture is the right unit
for a beam, where a stroke weight would read wide on a small lens and like a
pinstripe on a large one. A GEOMETRIC domain bound,
`MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO` (`magnifier.ts`, `1.0`, a
different owner than the editorial `FAN_RATIO`), caps `w2` at `r2` so
`asin`'s argument never exceeds `0.5` and the arc stays well under a
semicircle even when a heavy `strokeWidth` would otherwise ask for more than
the lens supports. The lens end HAD to become an arc (not stay flat, unlike
the source end): a flat end's sag away from the true rim scales with the end
width itself once that width is aperture-anchored (`r2·(1 − sqrt(1 −
FAN_RATIO²/4)) ≈ 0.046·r2`) — sub-pixel on a phone-sized lens but tens of
pixels on a large desktop-capture lens, a real and scale-dependent gap the
old stroke-weight-anchored end never had to worry about; an arc has zero sag
by construction at every size. Painted two-pass like the rest of the
family — `stroke(path)` in `OUTLINE` at `lineWidth = 4` (the house halo
constant, applied to the shape's own boundary; `stroke()` follows an arc
exactly as it follows a line, so the halo wraps the arc too), then
`fill(path)` in `a.color` — under both rings, unchanged draw order. Coverage
of the two ends differs in kind, not just degree: the flat source end is
still covered by the source ring's `≥ 2.5px` band overshooting a 2px flat
end by construction (same argument as before, including for an inherited
miter join, which bisects radially inward); the lens end has no corner to
have a join at all — the arc IS the rim, so its two junctions with the
straight sides sit exactly on the lens border's own band regardless of join
style. `ctx.lineJoin` is still never set. The suppression guard
(`d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX` ⇒ no connector) is unchanged
and stays editorial, not numerical.

**Rendering seam: `background` is `renderAnnotations`'s required 4th
parameter.** `render.ts`'s `renderAnnotations(ctx, list, images, background:
ImageBitmap | null)` and `drawOne` both take it; `canvas.ts`'s `render()`
(both the list call and the draft call) and `exporter.ts` pass
`doc.imageBitmap`. It is required, not optional, so TypeScript forces every
call site to supply it in the same commit rather than silently rendering a
magnifier with nothing inside. Named `background`, not `source` — `source`
would collide with `MagnifierAnnotation.from`/`magnifierSourceRect`'s own
vocabulary and with `drawImage`'s own source rectangle.

**Live sampling only — `doc.imageBitmap`, never other annotations, never
`ctx.canvas`.** The loupe samples the background bitmap directly at draw
time; it never bakes a copy into `Doc.images` the way inserted images do.
Consequences: a later annotation drawn over the detail does not appear
magnified inside the lens (ordinary list draw order — a later annotation
paints over an earlier one, same as everywhere else); a crop (or its undo) is
picked up for free, since the loupe always reads the *current*
`doc.imageBitmap`; and there is no second "where does this pixel data come
from" cache that can go stale, unlike the documented `Doc.images` monotonic-
cache wart above.

**Crop behaviour.** `applyCrop` translates every annotation by `-origin` via
`translateAnnotation`, which for a magnifier moves **both** `from` and `at`
(the default `part: "all"`) — translate-and-keep, exactly like every other
kind, fully undoable. If the source region ends up partly or fully outside
the new background, `clampSampleRect` intersects the sample square with the
bitmap rect and clips the destination square by the same proportion — the
lens shows only the in-bounds slice (or nothing, if fully outside), while the
source ring and connector still draw so the user can see the loupe and drag
it back. Nothing is auto-deleted or clamped into the image, consistent with
the crop policy documented above.

**Selection & the one orthogonal handle assignment (revised by the "magnifier
UX brush-up" design note, 2026-08-06 — the `src-move` handle is deleted; the
whole source disc is now a drag surface, live even when the magnifier is
unselected).**

| Gesture | Effect | Field changed |
| --- | --- | --- |
| Drag the lens body | Moves the lens only | `at` |
| Drag a lens corner handle (existing `nw`/`ne`/`sw`/`se`, on the lens's bounding square) | Resizes the lens at fixed zoom, center-pinned | `radius` |
| Press/drag anywhere inside the source disc (selected or not) | Moves the source region | `from` |
| Drag `src-zoom` (round grip at 45° on the source rim, selected only) | Changes zoom at fixed lens radius | `zoom` |

Every degree of freedom has exactly one control, and every control has
exactly one meaning — grabbing and dragging a magnified disc must never
silently change what it magnifies. `hittest.ts`'s `magnifierHitPart(a, p,
tolerance, sourceMinHitHalf)` is the one owner of "which disc did the
pointer land on" (lens disc/rect first, source disc/rect second — paint
order; `null` if neither). `sourceMinHitHalf` (Addendum G, 2026-08-08) is a
required per-axis floor on the RECT source's hit half-extent only — the
circle branch ignores it, since its own `minSource` floor is already
fingertip-sized; see "Operability / size limits" below for why the rect
needs one at all. `model.ts`
exports the shared `MagnifierPart = "lens" | "source"` union so the probe's
return type *is* `translateAnnotation`'s `part` parameter, no separate
vocabulary or mapping layer. `canvas.ts` decides the part ONCE, at
`pointerdown`, from this same function, and freezes it into the `move` gesture
state for the whole drag — the earlier `original.kind === "magnifier" ? "lens"
: "all"` derivation at `pointermove` time is gone, not left as a fallback.
`resize.ts` now has exactly one round `ResizeHandle`, `"src-zoom"`, still
listed FIRST in `resizeHandlesFor` so it wins exact ties in `nearestHandle`
(now against the disc it sits on, which is itself hit-testable), and
`HandleSpec.shape?: "square" | "grip"` (renamed from `"circle"` — with
`src-move` gone there is exactly one non-square family). `canvas.ts`'s
`drawSelectionOverlay` draws the grip via a dedicated `drawZoomGrip` helper
(its own `save()`/`restore()`, since it sets `lineCap = "round"`): a 16 CSS px
accent disc with a white casing ring and three white tangential ridges
(perpendicular to the outward radial direction — the scrollbar-thumb grab
idiom), replacing the plain accent-filled circle both former source handles
used. While the magnifier is selected, `drawSelectionOverlay` also fills the
source disc with a flat accent tint (`PALETTE[0]` at `MAGNIFIER_SOURCE_TINT_ALPHA`
= 12%, via `ctx.globalAlpha` rather than a second hardcoded copy of the accent
color): `clip()` to the source disc FIRST, then `evenodd`-fill a `Path2D`
containing both the source and lens discs. The clip is what suppresses the
lens's own exclusive body (nothing drawn after `clip()` can land outside the
source disc at all); `evenodd` is what punches the lens-overlap out within
that clip — the tinted region always equals the region a press actually
starts a source drag from, including the fully-contained case, where the
tint correctly vanishes. (Round-1 review: an earlier version used `clip()` +
`destination-out` instead of `clip()` + `evenodd`, which was wrong on two
counts — `destination-out` only erases by the fill's own alpha, so most of
the tint survived inside the overlap, and it erased the live canvas's
already-rendered content underneath, not just the tint layer, since this
draws after `renderAnnotations`.) Chrome only, drawn before the handle loop,
never reaches `exportPng()`. A small `"2.4×"` zoom readout (one decimal, trailing
`.0` trimmed) is drawn beside the source ring in `drawSelectionOverlay`
only — selection chrome, never exported.

**Creation: slide-to-aim, release to confirm (Addendum A, 2026-08-01a —
revised after real-iPhone feedback on the original radial-drag gesture).**
The original design's radial drag (down = source center, drag distance =
source radius) made every finger movement a zoom change, and put the user's
finger on top of the very detail being magnified — painful on a touchscreen.
The revised gesture separates *aiming* from *sizing*:

1. **`pointerdown`** plants the source circle at the pointer with the
   **default source radius** (`defaultSourceRadius`, long-side-based — see
   below), derives `{radius, zoom}` **once** via `deriveLensSizeForSource`
   and places the lens **once** via `placeLens`, then **freezes**
   `offset = at - from` plus `radius`/`zoom` into a new gesture-state field,
   `canvas.ts`'s `magnifierPlace` — mirroring the "recompute from a fixed
   base every frame, never incrementally" anti-drift discipline `move`/
   `resize`/`rotateDrag` already use.
2. **`pointermove`** sets `from = pointer` and `at = clampLensCenter(pointer
   + offset, radius, canvasSize)` (`magnifierSlideUpdate`, magnifier.ts) —
   **`radius`/`zoom` never change** during the slide; the lens rides
   alongside the finger at a constant offset, showing live magnified
   content. The finger occludes the source, never the lens, so the lens
   becomes the live viewfinder the user aims with — the whole fix for the
   "dragging changes the zoom" pain point. Re-running `placeLens` every
   frame instead of freezing the offset was considered and rejected: it
   would flip the lens between sides (E→W) mid-slide as the source
   approaches an edge, which is jarring and moves the very thing being read.
3. **`pointerup`** commits **unconditionally** — a tap is just the
   zero-length case of the same gesture, no separate branch or threshold —
   then **auto-selects the new loupe and switches to the select tool** (see
   below). `Ctrl+Z`/`#undo` is the safety net; there is no in-gesture cancel,
   consistent with `clearDocument`'s stance.

**Auto-select on commit — the magnifier's one exception to "new annotations
are not auto-selected" (see "Toolbar" below).** On `pointerup`, `canvas.ts`
commits the annotation, then calls `setTool("select")`, then sets
`selectedId` to the new annotation's id, then renders. **This order is
load-bearing:** `setTool` calls `clearSelection()` internally (which nulls
`selectedId` and renders), so `selectedId` must be assigned *after*
`setTool` returns or the assignment is silently wiped. The precedent for a
compound tool handing off to the select tool on completion already exists —
`applyCrop()`/`cancelCrop()` both exit via `setTool("select")` (TASK-40); the
magnifier is the other compound object (lens + source) whose halves almost
always need immediate adjustment, so all four handles and the floating
delete button are live with zero extra taps. Multi-loupe workflows cost
exactly one extra tap (re-select the magnifier tool) instead of the
three-tap round trip the non-auto-selecting version required for *every*
loupe.

**Default source radius: long-side-based, not short-side.** Now that the
slide no longer sets the source radius, `defaultSourceRadius` is the *sole*
determinant of creation-time zoom for a given S/M/L preset:
`min(MAGNIFIER_SOURCE_RADIUS_FRACTION * longSide, 0.15 * shortSide)`. Since
`deriveLensSizeForSource`'s own `targetRadius` is long-side-driven for any
aspect ratio up to 2.5:1, a long-side-based default makes the creation zoom
for a given preset **constant across aspect ratios** (~1.8×/2.5×/3.3× for
S/M/L) instead of swinging with the image's aspect ratio the way a
short-side-based default did (3.3×-5.4× for the same "M" across a 4:3 photo
vs. a phone screenshot). The `0.15 * shortSide` term guards extreme
panoramas beyond that 2.5:1 point; past it, `deriveLensSizeForSource`'s own
cap and two-pass re-derivation take over unchanged.

**Deleted, not kept: the old tap-vs-drag threshold.** The revised gesture
has no tap-vs-drag branch at all, so the pre-addendum `isMagnifierTapTravel`,
`buildTapMagnifier` and `MAGNIFIER_TAP_SLOP_PX` have no consumers left and
were deleted outright — the project's TASK-38 rule that a superseded
approach is deleted, not left as a dead "fallback," applies here too.
`MAGNIFIER_TAP_SOURCE_RADIUS_FRACTION` survives, renamed to
`MAGNIFIER_SOURCE_RADIUS_FRACTION`, as the sole creation-time source-radius
coefficient (see `defaultSourceRadius` above).

**Constants and their homes.** Most magnifier constants live in
`magnifier.ts` (`MIN`/`MAX_MAGNIFIER_ZOOM`, `MIN_MAGNIFIER_SOURCE_RADIUS_PX`,
`MAGNIFIER_SOURCE_RADIUS_FRACTION`, `MAGNIFIER_GAP_PX`,
`MAGNIFIER_CONNECTOR_MIN_GAP_PX`, the Addendum B operability-limit constants
below, and Addendum C's `MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO`);
`MAGNIFIER_LENS_FRACTION_PRESETS` (S/M/L target lens diameter as a fraction
of the canvas's long side) lives in `model.ts`, next to the other size
presets. **Deleted (Addendum B, 2026-08-02):** `MIN_MAGNIFIER_RADIUS` (12
bitmap px) and `MAX_MAGNIFIER_RADIUS` (4096 bitmap px) — the original design
note's deviation note about their living in `magnifier.ts` rather than
`resize.ts` (import-boundary reasons) is now moot, since both constants are
gone outright, replaced by the canvas/scale-relative `magnifierSizeLimits`
below. `MAGNIFIER_SOURCE_STROKE_RATIO` is renamed
`MAGNIFIER_MARKER_STROKE_RATIO`; as of Addendum C (2026-08-02a) it governs the
source ring and the connector's **narrow** (source) end only — the
connector's wide (lens) end instead tracks `MAGNIFIER_CONNECTOR_FAN_RATIO ×
a.radius` (see the connector paragraph above). Still exported from
`render.ts` — the module that actually draws the ring — and imported by
`hittest.ts`, so the ring's hit-test band always matches the weight it's
actually drawn at (the connector itself stays deliberately not hit-testable):
one owner, two consumers, no drift between what's drawn and what's clickable.
**Frame weight (magnifier UX brush-up, 2026-08-06):** the lens border read as
a hairline on a large capture at the pre-brush-up ratio (`strokeWidth`
verbatim), and the S/M/L stroke picker is the user's only weight lever, so
`render.ts` gained `MAGNIFIER_LENS_STROKE_RATIO = 1.5` as the lens border's
own weight (`lensStroke = max(1, strokeWidth * 1.5)`, computed once in
`drawMagnifier` and shared by both border passes AND the connector's wide-end
floor), and `MAGNIFIER_MARKER_STROKE_RATIO` moved `0.6 -> 0.9` — still
exactly `0.6 ×` the lens border at every stroke width, preserving the ratio
the connector's flushness arithmetic depends on (S/M/L lens border / source
ring, bitmap px, `docScale` 1: `4.5/2.7`, `9/5.4`, `18/10.8` — was `3/1.8`,
`6/3.6`, `12/7.2`). This is a deliberate, stated pixel change to every
existing magnifier's exported output (thicker frames) — not a violation of
TASK-48 AC#6 ("stored data never mutated"), whose subject is geometry/stored
data, not pixel-identical rendering across releases; the reading is recorded
in TASK-48's notes. `MAGNIFIER_CONNECTOR_FAN_RATIO` (`0.6`, `render.ts`) and
`MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO` (`1.0`, `magnifier.ts`) are
deliberately two different constants in two different files even though both
bound the same `w2` value: the first is the EDITORIAL aperture the connector
aims for, the second is the GEOMETRIC domain bound `connectorShape`'s own
`asin` math requires — neither is derivable from the other, so neither owns
the other.

`clampLensCenter` (magnifier.ts, Addendum A) is the one owner of "keep the
lens fully on canvas": `placeLens`'s clamp-fallback (no candidate direction
fit) and `magnifierSlideUpdate`'s per-frame clamp both call it instead of
re-deriving the same `[R, W-R] x [R, H-R]` clamp independently.

**Operability limits (Addendum B, 2026-08-02; floor raised by the magnifier UX
brush-up, 2026-08-06).** Real-iPhone feedback: a source ring shrunk near its
old 2-bitmap-px sampling floor becomes smaller than its own controls, so the
loupe becomes practically uneditable — worse on a large photo shown small on
a phone, where even a modest bitmap-px floor is a sub-3-CSS-px target. The fix
follows the principle this codebase already uses for every other operability
threshold (`BASE_TOL_PX`, `HANDLE_HIT_PX`, `MAGNIFIER_READOUT_*`): **minima
are CSS px, scale-compensated at the call site with `canvas.ts`'s
`cropScale()` (finger-relative); maxima stay canvas-relative
(image-relative)** — a thing is "too small" relative to a fingertip, "too
big" relative to the picture it sits on. `MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX`
moved `16 -> 20` in the brush-up: the old rationale (two point handles
`src-move`/`src-zoom` needing clear space between them) died with
`src-move`; the new one is that the `src-zoom` grip's 24 CSS px touch hit
radius eats into the source disc — now the drag surface — from the rim, so
`minSource = 20` keeps a `2*20 - 24 = 16` CSS px always-draggable lune (vs 8
at the old floor). Cost: TASK-46 AC#12's aspect-independence threshold moves
from `>= 267` to `>= 333` CSS px long side (`20 / 0.06`).
`magnifierSizeLimits(canvasSize, scale)` (magnifier.ts) is the one
owner of the resulting bounds (`minSource`, `minRectSource`, `minLens`,
`maxLens`); `defaultSourceRadius`, `deriveLensSizeForSource`, `clampZoom`
(magnifier.ts) and every resize enforcement site (`resize.ts`'s
`applyResize`, now taking a required `limits: MagnifierSizeLimits` 6th
parameter — read only by the magnifier branch) consult it instead of the old
fixed constants. `MIN_MAGNIFIER_SOURCE_RADIUS_PX` (2 bitmap px) survives as
an absolute backstop beneath the CSS-scaled floor, guaranteeing
`minSource > 0` even for a degenerate/zero-sized canvas (`clampZoom` divides
by it) — `minRectSource` shares the same backstop.

**`minSource` is circle-only from Addendum G onward (2026-08-08, live iPhone
testing).** The rect ("cube mode") variant switched its three floor readers
(`clampRectZoom`, `applyMagnifierBoxResize`'s `minPx`,
`deriveRectLensSize`'s `sourceHalfH` floor) to a separate, much smaller
field, `minRectSource` (`MIN_MAGNIFIER_RECT_SOURCE_CSS_PX = 4` CSS px vs
`minSource`'s fingertip-sized 20) — a LEGIBILITY floor on the drawn source,
not an operability one. Operability moved entirely to the hit TARGET
instead: `hittest.ts`'s rect branch independently floors the source's hit
half-extents at `canvas.ts`'s `MAGNIFIER_SOURCE_MIN_HIT_HALF_PX` (11 CSS px,
touch-multiplied), regardless of how small the drawn source has shrunk. See
`docs/design/2026-08-08-magnifier-cube-mode.md`'s "Addendum G" for the full
rationale (a fingertip-floored drawn source on a phone screenshot at typical
PWA `cropScale` pinned the smallest source to several lines of text and
capped zoom under 2x, defeating a "magnify one line of text" tool).

One UI-facing consequence worth stating plainly: **at a high zoom the lens
cannot be shrunk past `zoom * minSource` — lower the zoom before shrinking
the lens.** A tiny lens at high zoom is exactly the ungrabbable-source
complaint from the other end, so the corner-resize floor rises with zoom
instead of letting the derived source collapse under it.

**Clamps are creation/edit-time behaviour only; nothing mutates stored
data.** Loading, opening, or simply rendering a document never runs these
clamps — an old loupe with a source ring below the current minima renders
and exports exactly as saved, and only snaps into range the next time a
corner or the `src-zoom` handle is actually dragged, same as every other
tool's clamp. This matters more here than elsewhere because the minima are
*display-scale dependent*: the identical annotation is "in range" in a wide
desktop window and "below range" once the same document is opened small on a
phone — intentional (the floors track the current finger-to-pixel ratio),
never destructive, and documented in `magnifier.ts`'s module doc comment so
it doesn't read as a bug later.

**Rect variant ("cube mode", `docs/design/2026-08-08-magnifier-cube-mode.md`).**
A second lens shape — a resizable rectangle, better suited to a text line than
a disc — lives inside the same `"magnifier"` kind as the union described above.
Second tap on the toolbar's magnifier button (while it is already the active
tool) toggles between the two shapes and swaps the button's icon — see
"Toolbar" below.

- *Geometry.* Same center+size convention as the circle (`at`/`from` are
  centers, not corners, unlike `RectAnnotation`'s `a`/`b`): the source region
  is derived as `(width/zoom) x (height/zoom)`, centered on `from` — the rect
  analog of the circle's `radius/zoom`.
- *Connector (Addendum H, 2026-08-08, live iPhone feedback — replaces
  Addendum G's convex-hull-bridge selection below wholesale: those bridges
  connected the pair's SILHOUETTE, e.g. both segments running top-corner to
  top-corner for a wide lens sitting below a narrow source, not the FACING
  edges a zoom callout is expected to bridge).*
  `magnifierRectConnectorLines(sourceRect, lensRect, w1)` returns two
  straight corner-to-corner segments joining the two rects' FACING edges —
  the facing pair is chosen on whichever axis the suppression guard's own
  per-axis gap is larger (which is therefore always strictly separated),
  matched same-side (top↔top / left↔left), so the segments live in the slab
  between the two facing edge lines and meet each rect only at their
  endpoint corners; stroked lines only, `markerStroke`, two-pass, no fill.
  Suppression guard: the same PER-AXIS AABB rim gap test as Addendum G
  (`gx`/`gy`, source half-extents inflated by `w1/2`), `null` below
  `MAGNIFIER_CONNECTOR_MIN_GAP_PX` — BYTE-IDENTICAL, carried forward
  unchanged by Addendum H, since it also guarantees the dominant axis is
  always strictly separated (the precondition the facing-edge slab argument
  needs). The convex-hull bridge construction (`connectorBridge`, its 4x4
  scan and shortest-pair tie-break) is deleted, not kept as a fallback — see
  `docs/design/2026-08-08-magnifier-cube-mode.md`'s Addendum H for the full
  ruling and proofs. The `e±`/`L±` tangent-from-flank-endpoint construction
  (Addendum E §E1-§E3) and the near-corner insertion rule (§E2) remain
  deleted from Addendum G, not revived.
- *Creation.* `deriveRectLensSize(size, canvasSize, limits)` (Addendum D
  §D11, 2026-08-08, reviewer nit N3; floor switched by Addendum G, see
  above): the circle's own `defaultSourceRadius` is the source's UNWIDENED
  half width (`baseHalfW`, still floored at the CIRCLE's `limits.minSource`
  — that step is unaffected by Addendum G); the aspect-derived half height
  floors at `limits.minRectSource` (the rect's own legibility floor); when
  that floor LIFTS the half height, the half WIDTH is WIDENED back out to
  restore
  `MAGNIFIER_RECT_ASPECT` (capped at `MAGNIFIER_SOURCE_SHORT_SIDE_CAP *
  shortSide`, the same panorama guard `defaultSourceRadius` itself uses) —
  instead of the pre-D11 behavior of silently squaring the lens up when the
  floor bit. The preset's ZOOM comes from the UNWIDENED source
  (`deriveLensSizeForSource(baseHalfW, ...)`), so cube mode never magnifies
  less than the circle path at the same S/M/L preset; the lens half-extents
  at that zoom then carry the same widening factor, so lens aspect exactly
  equals source aspect. Caps (`limits.maxLens` on width,
  `MAGNIFIER_MAX_LENS_FRACTION * canvasSize.h` on height) shrink BOTH axes
  by ONE shared factor if either binds, so a cap cannot skew the aspect;
  floors apply LAST, per axis (rare, and when one bites the aspect is lost —
  documented, not prevented). `zoom` is re-clamped once via `clampRectZoom`
  against the final width/height pair.
  `placeRectLens`/`clampRectLensCenter`/`magnifierRectSlideUpdate` mirror
  `placeLens`/`clampLensCenter`/`magnifierSlideUpdate` with per-axis
  half-extents in place of a scalar radius; the slide-to-aim gesture itself
  (`canvas.ts`'s `onDown`/`onMove`) is otherwise unchanged, just dispatched on
  `editor.magnifierShape` at the top via a new `magnifierPlace` union and a
  `magnifierRectGeometry(from, strokeWidth)` helper mirroring
  `magnifierGeometry`. The auto-placement GAP passed to `placeRectLens` is
  `MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth) / 2` (Addendum F,
  2026-08-08), not the bare constant — inflated by the same term Addendum E
  §E4's suppression guard subtracts from the source half-extents, so a
  freshly created rect magnifier's connector always clears its own guard
  even at the large `strokeWidth` values the web target's adaptive
  `docScale` can produce; the circle's `magnifierGeometry` is untouched,
  since its guard (`trimmedConnectorAxis`) has no such band-width term.
- *Resize (Addendum I, 2026-08-09 — supersedes D5's lens-authoritative
  gesture below).* The 8 box handles resize the SOURCE rect instead of the
  lens, `zoom` stays FIXED for the whole drag, and the lens follows exactly
  as `source * zoom`. `resizeHandlesFor` draws the 8 handles
  (`boxHandles`, the same helper rect/image use) on `magnifierSourceRect(a)`
  inflated by a screen-constant `srcHandleOutset` (an OUTSET RING, not the
  bare source rect — at the §G1 floor the source is 8 CSS px across, and
  eight bare `HANDLE_DRAW_PX` squares would cover it completely). The
  `src-zoom` grip relocates to the LENS's own SE corner, still listed FIRST
  in `resizeHandlesFor` so it wins exact ties in `nearestHandle`. A
  box-handle drag pins the diagonally opposite SOURCE corner (`from` moves,
  like rect/image); `at` (the lens center) is FIXED — the lens grows/shrinks
  about its own centre. New global invariant: **`at` changes only under a
  lens-body drag; `from` changes only under a source-body drag or a source
  box-handle drag; `zoom` changes only under the grip.** For a genuine drag,
  the pointer is deflated by `srcHandleOutset` along the handle's own
  direction before `resizeBox` runs, inverting the ring's inflation.
  Grabbing a handle without moving is an exact no-op, but NOT because that
  deflate-then-`resizeBox` round-trip is trusted to reconstruct the pre-drag
  box bit-exactly (reviewer round 3, 2026-08-09: it isn't, on
  production-shaped geometry — `resizeBox`'s edge-difference reconstruction
  alone drifts in the large majority of sampled non-dyadic fixtures) — instead
  `applyMagnifierBoxResize` recomputes the dragged handle's own ring position
  with the exact same call `resizeHandlesFor` used to draw it and
  short-circuits to the original annotation on an exact pointer match, the
  same mechanism the `src-zoom` grip branch uses for its own no-op guarantee.

  Clamping (Addendum D §D9/§D10, 2026-08-08, reviewer nits N1/N2 — a
  TASK-48 AC#6 regression fix — rulings unchanged, re-expressed in SOURCE
  units by Addendum I): `minSrcPx = 2 * max(limits.minLens / zoom,
  limits.minRectSource)` and `maxSrc{W,H} = 2 * MAGNIFIER_MAX_LENS_FRACTION
  * canvasSize.{w,h} / zoom` apply to BOTH source axes on every box-handle
  drag, not just the axis the dragged handle actually touched — the axis a
  handle never touched is RE-CENTERED on its own pre-drag SOURCE center
  (`a.from`'s coordinate on that axis), not left at its old, possibly
  out-of-range, extent. The floor is two-sided, `lo = min(minSrcPx, max)` —
  the same "hi wins" clamp discipline `magnifierSizeLimits` documents for
  its own bounds. A Shift-locked corner drag scales BOTH source axes by ONE
  shared factor when a cap trips, so the aspect ratio `resizeBox` already
  enforced survives the clamp intact — except in the documented floor-vs-cap
  conflict regime, where the per-axis floor wins over the aspect.
  `minRectSource` is now enforced ONLY by this gesture — the grip holds the
  source fixed and cannot enforce it.

  The grip's mapping is INVERTED from D5: `zoom =
  clampRectZoomForSource(dist(pointer, at) / srcHalfDiag, src.w, src.h,
  canvasSize, limits)`, `srcHalfDiag = hypot(src.w, src.h)/2` (the SOURCE's
  own half-diagonal, not the lens's); `from`/the source never change on this
  gesture — only `zoom`, `width`, `height`. `clampRectZoomForSource`
  (magnifier.ts, NEW) is the grip's runtime clamp — the source is the fixed,
  known quantity here, so the pre-existing `clampRectZoom` (whose signature
  takes LENS dims) stays creation-only (`deriveRectLensSize` step 8).

  `applyResize`/`resizeHandlesFor` (`resize.ts`) each gained a required
  `srcHandleOutset` parameter (bitmap px) for this gesture; every other
  kind, including the circle magnifier, ignores it, the same "one
  parameter, one kind reads it" precedent Addendum B already set for
  `limits`. New pure predicate `magnifierSourceBodyWins(a, p, nearest)`
  (§I6): with 8 handles now ringing a source whose short half-extent can be
  a few CSS px, the handles' touch hit discs can swallow the source's own
  fingertip-floored hit region — `canvas.ts`'s `rotateOrResizeTarget`
  consults this right after computing the nearest handle and falls through
  to the ordinary source-body drag when a press is at least as near `from`
  as to that handle. Circle-only-false: the circle's grip sits well clear of
  its own source center, so this never changes circle behavior.
- *Toggle UI.* `Editor.magnifierShape: "circle" | "rect"` (session-scoped,
  default `"circle"`) with `getMagnifierShape()`/`toggleMagnifierShape()`; a
  second tap on the magnifier toolbar button while it is already the active
  tool toggles the shape and swaps the button's icon — the same
  second-tap-on-an-already-active-tool convention the badge tool established
  for its fixed-number bar (see "Toolbar" below). `index.html`/`pwa/index.html`
  tag the existing circle glyph `data-magnifier-icon="circle"` and add a
  hidden sibling `data-magnifier-icon="rect"`; the swap toggles the `hidden`
  attribute via `toggleAttribute` (not the `HTMLElement.hidden` IDL property,
  which `SVGElement` doesn't expose, even though the attribute works
  identically at the DOM level).
- *Selection overlay.* Source tint clips to the source RECT (instead of the
  source disc) before the same clip-then-`evenodd`-punch fill the circle
  uses; the zoom readout anchors at the source rect's NE corner. `drawZoomGrip`
  gained an optional outward-angle parameter (default `π/4`, unchanged for the
  circle); as of Addendum I (2026-08-09) the grip itself sits on the LENS's
  own SE corner (not the source's), so the rect passes the LENS rect's own
  actual SE angle, `atan2(a.height/2, a.width/2)`, instead of the source's.
  The delete-button avoidance radius stays the source rect's half-diagonal
  (circumscribed, conservative), unaffected by the handle ring's outset —
  `positionSelectionControls` already carries more clearance margin than the
  ring's worst-case reach beyond that half-diagonal; the existing
  circle-vs-rect nearest-point machinery in `deleteButtonCornerFor` is
  otherwise unchanged.
- *Deviation from a strict mirror:* `deriveRectLensSize` returns
  `{sourceHalfW, sourceHalfH, width, height, zoom}`, not just `{width, height,
  zoom}` mirroring the circle's `{radius, zoom}` — the returned
  `sourceHalfW`/`sourceHalfH` are the FINAL, post-clamp source half-extents
  (`lensHalfW / zoom`, `lensHalfH / zoom` — the annotation's TRUE derived
  source per D2's `source = lens / zoom` rule, not a pre-clamp intermediate
  that Addendum D §D9-§D11's own widening/capping/flooring steps can move
  away from), because the rect path derives its OWN source half-height
  internally (unlike the circle, where `canvas.ts`'s `magnifierGeometry`
  computes `defaultSourceRadius` itself and feeds it to BOTH
  `deriveLensSizeForSource` and `placeLens`), and `canvas.ts`'s
  `magnifierRectGeometry` needs those half-extents a second time, for
  `placeRectLens`'s own gap computation.

Every circle code path stays byte-identical: `connectorShape`,
`magnifierSlideUpdate`, `placeLens`, `clampLensCenter`,
`applyMagnifierCornerResize`, `deriveLensSizeForSource`, `magnifierSizeLimits`,
`defaultSourceRadius`. No persisted-format migration — the union is plain
data, `structuredClone`-safe, same as every other annotation.

**Performance.** One extra `drawImage` per loupe per frame, on top of the
full-background redraw `render()` already performs every frame — the same
cost class as any other live-preview draft; no offscreen caching is done.

## IPC contract

| Direction | Name | Payload | Purpose |
| --- | --- | --- | --- |
| TS → Rust (command) | `capture_fullscreen` | none → returns base64 PNG string | Hide window, capture primary monitor, show window, return the shot |
| TS → Rust (command) | `prepare_drag_file` | `png: number[]` → returns temp file path | Materialize export for OS drag |
| TS → Rust (command) | `save_png` | `{ png: number[], defaultName: string }` → `string \| null` | Show native save dialog, write PNG; returns saved path, or `null` if the user cancelled |
| TS → Rust (command) | `pick_image` | none → returns raw image bytes, or rejects `"CANCELLED"` | Native open-file dialog filtered to image extensions, for the insert-image toolbar button |
| TS → Rust (command) | `read_image_file` | `{ path: string }` → returns raw image bytes | Read an image file already resolved to a path (drag-and-drop), rejecting non-image extensions |

Keep this table current — the `reviewer` agent checks IPC contract drift.

The selection tool (hit-test/move/delete/resize/rotate) is a pure `src/`
feature and introduces no IPC changes; the table above is unaffected —
including its TASK-29 resize-handle and TASK-41 rotate-handle additions, both
pure geometry (`resize.ts`/`rotate.ts`/`bounds.ts`) plus `canvas.ts`
pointer-event wiring, no Rust or IPC surface touched. The inline text editor
(below) is likewise pure `src/`, including its TASK-23 double-click re-edit
and TASK-41 rotated-re-edit additions; `save_png` is the only IPC addition on
top of the original two commands. The crop tool (below) is also pure `src/`
and introduces no IPC changes — including its v2 handle-based/mouse-only-apply
revision, which is pure `src/` UI/interaction rework with no Rust or IPC
surface touched. Inserting images as annotations (above) adds the two
commands in the table above, plus the `clipboard-manager:allow-read-image`
capability for the Ctrl+Shift+V clipboard-image path. The magnifier/loupe
annotation (TASK-46, below) is likewise pure `src/`: no Rust, no new Tauri
command, no new capability — it only threads a required 4th parameter
(`background`) through `renderAnnotations`, extends `translateAnnotation`
with an optional `part` argument, and adds two new resize-handle ids.

**Import boundary (TASK-41 addition, extended by TASK-46):** `exporter.ts`'s
transitive import graph is, and must remain, exactly `exporter → render →
{bounds, rotate, magnifier} → model` — `bounds.ts`, `rotate.ts` and
`magnifier.ts` are pure geometry/math leaves with no selection-chrome
knowledge, so they are safe additions to that graph. `exporter.ts` must never
reach `hittest.ts`, `resize.ts`, or `crop.ts`, directly or transitively —
that boundary is the mechanical guarantee that selection/crop/resize/rotate
*chrome* (marquees, handles, knobs, dimming) can never be rasterized into an
exported or copied image. `magnifier.ts` itself must never import
`hittest.ts`/`resize.ts`/`crop.ts` either, even though it sits below
`render.ts` — `resize.ts` and `hittest.ts` instead import FROM `magnifier.ts`
(its derived-geometry functions and the `MagnifierSizeLimits` type/
`magnifierSizeLimits` function), never the other way around.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+C` / `Cmd+C` | Copy exported PNG to clipboard |
| `Ctrl+Shift+V` / `Cmd+Shift+V` | Insert clipboard image as an annotation (plain `Ctrl+V` still replaces the background) |
| `Del` / `Backspace` | Delete the selected annotation (undoable) |
| `Esc` | Reset the crop region to the full image while cropping, else deselect |
| `Enter` | Apply the crop region (no-op on an unshrunk full-image region) |
| `Ctrl+S` / `Cmd+S` | Save annotated PNG via native dialog |
| `Ctrl+N` / `Cmd+N` | New: discard the document back to the welcome/empty state (undoable; no-op while already empty). Browsers may reserve this and swallow it — the `#new-doc` toolbar button is the primary affordance |

`Esc`/`Enter` are strictly optional **accelerators** for the crop tool's
on-canvas ✗/✓ controls — the mouse alone is always sufficient to reset or
apply a crop. Neither ever exits crop mode: `Esc`/✗ resets the region to the
full image and `Enter`/✓ (after a real apply) re-arms the region to the
newly-cropped image's full extent, so a region with handles is always
visible while the crop tool is active (see "Crop" above).

`Del`/`Backspace`/`Esc`/`Enter`/`Ctrl+S` are gated by an `isTypingTarget` guard
in `main.ts` so a global handler never eats keys destined for a text field.
While the inline text editor (below) is focused, this guard suppresses **all**
global shortcuts: `Ctrl+Z`/`Ctrl+C`/`Delete`/`Backspace` fall through to the
input's native undo/copy/edit behavior, and `Ctrl+S` is inert; `Esc`/`Enter`
are instead handled by the editor's own `keydown` listener, which
cancels/commits the edit. `Esc` checks `editor.cancelCrop()` first — which,
in crop mode, always returns `true` (a reset, never a no-op) — and only
falls through to `clearSelection()` when the crop tool isn't active.

## Capture flow

OpenSoegaki's primary input path is pasting a screenshot taken with the OS tool; a
toolbar button covers full-screen capture as a secondary path.

1. **Paste (primary).** The user shoots with the OS screenshot tool (Win+Shift+S;
   Cmd+Shift+4 on macOS) and presses Ctrl+V / Cmd+V in OpenSoegaki. The webview fires
   a DOM `paste` event; `main.ts` reads the first `image/*` item off
   `ClipboardEvent.clipboardData`, hands the `Blob` to `editor.loadImageBlob`, which
   decodes it with `createImageBitmap` and resets the document. No Rust involvement
   and no clipboard-read permission are needed — the WebView delivers the image
   directly. The same DOM event fires under WKWebView, so this path is macOS-safe
   with no platform branch.
2. **Capture button (secondary).** Clicking the toolbar's Capture button invokes the
   `capture_fullscreen` command, which hides the main window, waits briefly for the
   compositor to repaint without it, captures the primary monitor via `xcap`, shows
   the window again, and returns a base64 PNG — restoring the window even if capture
   fails. The frontend decodes the result and loads it the same way as a pasted image.

**Known gap (MVP):** the Capture button always captures the full screen;
capture-time region selection stays delegated to the OS (Win+Shift+S, then
paste). The editor's own **crop tool** (below) trims the loaded document
after the fact instead.

## Toolbar

**New** (`#new-doc`, leftmost of all — before Capture — `Ctrl+N`/`Cmd+N`,
TASK-36) discards the current document back to the welcome/empty state via
`Editor.clearDocument()`: undoable (the discarded `{ imageBitmap,
annotations }` is pushed to history first, the same mechanism as background
replacement), and a no-op — on both the button and the shortcut — while the
editor is already empty. `bootstrapEditor`'s `syncEmptyState()` keeps the
button's `disabled` state and the stage's empty/loaded CSS class in sync
after every load, undo, redo, and clear; the toolbar itself is never hidden
on the welcome screen, so an accidental clear is always one Undo away on
both platforms (there is no confirmation dialog — undo is the safety net).

The toolbar's first *tool* button is **Select** (`V`), an opt-in tool alongside the three
draw tools (arrow/rect/text, default). Selecting an annotation shows a dashed
marquee and allows drag-to-move or `Del`/`Backspace` to remove it (see
"Selection & hit-testing" above); switching tools, `Esc`, or clicking empty canvas
clears the selection. New annotations are not auto-selected after drawing —
**except the magnifier** (Addendum A, 2026-08-01a): a loupe is a compound
object whose two halves (lens and source) almost always need immediate
adjustment, so on commit it is auto-selected and the active tool switches to
Select (see "Magnifier (loupe)" below for the full rationale).

**Second tap on an already-active tool** is a house convention for a tool
with more than one facet, rather than a separate toolbar control per facet:
the **Badge** tool's second tap (while already the active tool) opens/closes
a bottom bar for pinning a fixed badge number instead of the
auto-incrementing sequence (`badgebar.ts`); the **Magnifier** tool's second
tap toggles its lens shape between circle and a resizable rectangle ("cube
mode", `Editor.toggleMagnifierShape()`, 2026-08-08) and swaps the toolbar
icon accordingly (`data-magnifier-icon` in `index.html`/`pwa/index.html` —
see "Magnifier (loupe)" above). Both are one `if (tool-already-active) {
toggle-this-tool's-own-facet(); return; }` branch in `app.ts`'s shared
toolbar click handler, checked before the generic `editor.setTool(...)`
fallthrough that every other tool button uses.

The **Text** tool opens an in-canvas `<input>` overlay at the click point instead
of the former blocking `window.prompt`. The overlay is DOM-only — appended to
`#stage`, never passed through `renderAnnotations` — so it renders and positions
like the committed text but can never be rasterized into an export. It is
single-line (Enter commits, Esc cancels, blur commits); a non-blank commit
produces exactly one undoable `TextAnnotation`.

**Double-click to re-edit (TASK-23):** with the **Select** tool active,
double-clicking (`e.detail >= 2`) an existing text annotation reopens the same
overlay pre-filled with its current text/color/fontSize, via
`openTextEditor(at, { editId, value, color, fontSize })`. Detection happens in
`onDown`, *before* `setPointerCapture` — a captured pointer would otherwise
arm a select/move drag underneath the reopened editor. `render()` skips
drawing the `editId` annotation while its editor is open, so it is never
double-drawn underneath the input. `commitTextEditor` branches on
`textEdit.editId`: a blank commit **deletes** the annotation (push + filter,
mirroring `deleteSelected()`); an unchanged value is a no-op (no history
push); a changed value pushes once and replaces the annotation in place
(`{ ...existing, text }`, keeping `id`/`color`/`fontSize`/`at`/`strokeWidth`)
— a single undo step. Escape still cancels with no history push, and the
`editId === null` new-text path (TASK-7, above) is unchanged.

An **S/M/L size control** next to the palette picks the stroke width (arrow/rect)
and font size (text) used for *new* annotations; it never restyles existing ones.

The **Crop** tool initializes the region to the full loaded image with
draggable corner handles; the user shrinks it by dragging a corner (opposite
corner pinned, clamped to image bounds and `MIN_CROP_PX`). A floating
on-canvas **✓ Apply / ✗ Reset** control group, positioned near the region's
bottom-right corner over the canvas (offset clear of the SE handle), applies
or resets the crop with the mouse alone (see "Crop" above for what applying
does to the document, and for the always-visible-region invariant); `Enter`/
`Esc` remain as optional accelerators for the same actions, and neither ever
leaves crop mode — resetting or re-arming the region, never tearing down the
handles/controls. While the crop tool is active, live chrome dims the four
exterior regions, draws a dashed white+accent border around the region, and
draws a small filled square handle at each corner — all drawn directly on
the canvas context in `Editor.render()`, after selection chrome, so none of
it is ever rasterized into an export. The toolbar's crop button uses an
inline SVG crop-mark icon (`stroke="currentColor"`) rather than a text
glyph, for legibility on both the panel background and the button's active
accent state; it and the **Insert image** button (`#insert-image`, next to
Capture — see "Inserting images as annotations" above) are the toolbar
buttons using SVG today — the rest remain Unicode glyphs.

## Share flow (drag-out)

1. User drags the tab in the share bar.
2. TS rasterizes the document (`exporter.ts`) and invokes `prepare_drag_file`.
3. Rust writes `%TEMP%/opensoegaki/soegaki-<ts>.png` and returns the path.
4. `tauri-plugin-drag` starts a native OS drag with that file.
5. Temp files are removed on app exit.

## Save flow

Ctrl+S / Cmd+S or the toolbar **Save** button exports the document
(`exporter.ts`) and invokes `save_png`. Rust shows an `rfd::AsyncFileDialog`
(main-thread-safe on macOS, threaded on Windows) and writes the chosen path.
Cancel returns `null` — a no-op; a write error is surfaced via `console.error`,
matching the existing copy/drag sinks. `save_png` is a single custom command
over `rfd` rather than `tauri-plugin-dialog`, a deliberate choice to keep the
dependency and permission surface minimal: no new capability entry is needed.

## Privacy stance

Screenshots are sensitive. OpenSoegaki performs **no network I/O** and must stay that
way unless a feature is explicit, opt-in, and reviewed. `save_png` writes only to
a user-chosen local path via the native dialog; it never transmits data.

## Release pipeline

Releases are tag-triggered: pushing a `vX.Y.Z` tag runs
`.github/workflows/release.yml`, a matrix build over `windows-latest` and
`macos-latest` (macOS targets `aarch64-apple-darwin` only) using
`tauri-apps/tauri-action`, which builds and attaches bundles to a GitHub
Release. The bundle `targets` config is `"all"`, letting Tauri resolve the
right per-OS formats (NSIS/MSI on Windows, `.app`/`.dmg` on macOS). The
bundle version is single-sourced to `src-tauri/Cargo.toml`
(`tauri.conf.json` has no `version` field and falls back to it); a
`verify-version` job guards the release by failing it if the tag,
`Cargo.toml`, and `package.json` versions don't all match. Bundles are
**unsigned** — code signing and macOS notarization are out of scope for now
(see the README's Download & install section for the SmartScreen/Gatekeeper
workarounds this implies).

## Web target (iPhone PWA)

A second, web-only build ships from this same repository, reusing `src/editor/`
entirely unchanged. All platform coupling is inverted behind one seam,
`PlatformIO` (`src/platform/io.ts`): `src/platform/tauri.ts` implements it for
desktop (every `@tauri-apps/*`/`@crabnebula/*` call, moved out of `main.ts`
behavior-identical), `src/platform/web.ts` implements it for the browser
(file-input picker, Web Share/download, best-effort clipboard write, all
gated by feature-detected `Capabilities`). `src/app.ts`'s
`bootstrapEditor(io: PlatformIO)` is the single shared wiring path both
`src/main.ts` (desktop) and `src/main-web.ts` (web) call into — there is no
duplicate toolbar-wiring code between the two entries; capability-specific
controls carry `data-cap="<name>"` in the shared HTML and are hidden by
`bootstrapEditor` when the active platform's capability is false.

The web shell lives in `pwa/` (its own `index.html`, hand-rolled
`manifest.webmanifest` + service worker, icons under `pwa/public/`) and
builds via a separate `vite.config.web.ts` to `dist-web/` — `vite.config.ts`
and the Tauri build are untouched. `.github/workflows/pages.yml` deploys
`dist-web` to GitHub Pages on release tags (`v*`), so the web app and the
desktop app release together from one tag.

Full design rationale, the `PlatformIO` contract (including the `copyPng`
lazy-producer requirement for Safari's clipboard user-gesture window), the
risk register, and an iOS manual smoke-test checklist all live in
[docs/WEB.md](WEB.md).

## Platform roadmap

1. **Windows 11** (current) — NSIS/MSI bundles.
2. **macOS** — xcap and tauri-plugin-drag both support it. Screen Recording
   permission UX is implemented: `src-tauri/src/permission.rs` calls
   `CGPreflightScreenCaptureAccess` before capture and, if not granted, calls
   `CGRequestScreenCaptureAccess` once (seeds the TCC prompt) via
   `ensure_screen_capture_access()`. `capture_fullscreen` returns the sentinel
   error string `SCREEN_RECORDING_PERMISSION` when access isn't granted; the
   frontend catches it and shows a modal explaining that macOS only applies a
   newly granted permission after an app restart, with an "Open Settings"
   button wired to the `open_screen_recording_settings` command (opens the
   Privacy & Security → Screen Recording pane). The paste path needs no
   platform-specific work: WKWebView fires the same DOM `paste` event as
   WebView2 for Cmd+V. The app registers no global hotkeys — all shortcuts are
   in-app key listeners keyed off `metaKey` on macOS (`ctrlKey` on
   Windows/Linux) — so there is no collision with the system's own
   Cmd+Shift+5 screenshot shortcut.
