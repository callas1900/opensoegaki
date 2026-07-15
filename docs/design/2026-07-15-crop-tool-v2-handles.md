# Design note — In-editor crop tool v2: handle-based region + mouse-only apply (TASK-4)

Author: architect agent, 2026-07-15. Status: proposed, ready for review. Revises `docs/design/2026-07-15-in-editor-crop-tool.md` (v1, implemented and E2E-verified). Scope is strictly the two user-requested changes; the apply mechanism, history integration, annotation-translate semantics, and no-op/min guards from v1 are unchanged.

## Problem

Crop v1 shipped with a "draw a fresh rectangle, press Enter to apply" interaction. The user verified it end-to-end and asked for two changes: (1) the crop region should **start as the whole pasted image with grabbable corner handles the user shrinks inward from each vertex**, and the crop must be **confirmable with the mouse alone** (no keyboard required); (2) the toolbar's `⌏` crop glyph is **hard to see** and should become a clear inline SVG crop-mark. Everything else about v1 — destructive re-rasterize + `translateAnnotation` + single `history.push`, dimmed-exterior + dashed-border chrome, `Esc`/tool-switch/paste/undo cancellation, the full-image no-op guard, and `MIN_CROP_PX` clamping — must be preserved.

## Decision

### Change 1a — corner handles, region starts full-image (corners only for MVP)

When the crop tool activates on a loaded image, the editor initializes the crop region to `fullImageRect(W, H)` and draws a grab handle at each of the four **corners**. Dragging a corner moves that corner while the diagonally-opposite corner stays pinned; the region is clamped to `[0,W]×[0,H]` and to `MIN_CROP_PX` in each dimension, with **no handle flipping** (a corner cannot be dragged past its opposite; it clamps at `min` distance).

**Recommendation: corners only, no edge-midpoint handles for the MVP.** Each corner already controls both axes, so the four corners span the full set of single-drag adjustments a user needs; edge-midpoint handles are a pure convenience that would double the hit-test surface (8 vs 4), double the cursor-feedback cases, and add `n/s/e/w-resize` states — cost with no capability gain for a coarse, destructive operation. Edge handles are a clean later addition if ever requested.

**Dragging inside the region (not on a handle) does nothing** in the MVP (cursor stays default; no capture is taken). This is the simpler option and matches the "shrink inward from each vertex" mental model the user described; whole-region translation would require distinguishing inside-drag from handle-drag, clamping a translation vector, and a `move`-cursor state — scope we deliberately avoid. (Recomposition is still fully possible: any corner drag repositions that side.)

### Change 1b — mouse-only completion: floating on-canvas ✓ / ✗ controls (HTML overlay)

**Recommendation: an HTML overlay element** — a small `div.crop-controls` containing an **Apply (✓)** and a **Cancel (✗)** button — appended to `#stage` and positioned over the canvas near the crop rectangle's bottom-right corner, using the **exact coordinate-mapping pattern already established by the inline text editor** (`positionTextEditor` in `src/editor/canvas.ts`).

Justification against the candidates and the existing UI idioms:

- The app has a proven precedent for an **HTML element floated over the CSS-scaled canvas**: the text editor appends an `<input>` to `canvas.parentElement` (`#stage`, which is `position: relative`) and maps bitmap-px → stage-local CSS-px via `scale = canvasRect.width / canvas.width`, with a `window "resize"` reposition hook. Reusing that pattern is low-risk and consistent. HTML controls also give the user a visible, discoverable affordance for **both** apply and cancel, located right at the action — satisfying "mouse must suffice."
- **Apply button in the HTML toolbar** — rejected: adds persistent modal toolbar chrome that is only meaningful in one tool, and sits far from the user's focus (the crop rect). It also has no natural "cancel" sibling without a second modal button.
- **Double-click inside the region** — rejected: invisible (no affordance), undiscoverable, provides no cancel path, and collides conceptually with "inside = inert."
- **On-canvas buttons drawn into the canvas 2D context** — rejected: would need bespoke hit-testing inside `onDown`, would risk leaking into rasterization discipline, and duplicates what a DOM element gives for free.

