# Design note — In-editor crop tool (TASK-4)

Author: architect agent, 2026-07-15. Status: proposed, ready for review.

## Problem

Users need to trim an annotated screenshot down to a region of interest *after* capture — the OS already owns capture-time region selection (Win+Shift+S, then paste). The crop must shrink the document's background image and coordinate space to a user-dragged rectangle, keep every existing annotation aligned to the image content it points at, be a single `Ctrl+Z` step, and be cancellable mid-gesture with `Esc`. It must fit the existing object-model + snapshot-history architecture without touching Rust or the IPC surface.

## Decision

**A destructive, re-rasterizing crop that reuses the existing snapshot-history mechanism verbatim — the same shape as TASK-19's background replacement.** Confirmation is an explicit two-step gesture: **drag to define the rectangle, then `Enter` to apply / `Esc` to cancel**, with a dimmed exterior and a dashed border as live chrome.

### Data model — destructive re-rasterize, not a stored crop rect

On apply, the editor:
1. produces a **new cropped `ImageBitmap`** via `createImageBitmap(oldBitmap, x, y, w, h)`,
2. replaces `doc.annotations` with the same list **translated by `(-x, -y)`** using the existing pure `translateAnnotation`,
3. resizes the canvas to `w x h`,

all after a single `history.push(snapshot())`. This is exactly the TASK-19 pattern: `history` already snapshots `{ imageBitmap, annotations }` (bitmap by reference, annotations `structuredClone`d), and `restore()` already resizes the canvas to the snapshot's bitmap dimensions. So **one push → one undo restores both the old, larger bitmap and the old annotation positions and the old canvas size** (AC#4), and redo round-trips, with zero new history machinery.

This does **not** violate "annotations are an object model; rasterize only at export." The background is *already* a raster `ImageBitmap` (paste/capture set it wholesale); cropping it is a bitmap-to-bitmap operation. Annotations stay objects — they are only translated, never rasterized. `render.ts`, `exporter.ts`, and `hittest.ts` are untouched, because after apply the document is just a smaller background plus repositioned annotation objects that the existing pipeline already knows how to draw, export, and hit-test.

### Annotation handling — keep, translated (never clip, never delete)

Every annotation is kept and translated by `(-cropX, -cropY)`. Shapes that were fully or partly outside the crop end up at negative or out-of-range coordinates; the live canvas and the export `OffscreenCanvas` (both sized to `w x h`) simply clip them at the bitmap edge — no special code. Rationale:
- **AC#3 falls out for free**: a shape over an image feature and that feature translate by the identical vector, so their relative position is preserved exactly.
- **Clipping** would have to mutate annotation geometry (a rect's corners, an arrow's endpoints, a text run) — destroying object-model fidelity and complicating undo.
- **Deleting** loses data and makes the undo round-trip about deletion rather than the crop.
- Keeping whole objects is fully reversible (undo restores them) and consistent with today's behavior, where the select tool already lets you drag an annotation partly off-canvas. A subsequent wider crop or an undo brings hidden annotations back.

### Interaction — drag to define, `Enter` to apply, `Esc` to cancel

