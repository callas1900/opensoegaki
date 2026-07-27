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

- `resizeHandlesFor(a, bounds)` returns the `HandleSpec[]` for an annotation,
  positioned from the `Bounds` the caller already has via `bounds.ts`'s
  `boundsOf`. Box kinds (rect, image) get all 8 corner+edge handles; text and
  badge get the 4 corners only; arrow's 2 handles are its `from`/`to` points
  read directly off the annotation (not the normalized bounds), so each
  endpoint keeps its own identity. **Highlight returns `[]`** — bbox-scaling a
  freehand polyline would distort the stroke shape unpredictably, so it stays
  move/delete-only, same rationale as its resize exemption.
- `handleAt(handles, p, hitRadius)` is the nearest-within-radius pick, the
  same pattern as `crop.ts`'s corner `handleAt`.
- `applyResize(original, bounds, handle, pointer, shiftKey)` returns a new
  annotation for the dragged handle + pointer position — never mutates
  `original`. Per-kind transforms (no clamping to canvas bounds, consistent
  with move — only per-kind min/max and no-flip-past-anchor):
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
capability for the Ctrl+Shift+V clipboard-image path.

**Import boundary (TASK-41 addition):** `exporter.ts`'s transitive import
graph is, and must remain, exactly `exporter → render → {bounds, rotate} →
model` — `bounds.ts` and `rotate.ts` are pure geometry/math leaves with no
selection-chrome knowledge, so they are safe additions to that graph.
`exporter.ts` must never reach `hittest.ts`, `resize.ts`, or `crop.ts`,
directly or transitively — that boundary is the mechanical guarantee that
selection/crop/resize/rotate *chrome* (marquees, handles, knobs, dimming)
can never be rasterized into an exported or copied image.

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
clears the selection. New annotations are not auto-selected after drawing.

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