`Enter` (apply) and `Esc` (cancel) **remain as keyboard accelerators** (v1 wiring in `src/main.ts` is unchanged), but are now strictly optional.

Because the crop region now starts as the full image, `hasPendingCrop()` is true for the whole time the crop tool is active. `Enter`/✓ on an unshrunk full-image region hits the existing `computeCrop(...) === null` no-op guard: it tears down crop mode and pushes **no** history entry. `Esc`/✗ tears down crop mode without a document change. Both leave the crop tool selected but inactive; clicking the crop button re-initializes a fresh full-image region (recoverable).

### Change 2 — inline SVG crop-mark icon

Replace the `⌏` glyph on the crop button with an inline SVG crop-mark (the classic overlapping-L shape, `stroke="currentColor"`, `fill="none"`), sized to ~18px to match the toolbar's 16px glyph metrics. `currentColor` makes it inherit `--fg` on the panel and stay legible on the accent background when the button is `.active`. No icon font, no new dependency.

The other toolbar buttons (`select`, `arrow`, `rect`, `text`, capture, undo/redo, sizes) currently use Unicode text glyphs; there is **no existing SVG precedent**. Introducing SVG **only** on the crop button is the minimal fix for the reported legibility problem and avoids scope creep into a full toolbar re-icon. This is a deliberate, contained inconsistency; a later task can migrate the rest if desired.

## Alternatives considered

- **Keep v1 "draw fresh rectangle + Enter"** — rejected: directly contradicts the user's two requests (full-image start with handles; mouse-only apply).
- **Edge-midpoint handles in addition to corners** — rejected for the MVP (see 1a): doubles hit-test/cursor complexity for no new capability on a coarse destructive op.
- **Whole-region drag-to-move** — rejected for the MVP (see 1a): added interaction/clamping complexity beyond the request.
- **Toolbar Apply button / double-click-inside / canvas-drawn buttons** — rejected (see 1b) in favor of reusing the text-editor HTML-overlay pattern.
- **Re-icon the whole toolbar to SVG** — rejected as scope creep; fix only the reported-broken glyph.

## IPC / API contract

**None.** No Rust command added or changed. This remains pure `src/` work; the v1 note's WebView2/WKWebView `createImageBitmap` crop-overload support (macOS-safe) is unaffected.

Changed/added `src/` surface:

`src/editor/crop.ts` — `computeCrop`, `CropRect`, `MIN_CROP_PX` **unchanged**. Add:
- `export type CropHandle = "nw" | "ne" | "sw" | "se";`
- `export function fullImageRect(imageW: number, imageH: number): CropRect` — returns `{ x: 0, y: 0, w: imageW, h: imageH }`.
- `export function handleAt(point: Point, rect: CropRect, hitRadius: number): CropHandle | null` — returns the corner whose center is within Euclidean `hitRadius` of `point`; if several qualify (tiny rect), the nearest; else `null`.
- `export function applyHandleDrag(rect: CropRect, handle: CropHandle, point: Point, imageW: number, imageH: number, minSize: number): CropRect` — moves the corner named by `handle` to `point` (clamped to `[0,imageW]×[0,imageH]`), pinning the diagonally-opposite corner; enforces `minSize` in each dimension by clamping the moving corner (no flip); returns an integer-valued `CropRect`.

`src/editor/canvas.ts` — public API unchanged in shape (`hasPendingCrop()`, `applyCrop()`, `cancelCrop()` keep their signatures and meaning). Internal crop **state** changes from `{ a, b, phase }` to a rect + active-handle + owned DOM controls (below). `computeCrop` survives as the apply-time no-op/min guard and integer normalizer; the v1 inline-normalize in `drawCropOverlay` is replaced by direct use of the stored `rect`.

## State shape change (canvas.ts)