Crop is a toolbar tool mode (`tool === "crop"`, cursor `crosshair`). A pointer drag defines the rectangle. On pointer-up the rectangle **persists** as an adjustable preview (dragging again on the canvas redefines it from scratch — no edge handles in the MVP). `Enter` applies; `Esc` (or switching tools, or a new paste/capture, or undo/redo) cancels with no document change (AC#5).

Why explicit-commit rather than immediate-on-release: crop is **destructive and coarse**, and AC#2 ("drag a rectangle *and apply it*") and AC#5 ("cancels an *in-progress* crop") both presuppose a reviewable in-progress state that survives pointer-up — which immediate-on-release does not have. The app already trains users on "Enter commits / Esc cancels" via the inline text editor; reusing that muscle memory for the one other consequential, modal-ish interaction is the most consistent choice.

**Rendering chrome** (private `Editor.drawCropOverlay`, called last in `render()`, exactly like `drawSelectionOverlay` — never through `renderAnnotations`, so it can never reach `exporter.ts`): a semi-transparent black fill over the four regions **outside** the rectangle (dimmed exterior) plus a static dashed white+accent border matching the selection marquee. Animated "marching ants" are deliberately **deferred** — they would require a `requestAnimationFrame` loop running while idle, against the "keep the app light" invariant; a static dashed border reads clearly enough.

### Degenerate / min-size handling

A pure `computeCrop(a, b, imageW, imageH, minSize)` normalizes drag direction, clamps to image bounds, rounds to integer pixels, and returns `null` when either dimension is `< MIN_CROP_PX` (= 8) **or** when the rectangle equals the whole image (a no-op crop that should not create an undo step). On pointer-up a `null` result discards the pending crop (same spirit as draw tools ignoring a zero-area shape); on `Enter` a `null` result cancels without pushing history.

### No Rust / IPC changes

Confirmed: crop is pure `src/` work. `createImageBitmap`'s crop overload is supported by WebView2 (Chromium) and WKWebView, so the macOS port is not blocked. The IPC table (`capture_fullscreen`, `prepare_drag_file`, `save_png`) is untouched.

## Alternatives considered

- **Non-destructive crop rect stored on `Doc`, applied at render/export.** Rejected: it would thread a crop offset through `render.ts`, `exporter.ts` (crop the output), `hittest.ts` (offset every test), canvas sizing, *and* the history snapshot, and force a coordinate-mapping layer everywhere. That is a large, invasive change that contradicts "keep it simple and consistent with how history currently stores state." The destructive approach reuses the TASK-19 machinery with no new concepts. (A non-destructive, re-editable crop is a clean future extension if ever needed.)
- **Immediate-on-release confirmation.** Rejected: no reviewable/cancellable in-progress state (conflicts with AC#5's wording) and dangerous for a destructive op.
- **Apply button in the toolbar / double-click-inside to confirm.** Rejected: an Apply button adds modal toolbar state for one tool; double-click-inside collides with the "pointer-down starts a fresh rectangle" model (the second click would collapse the rect) and would need special-casing. `Enter`/`Esc` is one pattern, already established by the text editor.
- **Clip or delete out-of-bounds annotations.** Rejected (see "Annotation handling"): both break object-model fidelity and/or the undo round-trip; translate-and-keep satisfies AC#3 with no geometry surgery.

## IPC / API contract

**None.** No Rust command added or changed.

New/changed `src/` surface:
- `src/editor/crop.ts` (new, pure, **not** imported by `exporter.ts`):
  - `export const MIN_CROP_PX = 8;`
  - `export interface CropRect { x: number; y: number; w: number; h: number; }`
  - `export function computeCrop(a: Point, b: Point, imageW: number, imageH: number, minSize: number): CropRect | null` — normalize, clamp to `[0,imageW] x [0,imageH]`, round to integers, return `null` if `w < minSize || h < minSize` or if the rect equals the full image.
- `src/editor/model.ts`: widen `export type Tool = ToolKind | "select" | "crop";` (crop is **not** a `ToolKind` — no crop annotation exists). `translateAnnotation` is reused unchanged.
- `src/editor/canvas.ts` — new public methods `hasPendingCrop(): boolean`, `applyCrop(): Promise<void>`, `cancelCrop(): boolean`; private crop state and `drawCropOverlay()`.

## Implementation tasks

Continuing the prior notes' numbering (they ended at 21).

22. **`src/editor/crop.ts` (new).** Implement `MIN_CROP_PX`, `CropRect`, and `computeCrop(a, b, imageW, imageH, minSize)` as specified above (import `Point` from `./model`). Pure, DOM-free, no canvas usage. Do **not** import it from `exporter.ts`. *Verify:* `pnpm check` passes.

23. **`src/editor/model.ts`.** Add `"crop"` to the `Tool` union. *Verify:* `pnpm check`; `ToolKind` unchanged (annotations can never be `kind: "crop"`).

24. **`src/editor/canvas.ts` — crop state & pointer interaction.** Import `computeCrop`, `MIN_CROP_PX` from `./crop`. Add `private crop: { a: Point; b: Point; phase: "drawing" | "set" } | null = null;`.
    - `onDown`: after the `setPointerCapture` line and the `select` branch, add a `tool === "crop"` branch that sets `this.crop = { a: p, b: p, phase: "drawing" }`, `render()`, `return` (before the arrow/rect draft creation).
    - `onMove`: after the `this.move` branch, add: if `this.crop && this.crop.phase === "drawing"`, set `this.crop.b = p`, `render()`, `return`.
    - `onUp`: after the `this.move` branch, add: if `this.crop`, and it is `"drawing"`, set `phase = "set"`; if `computeCrop(a, b, bitmap.width, bitmap.height, MIN_CROP_PX)` is `null`, discard (`this.crop = null`); `render()`; `return`.
    *Verify:* dragging with the crop tool shows a rectangle that follows the pointer; a near-zero drag leaves no pending crop.

25. **`src/editor/canvas.ts` — apply / cancel / query.** Add:
    - `hasPendingCrop(): boolean` → `this.crop !== null`.
    - `cancelCrop(): boolean` → if `this.crop` is null return `false`; else `this.crop = null`, `render()`, return `true`.
    - `async applyCrop(): Promise<void>` → early-return if `!this.crop || !this.hasImage()`; `const src = this.doc.imageBitmap!`; `const rect = computeCrop(this.crop.a, this.crop.b, src.width, src.height, MIN_CROP_PX)`; if `rect` is null → `this.crop = null`, `render()`, return; `const cropped = await createImageBitmap(src, rect.x, rect.y, rect.w, rect.h)`; if `this.doc.imageBitmap !== src` return (state changed during await); `this.history.push(this.snapshot())`; set `this.doc.imageBitmap = cropped`; `this.doc.annotations = this.doc.annotations.map((a) => translateAnnotation(a, -rect.x, -rect.y))`; `this.canvas.width = rect.w`, `this.canvas.height = rect.h`; `this.crop = null`; `this.selectedId = null`; `this.move = null`; `this.render()`. Do **not** call `.close()` on the old bitmap — the history snapshot still references it.
    *Verify:* applying shrinks the canvas to the rectangle; annotations stay aligned to the image content; a single `Ctrl+Z` restores the full image, its size, and all annotation positions; `Ctrl+Shift+Z` re-applies.

26. **`src/editor/canvas.ts` — teardown & overlay.** Cancel a pending crop (`this.crop = null`) in `setBackground`, in `restore`, and in `setTool` **only when `t !== "crop"`** (re-selecting the crop tool, e.g. via keyboard button activation, must not wipe an in-progress crop). Add private `drawCropOverlay()`: when `this.crop` is set, normalize its rect (`computeCrop` is fine, or inline min/abs — but draw even a below-min live rect during `"drawing"`), fill the four exterior regions with `rgba(0,0,0,0.45)`, then stroke a dashed white (`rgba(255,255,255,0.9)`, lineWidth 3) + accent (`PALETTE[0]`, lineWidth 1.5) border with `ctx.setLineDash([6,4])`, resetting `setLineDash([])` after. Call it at the end of `render()` after `drawSelectionOverlay`. *Verify:* exterior dims, border is dashed; export/copy PNG contains **no** dim/border chrome.

27. **`index.html`.** Add a crop tool button in the tool group (after `text`): `<button data-tool="crop" class="tool" title="Crop (C)">⌏</button>` (glyph is not load-bearing; an SVG crop-mark is fine). It is a `button.tool`, so the existing `main.ts` tool loop wires `setTool` automatically. *Verify:* clicking it activates crop mode with a crosshair cursor.

28. **`src/main.ts` — keyboard & focus.** In the tool-button click loop, add `btn.blur();` after `editor.setTool(...)` so pressing `Enter` never re-activates a focused tool button. In the window `keydown` handler: change the `Escape` branch to `e.preventDefault(); if (!editor.cancelCrop()) editor.clearSelection();`; add an `Enter` branch: `else if (e.key === "Enter") { if (editor.hasPendingCrop()) { e.preventDefault(); void editor.applyCrop(); } }`. Do not wire a `C` letter shortcut (consistent with the un-wired V/A/R/T hints). *Verify:* with a pending crop, `Enter` applies and `Esc` cancels; with no pending crop, `Esc` still deselects and `Enter` is inert; the text editor is unaffected (its own listener handles Enter/Esc while focused, and the `isTypingTarget` early-return still gates everything).

29. **`src/editor/crop.test.ts` (new — Vitest, node env, no canvas).** Cases: (a) `computeCrop` normalizes regardless of drag direction (swap `a`/`b` → identical rect); (b) clamps a rectangle that spills past the image edges and clamps a negative origin to 0; (c) returns `null` when width or height `< MIN_CROP_PX`, and for a degenerate `a === b`; (d) returns `null` for a full-image rectangle; (e) returns integer-valued `x/y/w/h`. Add a remap group: for a fixed `CropRect`, assert `translateAnnotation(a, -rect.x, -rect.y)` moves an inside-crop annotation to the expected local coordinates and moves an outside-crop annotation to negative coordinates (kept, not deleted) — one case per kind (arrow/rect/text). *Verify:* `pnpm vitest run` green.

30. **`docs/ARCHITECTURE.md` updates (do with this feature).**
    - Replace the "Known gap (MVP): … click-and-drag crop overlay (`src/capture/`)" line — clarify that *capture-time* region selection stays delegated to the OS, and add that an **in-editor** crop tool trims the loaded document.
    - **Toolbar** section: mention the crop tool (drag a rectangle, `Enter` to apply, `Esc` to cancel; dimmed exterior + dashed border chrome, never rasterized).
    - New short subsection (near the object-model discussion): crop re-rasterizes the background to the region and translates all annotations by the crop origin, undoable as the single existing `{ imageBitmap, annotations }` snapshot — the same mechanism as background replacement; annotations outside the region are kept (translated, possibly off-canvas), never clipped or deleted.
    - **Keyboard shortcuts** table: note `Enter` = apply pending crop, and that `Esc` cancels a pending crop before falling through to deselect.
    - **IPC contract** table: one-line note that the crop tool introduces no IPC changes.

## Files this touches

- `src/editor/crop.ts` (new)
- `src/editor/crop.test.ts` (new)
- `src/editor/model.ts` (Tool union)
- `src/editor/canvas.ts` (state, interaction, apply/cancel, overlay)
- `index.html` (crop tool button)
- `src/main.ts` (Enter/Esc, `btn.blur()`)
- `docs/ARCHITECTURE.md` (docs)

Unchanged by design and to be verified so: `src/editor/render.ts`, `src/editor/exporter.ts`, `src/editor/hittest.ts`, `src/editor/history.ts`, and all of `src-tauri/`.