Replace:
```ts
private crop: { a: Point; b: Point; phase: "drawing" | "set" } | null = null;
```
with:
```ts
private crop: {
  rect: CropRect;              // current normalized, clamped, integer region
  drag: CropHandle | null;     // active corner drag; null when idle/hovering
  controls: HTMLDivElement;    // the floating ✓/✗ overlay (owned like textEdit.input)
  reposition: () => void;      // window "resize" handler, removed on teardown
} | null = null;
```
Rationale: a normalized `CropRect` is the natural state for handle math (`applyHandleDrag` pins the opposite corner derived from the rect, drift-free like the select tool's `original` base), and it feeds `drawCropOverlay` and `positionCropControls` directly. The controls DOM is owned by the crop state exactly as the `<input>` is owned by `textEdit`, with matching create/teardown discipline.

## Overlay controls positioning (reuse text-editor mapping)

`positionCropControls()` mirrors `positionTextEditor()`:
```
scale     = canvasRect.width / canvas.width
originX   = canvasRect.left - stageRect.left      // #stage is position:relative
originY   = canvasRect.top  - stageRect.top
place the control group near ( originX + (rect.x+rect.w)*scale ,
                               originY + (rect.y+rect.h)*scale ),
then clamp left/top so the group stays fully inside the stage viewport.
```
Called from `drawCropOverlay()` (so the controls track every handle-drag frame) and from the `window "resize"` handler. The canvas is CSS-scaled but sized in bitmap px; this is the same reason `hittest.ts` tolerance is scale-compensated at the call site.

## Handle rendering & hit-testing (bitmap-px, scale-compensated)

Handles must have a **constant on-screen size** regardless of image zoom, so both draw size and hit radius are expressed in CSS px and multiplied by `scale = canvas.width / canvasRect.getBoundingClientRect().width` (the same compensation `tolerance()` already uses):
- `HANDLE_DRAW_PX = 10` (square side, CSS px) → drawn side in bitmap px = `HANDLE_DRAW_PX * scale`.
- `HANDLE_HIT_PX = 12` (grab radius, CSS px) → `handleHitRadius() = HANDLE_HIT_PX * scale`.

Cursor feedback (set in `onMove` hover and held during a drag): `nw`/`se` → `nwse-resize`, `ne`/`sw` → `nesw-resize`, no-handle → `default`.

Coexistence with existing pointer handlers: the crop branches are additive and mutually exclusive with the `move`/`draft` branches (crop tool never creates a `draft`). `onDown` takes `setPointerCapture` **only** when a handle is actually grabbed; a non-handle press in crop mode is a no-op (no capture, no draft).

## crop.test.ts update plan

`src/editor/crop.test.ts`:
- **Survive unchanged**: the entire `describe("computeCrop", ...)` block (function is untouched) and the entire `describe("crop + translateAnnotation remap", ...)` block (apply mechanism is untouched).
- **Add `describe("handleAt", ...)`**: point near each corner within radius → that corner; point far from all corners → `null`; point equidistant/near two corners of a tiny rect → nearest corner.
- **Add `describe("applyHandleDrag", ...)`**: `nw` drag inward shrinks top-left with SE pinned; `se` drag inward shrinks bottom-right with NW pinned; `ne` and `sw` correctness; dragging beyond an image edge clamps into `[0,W]×[0,H]`; dragging past the opposite corner clamps to `minSize` (no flip); result is integer-valued.
- **Add** a one-line test for `fullImageRect(W,H)` → `{x:0,y:0,w:W,h:H}`.
No v1 tests are deleted or rewritten (v1 pure surface is a strict subset of v2).

## Updated ACs for TASK-4

- **#1** Architect design note exists (v1 + this v2 revision) covering interaction, annotation handling outside the crop, undo, the handle-based region, and mouse-only apply.
- **#2** Activating the crop tool starts the crop region as the **full image** with draggable **corner handles**; dragging a corner shrinks/expands that corner (clamped to image bounds and a minimum size), and an **on-canvas Apply (✓) control usable with the mouse alone** applies the crop, shrinking the document to the region.
- **#3** (unchanged) Existing annotations keep their position relative to the image content after cropping.
- **#4** (unchanged) Crop is a single undoable step (Ctrl+Z restores image and annotations).
- **#5** An **on-canvas Cancel (✗) control** and `Esc` each cancel the crop without changing the document; switching tools, paste/capture, and undo also cancel.

## docs/ARCHITECTURE.md deltas

- **"Crop" section**: change the interaction sentence from "drag a rectangle, `Enter` to apply" to: the region **starts as the full image with corner handles**; the user **shrinks it by dragging corners** (opposite corner pinned, clamped to bounds and `MIN_CROP_PX`); an on-canvas **✓ Apply / ✗ Cancel** overlay commits or cancels with the mouse, with `Enter`/`Esc` as accelerators. Keep the destructive-rasterize / translate / single-snapshot / keep-outside-annotations paragraph as-is.
- **"Toolbar" section**: rewrite the Crop paragraph to the handle-based flow and note the floating HTML ✓/✗ controls, positioned over the canvas with the same bitmap-px→CSS-px mapping as the inline text editor, and never rasterized.
- **"Keyboard shortcuts" table**: keep `Esc` = cancel pending crop else deselect, and `Enter` = apply pending crop; add a note that both are now **accelerators for the on-canvas ✓/✗ controls** (mouse suffices).
- **IPC contract** note: confirm crop v2 still introduces no IPC changes.

## Implementation tasks

Continue numbering from the v1 note (which ended at 30).

30. **`src/editor/crop.ts` — add pure helpers.** Keep `computeCrop`, `CropRect`, `MIN_CROP_PX` exactly as they are. Add `CropHandle`, `fullImageRect`, `handleAt`, and `applyHandleDrag` with the signatures in "IPC / API contract" above. `applyHandleDrag` pins the corner diagonally opposite `handle`, clamps the moving corner to `[0,imageW]×[0,imageH]`, enforces `minSize` per axis by clamping (no flip), and rounds to integers. Keep the file DOM-free; do **not** import it from `exporter.ts`. *Verify:* `pnpm check`.

31. **`src/editor/canvas.ts` — replace crop state.** Swap the `{ a, b, phase }` field for the `{ rect, drag, controls, reposition }` shape from "State shape change." Import `fullImageRect`, `handleAt`, `applyHandleDrag`, `CropHandle` from `./crop`. Add constants `HANDLE_DRAW_PX = 10`, `HANDLE_HIT_PX = 12` near `BASE_TOL_PX`. Add a private `handleHitRadius()` (mirror `tolerance()`), a private `cropScale()` returning `canvas.width / canvasRect.width`, and a private `cursorForHandle(h)` (`nw|se`→`nwse-resize`, `ne|sw`→`nesw-resize`). *Verify:* `pnpm check`.

32. **`src/editor/canvas.ts` — crop lifecycle (init/teardown) and `setTool`.** Add private `initCrop()`: guard on `this.hasImage() && !this.crop`; build the `div.crop-controls` with two `type="button"` buttons (✓ Apply → `void this.applyCrop()`, ✗ Cancel → `this.cancelCrop()`; each calls `e.stopPropagation()`), append to `canvas.parentElement`, register a `window "resize"` → reposition handler, set `this.crop = { rect: fullImageRect(w,h), drag: null, controls, reposition }`, then `render()`. Add private `teardownCrop()`: if `this.crop`, remove `controls`, remove the resize listener, set `this.crop = null` (no render; callers render). In `setTool`: when `t === "crop"` call `initCrop()`; when `t !== "crop"` call `teardownCrop()` (replacing the current `if (t !== "crop") this.crop = null;`). Also replace the raw `this.crop = null` in `setBackground` and `restore` with `teardownCrop()`. *Verify:* selecting crop on a loaded image shows handles + ✓/✗; switching tool / paste / undo removes them.

33. **`src/editor/canvas.ts` — pointer interaction.** Replace the v1 crop branches:
    - `onDown` (crop tool): `const h = handleAt(p, this.crop.rect, this.handleHitRadius())`; if `h`, `this.canvas.setPointerCapture(e.pointerId)`, `this.crop.drag = h`, set the resize cursor, `render()`, `return`; if no handle, `return` (inert, no capture). Place this branch so it manages its own capture (before the unconditional `setPointerCapture`, alongside the `text` early-return).
    - `onMove`: after the `this.move` branch, add — if `this.crop?.drag`, `this.crop.rect = applyHandleDrag(this.crop.rect, this.crop.drag, p, bitmap.width, bitmap.height, MIN_CROP_PX)`, `render()`, `return`. In the hover tail, when `tool === "crop"` and not dragging, set the cursor from `handleAt` (resize on a corner, else `default`).
    - `onUp`: replace the v1 crop block with — if `this.crop?.drag`, `this.crop.drag = null`, reset cursor to `crosshair`, `render()`, `return`. No history push on handle release.
    *Verify:* corners drag with correct cursors and clamp to bounds/min; the opposite corner stays pinned; inside/empty drags do nothing.

34. **`src/editor/canvas.ts` — overlay draw + controls positioning.** Rewrite `drawCropOverlay()` to read `this.crop.rect`: dim the four exterior regions, stroke the dashed white+accent border (unchanged style), then draw four corner handles as filled white squares with an accent border, side `HANDLE_DRAW_PX * cropScale()`, centered on each corner. At the end of `drawCropOverlay()`, call a new private `positionCropControls()` implementing the mapping in "Overlay controls positioning" (reuse the `positionTextEditor` scale math; clamp within the stage). Add a `.crop-controls` rule to `src/styles.css` (absolute, small gap, `z-index` above canvas, styled buttons consistent with `#copy/#save`). *Verify:* export/copy PNG contains no dim/border/handles/controls; controls track the rect during drags and on window resize.

35. **`src/editor/canvas.ts` — `applyCrop`/`cancelCrop` read the rect.** `cancelCrop()`: `if (!this.crop) return false; this.teardownCrop(); this.render(); return true;`. `applyCrop()`: build the guard rect via `computeCrop({x:rect.x,y:rect.y},{x:rect.x+rect.w,y:rect.y+rect.h}, src.width, src.height, MIN_CROP_PX)` from `this.crop.rect`; on `null` (full-image no-op or sub-min) → `teardownCrop()`, `render()`, `return` (no history). Otherwise keep the v1 body verbatim (`createImageBitmap`, the `imageBitmap !== src` await-guard with `cropped.close()`, `history.push`, translate annotations, resize canvas, clear `selectedId`/`move`) and replace the final `this.crop = null` with `this.teardownCrop()`. `hasPendingCrop()` stays `this.crop !== null`. *Verify:* ✓ or `Enter` on a shrunk region crops in one undoable step, annotations stay aligned; ✓/`Enter` on the untouched full image is a no-op with no history entry; ✗/`Esc` cancels.

36. **`index.html` — SVG crop icon.** Replace the crop button's `⌏` with an inline SVG crop-mark (classic overlapping-L, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap`/`linejoin="round"`, `width/height="18"`, `aria-hidden="true"`), keeping `data-tool="crop" class="tool" title="Crop (C)"`. Add a minimal `.tool svg { vertical-align: middle; }` rule to `src/styles.css` if needed for centering. Leave other buttons as glyphs. *Verify:* the crop icon is clearly visible on the panel and on the active accent background; the button still activates crop mode.

37. **`src/main.ts` — no code change expected.** The Enter/Esc wiring and the `button.tool` loop already work with the revised semantics; confirm no change is needed. *Verify:* `pnpm check`; a full mouse-only crop (activate → drag corner → click ✓) works with the keyboard untouched.

38. **`src/editor/crop.test.ts` — extend.** Keep both existing `describe` blocks unchanged. Add the `handleAt`, `applyHandleDrag`, and `fullImageRect` cases from "crop.test.ts update plan." *Verify:* `pnpm vitest run` green.

39. **`docs/ARCHITECTURE.md` — apply the deltas** in the "Crop", "Toolbar", "Keyboard shortcuts", and IPC sections as specified in "docs/ARCHITECTURE.md deltas."

40. **`backlog` TASK-4 — update ACs** to the wording in "Updated ACs," and add an implementation note recording the v2 revision. Leave status In Progress until AC#2–#5 are re-exercised via `pnpm tauri dev` on Windows.

## Files this touches

- `src/editor/crop.ts` (add `CropHandle`, `fullImageRect`, `handleAt`, `applyHandleDrag`)
- `src/editor/canvas.ts` (state shape, init/teardown, pointer handlers, overlay + handles, controls positioning, apply/cancel)
- `src/editor/crop.test.ts` (new test blocks)
- `index.html` (SVG crop icon)
- `src/styles.css` (`.crop-controls`, `.tool svg`)
- `docs/ARCHITECTURE.md` (deltas)
- backlog TASK-4 (ACs + note)

Unchanged by design, to be verified so: `src/editor/render.ts`, `src/editor/exporter.ts`, `src/editor/hittest.ts`, `src/editor/history.ts`, `src/editor/model.ts` (the `Tool` union already includes `"crop"`), `src/main.ts` (Enter/Esc + tool loop), and all of `src-tauri/`.

## v2.1 amendment (2026-07-16) — cancel/apply reset instead of teardown

**Source: user decision from Windows E2E of the v2 implementation.** Observed
behavior: clicking ✗ (or `Esc`) removed the crop region, handles, and ✓/✗
controls, leaving the crop tool button lit but the crop UI dead until the
user re-clicked the toolbar button. The user's request: cancelling a crop
must **reset the region to the full image**, not remove crop mode. Likewise,
applying a crop should leave crop mode active on the freshly-cropped image so
the user can immediately crop again, rather than dropping back to a bare
active-but-empty tool state.

**New invariant:** while the crop tool is active and an image is loaded,
there is **always** a visible region with corner handles and ✓/✗ controls.
Teardown (removing the controls DOM and nulling crop state) now happens
**only** when: (a) the user switches to a different tool (`setTool`), (b) a
new image replaces the background (`setBackground`, which then
re-initializes crop state immediately if the crop tool is still active), or
(c) undo/redo restores a different document (`restore`, same re-init
behavior as `setBackground`). Cancel and apply no longer tear crop mode down
at all — they only reset `crop.rect`.

Behavioral changes, all confined to `src/editor/canvas.ts`:

- **`cancelCrop()`**: no longer calls `teardownCrop()`. When `this.crop` is
  set, it resets `this.crop.rect` to `fullImageRect(bitmap.width,
  bitmap.height)` (the current image's dimensions), clears `this.crop.drag`,
  and re-renders — the DOM controls and their resize listener are left
  exactly as they were (owned continuously by the same `initCrop()` call).
  Still returns `false` when there is no active crop, and still never
  touches `doc`/`history` — the "cancel without changing the document" AC is
  unaffected, since a region reset is pure crop-UI state, not a document
  mutation.
- **`applyCrop()` success path**: after the document is cropped (unchanged:
  single `history.push`, translate, canvas resize), the tail no longer calls
  `teardownCrop()`. Instead it re-arms `this.crop.rect` to
  `fullImageRect(rect.w, rect.h)` — the *new*, post-crop image's full extent
  — and clears `this.crop.drag`, so the crop tool is immediately ready for
  another crop on the result. `selectedId`/`move` are still cleared; still a
  single `render()`.
- **`applyCrop()` no-op guard path** (region already full-image, or below
  `MIN_CROP_PX`): no longer tears down; just clears `this.crop.drag` and
  renders. No history push, matching the original no-op semantics — only the
  "what happens to crop UI state" changed.
- **`restore()`** (undo/redo): still calls `teardownCrop()` partway through
  (clearing the *old* image's crop state, unchanged), but now ends by
  mirroring `setBackground`'s pattern — `if (this.tool === "crop")
  this.initCrop(); else this.render();` — so undo/redo while the crop tool
  is active re-initializes a full-image region on the restored image instead
  of leaving a dead state. `initCrop()` renders internally and its
  `hasImage()` guard covers the (practically unreachable, since every
  history snapshot is pushed only after an image is already loaded) case of
  restoring a snapshot with a null background.

**Keyboard interaction note:** `main.ts` needs no change. `cancelCrop()`
still returns `true` whenever a crop is active, so `Esc` in crop mode is
still fully consumed by the crop-cancel branch and never falls through to
`clearSelection()` — correct under the new semantics too, since crop mode
never has a concurrent selection.

**Files touched by this amendment:** `src/editor/canvas.ts` only
(`cancelCrop`, `applyCrop`, `restore`); no changes to `crop.ts` or its tests
(the reset uses `fullImageRect`, already added in the base v2 note). No IPC
impact.
