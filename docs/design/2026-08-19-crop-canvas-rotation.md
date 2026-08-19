# Design note — Canvas rotation in crop mode: quarter turns + free rotation (TASK-52)

Author: architect agent, 2026-08-19. Status: proposed, ready for implementation.
Input: the approved plan (`crop-90-composed-perlis`, user-decided 2026-08-19). This note turns that plan into the project's design-note format, resolves the four detail questions it left open (band, controls layout, remap rule, interaction precedence), and ends with an ordered task list for the `implementer` agent.

Extends `docs/design/2026-07-15-in-editor-crop-tool.md` (v1) and `docs/design/2026-07-15-crop-tool-v2-handles.md` (v2 + v2.1 amendment), and the TASK-40 exit-to-select contract recorded in `backlog/tasks/task-40 - Crop-confirm-cancel-exits-crop-mode.md`.

## Problem

The crop tool can only trim an axis-aligned rectangle. A photo shot at a tilt cannot be straightened, and an image in the wrong orientation cannot be turned, so every such fix has to happen in another app before OpenSoegaki sees the file. The user decided (2026-08-19) that rotation belongs **inside crop mode** — quarter turns from on-canvas controls, free rotation by dragging the area outside the image — with the result **auto-cropped to the largest inscribed axis-aligned rectangle** so a rotated document never carries a transparent margin, and with rotation + crop landing as **one undoable step**. The hard part is not the rotation math: it is that the live canvas is simultaneously the document's backing store, the crop tool's coordinate system, and now a preview surface that must show an image smaller than its own frame — while `MIN_CROP_PX`, the corner-handle drag math, `positionCropControls`, the `cropScale()` family, TASK-40's no-history-on-untouched-apply guard and TASK-35.14's iOS canvas ceiling all keep meaning exactly what they meant before.

## Decision

Rotation is **destructive re-rasterization**, exactly like crop: never a stored angle. The document model, `render.ts` and `exporter.ts` are untouched; only the background bitmap is resampled and the annotations are rigidly re-mapped. Crop mode gains a **frame space**: a temporarily enlarged live canvas in which the preview is rotated and scaled to fit.

### D0 — Frame space (the coordinate model)

"Frame space" is the live canvas backing-store coordinate system while crop mode is active. All crop state lives there and nothing outside crop mode ever sees it.

- **Frame size.** Base dimensions are `(imgW, imgH)` for an even `quarter` and `(imgH, imgW)` for an odd one. The frame grows **outward** by the rotate band on every side: `frameW = min(baseW + 2*band, cap)`, `frameH = min(baseH + 2*band, cap)`, where `cap` is the existing platform seam `Editor.maxImportDimension` (web `4096`, desktop `null` = unbounded). For an image smaller than the stage this only adds the band — the picture itself does not shrink in bitmap terms (`s = 1`); only a `cap`-clamped import (a 4096 px iOS photo) is squeezed inward, which the preview scale `s < 1` absorbs.
- **Band freeze.** `band = ROTATE_BAND_CSS_PX * cropScale()`, computed **once per frame-size change** (`initCrop`, `setQuarter`) and stored in crop state. Recomputing it per render would close a feedback loop band -> frame -> display scale -> `cropScale()` -> band.
- **Preview transform.** Total angle `phi = quarter * PI/2 + tilt`. The image is rotated about the frame centre and uniformly scaled by `s = min(1, (frameW - 2*band) / bboxW, (frameH - 2*band) / bboxH)`, where `bbox` is the unscaled rotated bounding box. Exactly one module computes this (`cropFrameFor` in `src/editor/crop.ts`); `render()`, `drawCropOverlay()` and `applyCrop()` all read it.
- **Canvas resizes only on discrete events**: `initCrop`, `setQuarter`, `applyCrop`, `teardownCrop`. **Never mid-drag** — a tilt drag is relative, and changing the frame under it would stale the drag's pivot and start pointer and make the angle jump. This is also why tilt is clamped to **+/-45 degrees** (`MAX_TILT_RAD = PI/4`): promoting 45 degrees into a quarter turn would require a mid-drag resize. Beyond 45 degrees the user combines a quarter turn with a tilt.
- **The crop region is stored normalized** against the inscribed rect (`norm = {u0, v0, u1, v1}` in `[0,1]^2`). The pixel rect is derived on demand and rounded **only** in `applyCrop`. Storing integer pixels and re-deriving them on every angle change drifts — tilt out and back would return a thinner region.
- **Handles clamp to the inscribed rect, not to the image.** `computeCrop` and `applyHandleDrag` take a `bounds: CropRect` instead of `imageW, imageH`, and `computeCrop`'s "covers everything -> null" test is re-pointed at `bounds` too.

New crop state in `src/editor/canvas.ts` (replacing `{ rect, drag, controls, reposition }`):

```ts
private crop: {
  norm: NormRect;                 // region as a ratio of the inscribed bounds (source of truth)
  quarter: 0 | 1 | 2 | 3;         // clockwise quarter turns applied to the preview
  tilt: number;                   // free rotation, radians, clamped to +/- MAX_TILT_RAD
  band: number;                   // rotate-band thickness in FRAME px, frozen with the frame size
  touched: boolean;               // true once a corner handle has been dragged
  drag: CropHandle | null;        // active corner drag
  rotate: { startPointer: Point; startTilt: number; pivot: Point } | null;  // active tilt drag
  controls: HTMLDivElement;       // owned overlay (as today)
  readout: HTMLSpanElement;       // live angle label inside `controls`
  reposition: () => void;         // window "resize" handler (as today)
} | null = null;
```

`rect` is gone: the pixel rect is always `denormalizeRect(norm, frame.bounds, MIN_CROP_PX)`.

### D1 — The rotate band (detail A)

**`ROTATE_BAND_CSS_PX = 40`.**

*Effective on-screen thickness.* The band is measured in CSS px against the canvas as it is **before** the frame grows, so after the growth the on-screen thickness is `40 * S / (S + 80)`, where `S` is the constrained on-screen dimension of the stage. On the Playwright/iPhone target the viewport is 390 CSS px and `body.web-shell #stage` has 16 px side padding, so `S = 358` and the band renders **~32.7 CSS px** thick and 358 px long. On a typical Windows stage (`S ~ 1000`) it renders ~37 CSS px. After the first quarter turn the measurement is taken from the already-grown frame, so the value converges (contraction factor `2 * 40 / S < 1`, stable fixed point) to exactly 40 CSS px on screen; the band therefore lives in a bounded `[32.7, 40]` CSS px range on the phone and never ratchets.

*Why 40 and not 44 (Apple HIG).* HIG's 44x44 rule is about **isolated** controls. The band is a continuous strip — 32.7 x 358 CSS px per edge on the phone — and the tilt gesture is armed by a press **anywhere outside the crop region** (D4), so the band is only the *guaranteed minimum* rotate surface, present when the region still covers the whole image; it grows into the dimmed exterior the moment the user shrinks the region. The band must also stay clear of the crop corner handles, whose touch hit radius is `HANDLE_HIT_PX(12) * TOUCH_HIT_MULTIPLIER(2) = 24` CSS px: at 32.7 CSS px there is free band directly outboard of every corner. The cost of going bigger is preview size: the picture renders at `S / (S + 2 * band)` of its former size — 77.7 % at 40, 73 % at 48, 68 % at 56. 40 buys a comfortable strip for a ~22 % preview shrink; 56 would trade another 10 % of the photo for 10 CSS px that Fitts's law does not need on a full-edge-length target.

*Visual treatment.* Three layers, composed in this order:

1. **Void fill** — `render()` fills the whole frame with an opaque `CROP_VOID_FILL = "#2a2d31"` *before* the preview transform, so everything that is not image (the band and the triangular gaps a tilt opens) is one flat non-photographic slab. Slightly lighter than the app's stage background so the frame reads as a surface, not a hole.
2. **Exterior dim** — `drawCropOverlay`'s existing `rgba(0,0,0,0.45)` fill of the four regions outside the crop rect is **unchanged**, and now lands on top of the void as well. The band therefore resolves to ~`#171a1c`: clearly darker than both the image and the void inside the region, and continuous with the familiar dim so "outside the region" stays one single visual idea. Nothing new is needed for the tilt gaps — they are void, they are outside the region, they get dimmed like everything else.
3. **Image outline** — after the dim, stroke the quadrilateral through the four rotated image corners with `rgba(255,255,255,0.35)`, `lineWidth = 1 * cropScale()`, no dash. This is the only cue that says "the picture ends here and you are now on the drag band", and it is what makes a tilt legible at small angles. It must be drawn after the dim (so it is visible on the dark band) and before the dashed crop border and handles (so the region's own chrome stays dominant).

The floating controls group (D2) parks over the band's SE corner; a DOM element eats the pointer, so that patch of band cannot start a tilt. Acceptable and deliberate: the other three edges plus most of the fourth remain live, and this is the same trade the check/cross group has always made against the SE corner handle.

### D2 — `.crop-controls` layout (detail B)

Two rows in a single owned `div.crop-controls`, built by `initCrop()` (the markup is still generated in JS — `index.html` and `pwa/index.html` need no change):

```
row 1:  [ ccw ]  [ -90 deg ]  [ cw ]     rotate-ccw button, angle readout, rotate-cw button
row 2:  [   X   ] [   OK   ]             cancel, apply — stretched to the group's width
```

**Buttons.** Five `<button type="button">`, each 44x44 CSS px (up from today's 28x28 — the existing size predates the touch-target audit and is below HIG for both existing controls, so this fixes them in passing). Row 2's two buttons are `flex: 1 1 0` and therefore 75 px wide each. Classes: `crop-rotate-ccw`, `crop-rotate-cw`, `crop-angle` (the readout, a `<span>`), and the **unchanged** `crop-apply` / `crop-cancel` — `tests/e2e/crop-dismiss.spec.ts` selects those two by class, and that selector must keep working.

**Icons: inline SVG, never emoji/text glyphs.** Same precedent and same reason as `selection-delete` in `canvas.ts` (the emoji glyph rendered nearly invisible on iOS). All four are Feather-style, `viewBox="0 0 24 24"`, `width/height="20"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`, `aria-hidden="true"`, with the accessible name on the button's `aria-label` + `title`:

| button | `aria-label` / `title` | SVG paths |
| --- | --- | --- |
| `crop-rotate-ccw` | `Rotate left 90 deg` | `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>` |
| `crop-rotate-cw` | `Rotate right 90 deg` | `<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>` |
| `crop-apply` | `Apply crop (Enter)` | `<polyline points="20 6 9 17 4 12"/>` |
| `crop-cancel` | `Cancel crop (Esc)` | `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>` |

`crop-apply` keeps its green `color`, `crop-cancel` keeps `var(--fg)`; `currentColor` carries both into the SVG for free.

**Width arithmetic on a 390 CSS px viewport (CLAUDE.md's mandated re-do).** `#stage` is a full-width flex child, so `stageRect.width = 390`; `body.web-shell #stage` contributes `padding: 16px` per side -> **358 px of inner width**. The group is `display: flex; flex-direction: column; gap: 6px; padding: 4px`:

- row 1 content = `44 + 6 + 56 + 6 + 44 = 156 px` (56 px is the readout's `min-width`)
- group width = `156 + 2*4 (padding) = 164 px`
- row 2 = two `flex: 1 1 0` buttons in 156 px with a 6 px gap = `75 px` each >= 44 OK
- group height = `4 + 44 + 6 + 44 + 4 = 102 px`

`164 <= 358` (inner) `<= 390` — the group can never overflow the stage on any supported viewport (it still fits the narrowest realistic 320 px viewport: `320 - 164 = 156 >= 0`, so `positionCropControls`'s `stageRect.width - cw` clamp bound never goes negative). It occupies 164 x 102 = 16.7 k px^2, about 8 % of a 358 x 580 phone stage.

**`positionCropControls` fallbacks:** `controls.offsetWidth || 164` and `controls.offsetHeight || 102` (today: `|| 72` / `|| 32`). These are the pre-layout fallbacks for the very first call, so they must match the CSS above; if the CSS numbers change, these change with them.

**The readout never reflows the group.** `.crop-angle` is a non-focusable `<span>` with `min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; pointer-events: none;`. It shows the **total** angle `normalizeAngle(quarter*90 + tilt)` rounded to whole degrees, so the longest possible string is `-135 deg` (5 glyphs; at the 14 px panel font with tabular figures that is ~43 px, inside the 56 px floor). It is updated by `textContent` only, from `drawCropOverlay()`, so the DOM write is already once-per-render; `min-width` + tabular figures mean the string length can change without moving either rotate button under the user's finger mid-drag. No `aria-live` (a per-frame live region would make VoiceOver read the whole drag).

### D3 — The inscribed-rect remap rule (detail C)

`bounds` = the largest axis-aligned rectangle inscribed in the rotated, scaled image (`rotatedRectWithMaxArea`), centred on the frame centre, then deflated by `INSCRIBED_INSET_PX = 1` **frame px per side — but only when `phi` is not a multiple of 90 degrees.** The inset exists so that an anti-aliased edge pixel of the tilted image can never land inside the output (AC#4's "no transparent pixel", which is verified by sampling corner alpha). At an exact quarter turn the rotated image is pixel-aligned, there is no anti-aliased edge, and the inset **must** be 0 — otherwise an untouched region would sit 1 px inside the image and TASK-40 AC#3 (no history step on an untouched apply) would break.

The region is the normalized rect `norm`; the pixel rect is always derived:

```
denormalizeRect(norm, bounds, minSize):
  w  = clamp((u1 - u0) * bounds.w, minSize, bounds.w)        // MIN floor, then bounds ceiling
  h  = clamp((v1 - v0) * bounds.h, minSize, bounds.h)
  cx = bounds.x + (u0 + u1) / 2 * bounds.w                    // keep the region's centre
  cy = bounds.y + (v0 + v1) / 2 * bounds.h
  x  = clamp(cx - w / 2, bounds.x, bounds.x + bounds.w - w)   // then slide inside bounds
  y  = clamp(cy - h / 2, bounds.y, bounds.y + bounds.h - h)
  -> { x, y, w, h }     // floats; rounding happens only in applyCrop
```

**On an angle change:**

- **`!touched`** (no corner has ever been dragged): `norm` is **re-asserted** to `FULL_NORM = {0,0,1,1}`. A write, not an assumption — it is the one place that guarantees "an untouched region always covers the whole inscribed rect", regardless of what any other path did to `norm`.
- **`touched`, tilt change:** `norm` is **left exactly as it is**. The region rides the inscribed rect proportionally: it keeps its relative framing and shrinks/grows with the bounds. Because `norm` is in `[0,1]^2` by construction, the region can never escape the inscribed rect, and because nothing is written back, tilting out to 45 degrees and back to 0 restores the original region bit-for-bit (no drift, no clamping loss).
- **`touched`, quarter turn (`setQuarter(delta)`):** `norm` is **transposed with the turn**, so the region keeps tracking the same image content instead of appearing to jump to a mirrored part of the picture:

  ```
  delta = +1 (clockwise):   {u0, v0, u1, v1} -> {1 - v1,  u0,  1 - v0,  u1}
  delta = -1 (counter-cw):  {u0, v0, u1, v1} -> {v0,  1 - u1,  v1,  1 - u0}
  ```

  These are exact inverses of each other, and `FULL_NORM` is a fixed point of both — so the `!touched` branch above is consistent with (not contradicted by) this rule.

**Handle drags** are received in frame px, clamped by `applyHandleDrag(rect, handle, point, bounds, MIN_CROP_PX)` (integer-valued, as today), then written back with `norm = normalizeRect(rect, bounds)` and `touched = true`. `applyHandleDrag`'s integer rounding is harmless here because it happens only on a user-driven drag frame, never on an angle change — the drift the normalized model exists to prevent came from re-rounding on every angle change.

**At the `MIN_CROP_PX` floor:** the floor is enforced in `denormalizeRect` (grow around the centre, then slide inside `bounds`) and never written back into `norm`, so a tilt that squeezes the bounds does not destroy the user's framing — tilting back restores it. If `bounds` itself is smaller than `MIN_CROP_PX` on an axis (a pathological sliver), the clamp order above yields `w = bounds.w` and the region simply equals the bounds on that axis; `applyCrop` then still applies (a rotation is never silently discarded — see D5), and only a sub-1 px output is rejected.

### D4 — Interaction precedence in crop mode (detail D)

**`onDown`, `tool === "crop"`, `this.crop` set — decision order:**

1. **Corner handle.** `handleAt(p, rect, this.handleHitRadius(e.pointerType))` — if it hits: `setPointerCapture`, `crop.drag = h`, cursor `cursorForHandle(h)`, `render()`, return. (Unchanged behaviour, except `rect` is now derived and `bounds` is the inscribed rect.)
2. **Outside the region -> tilt.** Else, if `p` is **not inside** `rect`: `setPointerCapture` (mandatory — "drag outside the image" is exactly the gesture that leaves the canvas box), `crop.rotate = { startPointer: p, startTilt: crop.tilt, pivot: frame centre }`, cursor `ROTATE_CURSOR_ACTIVE`, return **without** rendering (nothing has changed yet).
3. **Inside the region -> inert.** Else return with no capture and no draft — v1/v2's "inside is inert" contract, preserved verbatim.

**`onMove` priority** becomes: annotation rotate > resize > move > **crop tilt** > crop handle drag > draft > hover. The tilt branch is inserted immediately before the existing `if (this.crop?.drag)` branch (they are mutually exclusive, but the tilt branch must be above `draft`):

```
crop.tilt = tiltFromDrag(crop.rotate.pivot, crop.rotate.startPointer, p, crop.rotate.startTilt, shiftKey)
cursor = ROTATE_CURSOR_ACTIVE; render(); return;
```

`tiltFromDrag` (in `crop.ts`, built from `rotate.ts`'s `pointerAngle` and `ROTATION_SNAP_RAD`) is relative to the grab (the image never snaps to the pointer), snaps the **absolute** angle to 15 degrees when `shiftKey` is held (so 0, 15, 30, 45 are all reachable), and **clamps to +/-MAX_TILT_RAD**. Known, accepted corner: a single gesture that sweeps more than 180 degrees around the pivot wraps the delta's sign; the clamp bounds the damage and continuing the drag recovers.

**Hover cursor** (`onMove` tail, `tool === "crop" && this.crop`, no drag active): on a corner handle -> `cursorForHandle`; else outside the region -> `ROTATE_CURSOR_HOVER` (reusing TASK-41's existing custom cursor, `, grab` fallback included); else -> `default`.

**`onUp`:** a new branch beside the existing handle-release one — `if (this.crop?.rotate) { this.crop.rotate = null; cursor = "crosshair"; render(); return; }`. No history push (the tilt only becomes undoable state in `applyCrop`). Pointer capture is released implicitly by the browser on `pointerup`, exactly as the existing branches assume.

**Composition with check/cross/Enter/Esc:** unchanged entry points and unchanged meaning. `cancelCrop()` still routes through `setTool("select")`, which now also restores the canvas dimensions via `teardownCrop` (B1 below) — so Esc/cross discards the rotation **and** the region **and** the frame. `applyCrop()` gains the rotation path (D5). `hasPendingCrop()` is unchanged, so `src/app.ts`'s Enter/Esc wiring needs no change, and the Escape precedence (popover > crop-cancel > selection-clear) is untouched. No new global keyboard shortcuts are introduced for the quarter turns — they would have to be squeezed into that precedence chain for no AC-level benefit. An Esc landing mid-tilt-drag is safe: the drag record lives inside `this.crop`, and `teardownCrop` nulls the whole object.

**TASK-47 hook (pointercancel hygiene).** When TASK-47 lands, its reset routine must clear `crop.rotate` alongside `crop.drag`, `rotateDrag`, `resize`, `move`, `magnifierPlace` and `draft`, and restore the tool's resting cursor. Add `crop.rotate` to that list at the same time as the others — a cancelled tilt drag that stays armed would otherwise keep rotating the preview on the next unrelated pointermove.

**B1 — `teardownCrop` is the single owner of restoring canvas dimensions.** The frame is larger than the document even at `quarter === 0`, so leaving crop mode without shrinking the canvas back would paint an original-size bitmap onto an oversized canvas (the cross and undo paths). `teardownCrop` therefore ends with:

```ts
const bmp = this.doc.imageBitmap;
if (bmp && (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height)) {
  this.canvas.width = bmp.width;
  this.canvas.height = bmp.height;
  this.fitCanvasToStage();
}
```

Verified against all four existing call sites: `setBackground` and `restore` assign `doc.imageBitmap` **before** calling `teardownCrop`, so this either no-ops or pre-empts the resize they do two lines later (identical values); `applyCrop` sets the canvas to the new output size before `setTool("select")`, so it no-ops; `clearDocument` calls it before nulling the bitmap, so the canvas returns to the old document's size and is then hidden by the welcome state. No other code path may write canvas dimensions on the way out of crop mode.

`recomputeDocScale()` is deliberately **not** called: `docScale` only affects the *creation* size of new annotations, and the long side is invariant under a quarter turn and can only shrink under a tilt + inscribed crop — the same reason crop has never recomputed it. Add one line to that effect at `canvas.ts`'s existing `docScale` comment.

### D5 — Apply: one resample, one undo step

`applyCrop()` splits on whether there is any rotation at all:

```
frame    = cropFrame()                                  // the single owner, D0
rectF    = denormalizeRect(crop.norm, frame.bounds, MIN_CROP_PX)      // frame px
srcRect  = frameToRotatedSource(rectF, frame)           // rotated-source px (undoes s and the frame offset)

if (cropAngle() === 0):
    // Pure crop — byte-identical to the TASK-4/40 path, including its no-op guard.
    rect = computeCrop(srcRect corners, fullImageRect(src.width, src.height), MIN_CROP_PX)
    if (!rect) { setTool("select"); return; }           // untouched or degenerate: NO history push
    ...existing v2 body verbatim (createImageBitmap(src, x, y, w, h), translateAnnotation, ...)
else:
    r = documentRotation(src.width, src.height, cropAngle(), srcRect)   // rotate.ts, pure
    mapped = doc.annotations.map(a => rotateAnnotationForDocument(a, r, this.ctx))   // BEFORE the await
    off = new OffscreenCanvas(r.out.w, r.out.h)
    octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = "high"
    octx.setTransform(...r.matrix); octx.drawImage(src, 0, 0)
    rotated = await createImageBitmap(off)
    if (this.doc.imageBitmap !== src) { rotated.close(); return; }      // existing stale-document guard
    history.push(snapshot()); doc.imageBitmap = rotated; doc.annotations = mapped
    canvas.width = r.out.w; canvas.height = r.out.h; fitCanvasToStage()
    ...clear selectedId/move/resize/rotateDrag/magnifierPlace/draft...
    if (this.crop) setTool("select"); else render()
```

Notes that are load-bearing:

- **Resolution is preserved: 1 output px = 1 source px.** The output size is `round(srcRect.w) x round(srcRect.h)` in source pixels, i.e. `s` is divided out; stroke widths and font sizes keep their exact relative proportions, and the output's long side is always <= the source's.
- **The source bitmap is never `close()`d** — history holds it by reference.
- The rasterization pattern (`OffscreenCanvas` -> `imageSmoothingQuality = "high"` -> `createImageBitmap(off)`) is the one already established by `decodeClampedBitmap` in `src/editor/downscale.ts`. Note that on **desktop** `maxImportDimension` is `null`, so that path never actually runs there today: this is the first `OffscreenCanvas` use on WebView2. Chromium has supported it since 69, and WKWebView since Safari 16.4 (which `docs/WEB.md` already documents as a floor for `convertToBlob`), so both the current target and the planned macOS port are covered. If a future target lacks it, the one-line fallback is `document.createElement("canvas")` — same API surface from `getContext("2d")` onward.
- The `await` guard is the existing one: everything needed is computed into locals **before** the await, and the `doc.imageBitmap !== src` check after it discards the result.

### D6 — Annotation mapping

Source -> output is a **rigid** transform (rotation by `phi` + translation); `s` never applies, so every size field is invariant. `rotate.ts` gains two exports and reuses everything else:

- Kinds with an angle (`rect`, `image`, `text`, `badge`, and any `arrow`/`highlight` that a future TASK-42 group rotation gave an `angle`): `applyRotation(a, angleOf(a) + phi)`, then `translateAnnotation` by the delta that puts `pivotOfAnnotation` exactly on `r.map(oldPivot)`.
- `arrow` / `highlight` with `angle === 0`: map every point directly (`from`/`to`, `points`). Exact, and it preserves the existing design intent that an arrow's direction is first-class in `from`/`to` rather than in `angle`.
- `magnifier` (excluded from `canRotate` because its source rectangle is always axis-aligned in image space — see that function's doc comment): map `at` and `from` as points, leave `angle` at 0, and swap `width`/`height` for a **rect** lens only when `phi` is an odd multiple of 90 degrees.

`text` needs real measurement, so the new mapper takes `measure: CanvasRenderingContext2D` explicitly (the `pivotOfAnnotation` convention) — vitest runs in `environment: "node"` and could not otherwise unit-test it.

### Invariants that stay untouched

- **`src/editor/exporter.ts`, `src/editor/render.ts`, and the annotation object model (`src/editor/model.ts`)**: unchanged. Rotation is destructive, so nothing downstream ever learns about a document-level angle, and crop chrome still cannot reach a raster (AC#9).
- **`docScale`**: not recomputed (rationale in D4); `hittest.ts`, `history.ts`, `bounds.ts`, `resize.ts` unchanged.
- **`index.html` / `pwa/index.html`**: unchanged — `.crop-controls` is built in JS.
- **`src-tauri/`**: unchanged. No IPC.
- **TASK-40's contract**: check/cross/Enter/Esc still exit crop mode to the select tool; an untouched, unrotated apply still pushes no history.

### Documented deviations (accepted by the user, to be recorded in TASK-4 and ARCHITECTURE.md)

1. **A rect-lens magnifier un-tilts under free rotation** (its centre and zoom are preserved; circle lenses are exact, and rect lenses are exact under quarter turns). The model cannot give a magnifier an angle without breaking the axis-aligned-source invariant that `canRotate` documents. **This is an explicit exception to TASK-4 AC#3** ("annotations keep their position relative to the image content") and to TASK-52 AC#6, and must be written into both tasks.
2. **One extra resample of the background per rotate-apply** — the same destructive-rasterize property crop has always had.
3. **Exporting while crop mode is active exports the un-rotated document** — the same consequence as crop chrome never reaching an export: the preview transform lives on the live canvas, the document does not change until apply.

## Alternatives considered

- **Non-destructive rotation: store an angle on the document.** Rejected: `render.ts`, `exporter.ts`, `hittest.ts`, the drag-out/clipboard producers and every coordinate mapping in `canvas.ts` would each need to learn a document-level transform, and the model would grow a document frame that nothing else needs. Destructive rasterize keeps the object-model invariant honest (annotations stay data; the background was always pixels) and keeps the blast radius inside `crop.ts` / `rotate.ts` / `canvas.ts`.
- **Rotate band as DOM (a padded wrapper around the canvas) instead of growing the canvas.** Genuinely attractive: it would keep the canvas at document size, add zero pixels to the backing store, and dodge the `cap` interaction entirely. Rejected: pointer handling would split across two elements and break the single `toCanvas()` mapping that every hit test and every `cropScale()`-compensated constant depends on; the wrapper would need its own capture, cursor and hit logic; and the tilted image would be **clipped** by the canvas box, which defeats the whole point (the user must see the picture shrink and turn inside its frame).
- **Letterbox the quarter-turn preview inside a fixed frame** (keep the canvas dimensions, draw the turned image scaled-to-fit). Rejected by user decision #4, and independently: a portrait photo turned inside a landscape frame renders at ~56 % of its former size for no gain, and the crop handles would then clamp to a region that no longer matches the frame.
- **Allow a transparent margin after a free rotation** (no auto-crop). Rejected by user decision #2, and independently: the Windows clipboard's DIB path has no alpha, so a "transparent" margin would surface as black in the most-used export route.
- **Slider or numeric angle input** for the tilt. Rejected by user decision #3: persistent modal chrome that competes with the toolbar on a 390 px viewport, and it duplicates a gesture the canvas can express directly.
- **Separate toolbar rotate buttons.** Rejected by user decision #1: rotation is a document-geometry edit that must compose with the crop into a *single* undo step; a toolbar button would either push its own history entry per turn or need a hidden pending-rotation state outside crop mode.
- **Re-normalize the region in absolute pixels on an angle change** (keep the region's physical size, re-derive `norm` against the new bounds). Rejected: as the bounds shrink, the region must be clamped, and clamping is lossy and non-invertible — tilting out and back would not restore the user's framing. Proportional carry (D3) is exactly invertible.
- **Clamp tilt to +/-90 degrees (or leave it unbounded) and promote to a quarter turn at 45.** Rejected: promotion means resizing the frame mid-drag, which stales the drag pivot and makes the angle jump — the one thing D0 forbids.

**Cost summary.** No new dependency (the whole feature is ~350 lines of TypeScript; binary size unchanged, and `src-tauri/` is untouched). Idle memory outside crop mode is unchanged. Inside crop mode the canvas backing store grows by `(frameW*frameH - imgW*imgH) * 4` bytes — ~22 % for a typical photo — and `applyCrop` transiently allocates one `OffscreenCanvas` no larger than the source. Cross-platform reach is unchanged (all APIs used are already used by the app on both webviews, with the `OffscreenCanvas`-on-WebView2 note in D5).

## IPC / API contract

**No IPC.** No Tauri command is added or changed; `src-tauri/` is not touched. This stays pure `src/` work, and nothing here blocks the macOS port (see D5 on `OffscreenCanvas`).

The changed/added TypeScript surface:

`src/editor/crop.ts` (stays DOM-free and canvas-free; still never imported by `exporter.ts`):

```ts
export const MAX_TILT_RAD = Math.PI / 4;
export const INSCRIBED_INSET_PX = 1;
export interface NormRect { u0: number; v0: number; u1: number; v1: number }
export const FULL_NORM: NormRect;

export interface CropFrame {
  w: number; h: number;                 // frame (live canvas) size, px
  band: number;                         // frozen band thickness, frame px
  angle: number;                        // total rotation, radians, normalized
  s: number;                            // preview scale applied to the source image
  image: { w: number; h: number };      // source document size
  bbox: { w: number; h: number };       // rotated bbox, FRAME px (already scaled by s)
  bounds: CropRect;                     // inscribed rect (crop bounds), frame px, inset applied
}

export function cropFrameSize(imageW: number, imageH: number, quarter: number, band: number, cap: number | null): { w: number; h: number };
export function cropFrameFor(imageW: number, imageH: number, frame: { w: number; h: number; band: number }, angle: number): CropFrame;
export function rotatedBBox(w: number, h: number, angle: number): { w: number; h: number };
export function rotatedRectWithMaxArea(w: number, h: number, angle: number): { w: number; h: number };
export function normalizeRect(rect: CropRect, bounds: CropRect): NormRect;
export function denormalizeRect(norm: NormRect, bounds: CropRect, minSize: number): CropRect;
export function rotateNormRect(norm: NormRect, quarterDelta: -1 | 1): NormRect;
export function frameToRotatedSource(rect: CropRect, frame: CropFrame): CropRect;
export function tiltFromDrag(pivot: Point, startPointer: Point, pointer: Point, startTilt: number, snap: boolean): number;

// signature changes (imageW, imageH -> bounds):
export function computeCrop(a: Point, b: Point, bounds: CropRect, minSize: number): CropRect | null;
export function applyHandleDrag(rect: CropRect, handle: CropHandle, point: Point, bounds: CropRect, minSize: number): CropRect;
```

`src/editor/rotate.ts` (leaf; still imports only `model.ts` + `bounds.ts`):

```ts
export interface DocumentRotation {
  angle: number;                                          // normalized total rotation
  out: { w: number; h: number };                          // output document size, integer px
  matrix: [number, number, number, number, number, number]; // ctx.setTransform(...) for drawImage(src, 0, 0)
  map(p: Point): Point;                                   // source image px -> output px
}
export function documentRotation(srcW: number, srcH: number, angle: number, outRect: CropRect): DocumentRotation;
export function rotateAnnotationForDocument(a: Annotation, r: DocumentRotation, measure: CanvasRenderingContext2D): Annotation;
```

`src/editor/canvas.ts` — public API unchanged (`hasPendingCrop()`, `applyCrop()`, `cancelCrop()` keep their signatures and meaning); new private members `setQuarter`, `cropFrame`, `cropAngle`, `cropRect`, `freezeBand`, `applyPreviewTransform`, `updateCropReadout`, plus the state shape in D0.

## Risks and AC-regression watchlist (for the reviewer)

- **TASK-40 AC#3** (untouched apply pushes no history) — protected by the `cropAngle() === 0` branch plus the zero inset at right angles (D3/D5). `tests/e2e/crop-dismiss.spec.ts`'s second test is already an exact regression guard, including for B1: it reads the canvas dimensions *before* entering crop mode and asserts them after leaving.
- **TASK-4 AC#3** — deliberately excepted for rect-lens magnifiers under free rotation; must be recorded in the task, not silently broken.
- **TASK-35.14 (iOS canvas ceiling)** — the frame is capped per axis by `maxImportDimension`, so the live canvas never exceeds `cap x cap` = the same worst case a square 4096 px import already produces today. New, though: a *non-square* 12 MP import now reaches that worst case for the first time (4096 x 3072 -> up to 4096 x 3988). **Entering crop mode on a 12 MP photo must be added to the iPhone device checklist.**
- **TASK-35.11 / TASK-38 / TASK-41** — the controls group grows from 72 x 32 to 164 x 102 CSS px; re-check that it never collides with `#share-bar` or the badge bar and that the `positionCropControls` inside/outside flip still behaves at the stage edges.
- **`pnpm test:e2e` (iPhone viewport) is required before sign-off**, and the review verdict must state its verification scope (`code-trace only` / `browser-verified` / `device-verified`) per CLAUDE.md.

## Implementation tasks

Each task is self-contained and ends with a check. Do not make design decisions here — if something in this note does not fit the code, stop and route it back to `architect`.

1. **T1 — `src/editor/crop.ts`: pure frame geometry.** Add `MAX_TILT_RAD`, `INSCRIBED_INSET_PX`, `NormRect`, `FULL_NORM`, `CropFrame`, and the functions `cropFrameSize`, `cropFrameFor`, `rotatedBBox`, `rotatedRectWithMaxArea`, `normalizeRect`, `denormalizeRect`, `rotateNormRect`, `frameToRotatedSource`, `tiltFromDrag` with the exact signatures in "IPC / API contract". `rotatedRectWithMaxArea` is the standard largest-area inscribed-rectangle solution using `|sin|`/`|cos|` (so it is valid for any angle) with the near-45-degree degenerate branch. `cropFrameFor` applies `INSCRIBED_INSET_PX` **only when the angle is not a multiple of `PI/2`** (tolerance `1e-9`), and guards `s` against a non-positive inner dimension by falling back to `band = 0` for the scale computation only. Change `computeCrop` and `applyHandleDrag` to take `bounds: CropRect` (including `computeCrop`'s "covers the whole bounds -> null" test and `applyHandleDrag`'s clamps, which become `bounds.x`/`bounds.x + bounds.w` instead of `0`/`imageW`). Keep the file DOM-free and keep it out of `exporter.ts`'s import graph. *Verify:* `pnpm check`.

2. **T2 — `src/editor/rotate.ts`: document rotation + annotation mapping.** Add `DocumentRotation`, `documentRotation(srcW, srcH, angle, outRect)` and `rotateAnnotationForDocument(a, r, measure)` per D6. `documentRotation` treats `outRect` as living in rotated-source space (origin = the rotated bbox's top-left, unit = source px): `map(p) = rotatePoint(p, c, angle) - c + (bboxW/2 - outRect.x, bboxH/2 - outRect.y)` with `c = (srcW/2, srcH/2)`; `matrix = [cos, sin, -sin, cos, map({x:0,y:0}).x, map({x:0,y:0}).y]`; `out = { w: round(outRect.w), h: round(outRect.h) }`. Reuse `normalizeAngle`, `rotatePoint`, `applyRotation`, `angleOf`, `pivotOfAnnotation`; do not change any existing export. Keep the module a leaf (only `model.ts` + `bounds.ts` imports). *Verify:* `pnpm check`.

3. **T3 — `src/editor/canvas.ts`: crop state, frame lifecycle, preview render.** Replace the crop state field with the shape in D0. Add constants `ROTATE_BAND_CSS_PX = 40` and `CROP_VOID_FILL = "#2a2d31"` near the other CSS-px constants. Add private `freezeBand()`, `cropAngle()`, `cropFrame()`, `cropRect(frame?)`, `applyPreviewTransform(ctx, frame)`. `initCrop()` gains: `commitTextEditor()` first, then build the two-row controls (T6), then `band = freezeBand()` **before** any resize, then `cropFrameSize(..., quarter 0, band, this.maxImportDimension)` -> write `canvas.width/height` -> `fitCanvasToStage()` -> set state with `norm: FULL_NORM, quarter: 0, tilt: 0, touched: false, drag: null, rotate: null` -> `render()`. `teardownCrop()` gains the B1 canvas-dimension restore from D4 (exact code given there). `render()` fills `CROP_VOID_FILL` over the whole frame when crop is active and wraps **only** the background `drawImage` + `renderAnnotations` (+ draft) in `save()/applyPreviewTransform/restore()`. Add the one-line "rotation is out of scope for the same reason" note at the existing `docScale` comment. *Verify:* `pnpm check`; activating crop shows the image inside a dark band; leaving crop restores the canvas dimensions.

4. **T4 — `src/editor/canvas.ts`: quarter turns and overlay chrome.** Add private `setQuarter(delta: -1 | 1)`: guard on crop + image; `norm = rotateNormRect(norm, delta)` when `touched` (else re-assert `FULL_NORM`); update `quarter`; `band = freezeBand()` measured **before** the resize; `cropFrameSize` -> `canvas.width/height` -> `fitCanvasToStage()` -> `render()`. Rewrite `drawCropOverlay()` to read `frame = cropFrame()` and `rect = cropRect(frame)`: existing exterior dim (unchanged), then the rotated-image outline (`rgba(255,255,255,0.35)`, `lineWidth = 1 * cropScale()`, through the four rotated image corners), then the existing dashed border and corner handles, then `updateCropReadout()` and `positionCropControls()`. *Verify:* the quarter-turn buttons swap the canvas width/height and turn the preview; the outline tracks the image; export still contains no chrome.

5. **T5 — `src/editor/canvas.ts`: gesture wiring.** Implement D4 exactly: the three-way `onDown` order, the `onMove` tilt branch (before the handle-drag branch) using `tiltFromDrag`, the handle-drag branch re-pointed at `frame.bounds` with the `normalizeRect` write-back and `touched = true`, the hover cursor rules, and the `onUp` tilt-release branch. Leave a `// TASK-47:` comment on the `crop.rotate` field naming it as state that pointercancel hygiene must clear. *Verify:* dragging the band tilts with +/-45-degree clamping and 15-degree Shift snapping; the region follows the inscribed rect; corner drags still clamp and pin correctly; a press inside the region is still inert.

6. **T6 — `src/editor/canvas.ts` + `src/styles.css`: the two-row controls.** Build the five controls with the inline SVGs, classes, `aria-label`/`title` from D2 (`crop-apply` / `crop-cancel` class names must not change), each handler calling `e.stopPropagation()`; ccw -> `setQuarter(-1)`, cw -> `setQuarter(+1)`. Add `updateCropReadout()` writing `textContent` only. Update `positionCropControls`'s fallbacks to `|| 164` and `|| 102`. In `styles.css`, make `.crop-controls` a `flex-direction: column; gap: 6px; padding: 4px` group with two `.crop-row` flex rows, buttons at `44px` square (row 2's `flex: 1 1 0`), `.crop-angle` with `min-width: 56px; text-align: center; font-variant-numeric: tabular-nums; pointer-events: none`, and `.crop-controls svg { display: block }`. Record the 390 px width arithmetic from D2 as a CSS comment (house style — see the `#badge-bar` comment). *Verify:* on the iPhone viewport the group measures 164 x 102, no row wraps, the readout does not shift the buttons while dragging, and the SVGs are crisply visible.

7. **T7 — `src/editor/canvas.ts`: `applyCrop` rotation path.** Implement D5's split exactly. Keep the existing `cropAngle() === 0` body verbatim (including its `computeCrop` no-op guard and `translateAnnotation` remap), only feeding it the source-space rect from `frameToRotatedSource`. Add the rotated branch with `documentRotation`, `rotateAnnotationForDocument` (mapped **before** the await), the `OffscreenCanvas` + `imageSmoothingQuality = "high"` + `createImageBitmap` rasterization, the existing `doc.imageBitmap !== src` stale guard (`rotated.close()` on abort), a single `history.push(snapshot())`, and the canvas resize + `fitCanvasToStage()`. Never `close()` the source bitmap. *Verify:* apply commits rotation + crop as one undoable step; one Ctrl+Z fully restores dimensions and content.

8. **T8 — unit tests.** `src/editor/crop.test.ts`: keep every existing block (updating call sites for the new `bounds` parameter) and add — `rotatedRectWithMaxArea` (identity at 0, `w/sqrt(2)` for a square at 45 degrees, the near-45 degenerate branch, area monotonicity, 90 degrees swaps w/h); `cropFrameSize` (band growth, odd-quarter swap, `cap` clamp with `cap = null` meaning unbounded); `cropFrameFor` (`s === 1` and zero inset at right angles, `s < 1` and a 1 px inset off them, `bounds` centred on the frame); `normalizeRect`/`denormalizeRect` round-trip with no drift plus the `MIN_CROP_PX` floor and the sub-minimum-bounds case; `rotateNormRect` (+1 then -1 is the identity, `FULL_NORM` is a fixed point); `tiltFromDrag` (relative to the grab, 15-degree snap, +/-45-degree clamp); `computeCrop`/`applyHandleDrag` clamping to `bounds` and `computeCrop` returning `null` for a bounds-sized rect. `src/editor/rotate.test.ts`: `documentRotation` (90 degrees x4 is the identity; `matrix` maps the source corners onto the output corners); `rotateAnnotationForDocument` (a rect's four world corners match exactly; a circle magnifier keeps `angle === 0`, `zoom`, `radius`; a rect magnifier swaps w/h at +/-90 and 270 degrees but not at 37; an `angle === 0` arrow is mapped point-wise and gains no `angle`; **auto** badges only — a manual badge's `badgeHalfWidth` needs `document`, per the `hittest.test.ts` precedent). *Verify:* `pnpm test` green on Windows.

9. **T9 — e2e, docs, backlog.** New `tests/e2e/crop-rotate.spec.ts` (iPhone viewport; reuse `canvasGeometry`/`toScreen`/`pixelAt` from `rotate.spec.ts` and the shared `fixtures.ts` loader): a clockwise quarter turn then apply swaps the canvas `width`/`height` and moves a known fixture pixel to its rotated position (AC#2, #5); a quarter turn then cancel restores the original canvas dimensions (**the B1 guard**, AC#7); quarter turn -> apply -> one undo restores dimensions and content (AC#5); a band drag then apply leaves all four output corners at alpha 255 (AC#4 — confirm the fixture is fully opaque first); the two existing `crop-dismiss.spec.ts` cases pass **unmodified** (AC#8). Update `docs/ARCHITECTURE.md`: rewrite the Crop section for the frame-space preview, the band, the two-row controls, `teardownCrop` as the sole owner of the canvas dimensions, and the three documented deviations — **and fix the section's stale TASK-40 wording** ("neither apply nor cancel exits crop mode" is the opposite of the shipped behaviour). Update `backlog` TASK-4 (AC#3 magnifier exception) and TASK-52 (link this note; record the deviations; keep the task **In Progress** until every AC is exercised in `pnpm tauri dev` on Windows, per "Done means verified"). *Verify:* `pnpm build:web && pnpm test:e2e`, then the Windows device pass.

### Addendum (2026-08-19, revised after reviewer B2): tilt deadband + apply-time frame + arming slop

Recorded during implementation review (reviewer F8, then B1/B2 on TASK-52) — a small, authorised amendment to D3/D4/D5, not a re-opening of the decision. The first cut of this addendum (arithmetic-only deadband, below) shipped but turned out to be insufficient on its own; this revision describes what actually ships: **three** cooperating fixes, not one.

**Problem, restated in full.** `applyCrop()`'s rotated-vs-pure-crop split (D5) needs a single, reliable answer to "did the user actually rotate anything?" for a press-and-release on the rotate band with no perceptible drag. Three independent gaps could each defeat that answer on their own — fixing only one (the original deadband) left the other two live:

1. **Pointer jiggle leaves a non-zero `crop.tilt`.** `tiltFromDrag` (D4) is relative-to-grab, driven by `pointerAngle`; a 1px jiggle with no intent to rotate can leave `crop.tilt` at a residual on the order of `1e-7` rad instead of bit-exact `0`.
2. **The arithmetic-only deadband didn't reach `applyCrop`'s frame.** The first fix snapped `cropAngle()`'s return value to exactly `0` under `TILT_DEADBAND_RAD`, and `applyCrop()`'s zero-test read `cropAngle()` — but `applyCrop()` built its **frame** (`rectF`/`srcRect`) from `cropFrame()`, which reads the RAW `crop.tilt`, not the deadbanded angle. `cropFrameFor` applies `INSCRIBED_INSET_PX = 1` for any angle not within `1e-9` of a right angle, so a residual in-deadband tilt still shrank `bounds` by that 1 frame px — `computeCrop` then saw a non-full-coverage rect and returned a real crop (plus a history push) for an apply the zero-test itself considered untouched. The deadband and the frame geometry were reading two different angles.
3. **The deadband's own threshold was reachable by an unintended drag.** A 1 CSS px jiggle at a realistic ~300px pivot radius is **~0.19°** — already ABOVE `TILT_DEADBAND_RAD` (0.1°) — so a tap-scale pointer movement could take the full resample-plus-inscribed-crop path even with both of the above fixed, while the readout still showed "0°".

**Fix, three parts, all required:**

1. **Deadbanded `cropAngle()`** (unchanged from the original addendum). `crop.ts` has `TILT_DEADBAND_RAD = Math.PI / 1800` (0.1°). `canvas.ts`'s `cropAngle()` snaps its normalized total angle to exactly `0` when its magnitude is under the deadband.
2. **`applyCrop()` builds its frame from the effective angle, not the raw one.** `applyCrop()` computes `angle = this.cropAngle()` FIRST, then derives its own `frame` by calling `cropFrameFor(src.width, src.height, { w: canvas.width, h: canvas.height, band: crop.band }, angle)` directly — it no longer calls `cropFrame()` (which stays reserved for the LIVE preview, read by `render()`/the gesture handlers, and intentionally still reads the raw un-deadbanded `crop.tilt`). With `angle === 0` fed into `cropFrameFor`, the inset is exactly 0, `srcRect` is exactly the full image, and the pure-crop no-op guard fires bit-exactly. This closes gap 2.
3. **The tilt gesture is armed only past a slop, so a tap never writes `crop.tilt` at all.** `canvas.ts` gains `TILT_SLOP_PX = 4` (CSS px, scale-compensated at the call site — same idiom as `DOUBLE_TAP_SLOP_PX`). `onDown`'s tilt branch (D4 step 2) records `{ startPointer, startTilt, pivot, armed: false }` instead of writing `tilt` immediately; `onMove`'s tilt branch checks `armed` first and, while unarmed, computes the pointer's distance from `startPointer` and returns WITHOUT writing `crop.tilt` (or rendering) until that distance exceeds `TILT_SLOP_PX * cropScale()` — at which point it flips `armed = true` for the rest of the gesture and proceeds exactly as before. This closes gap 3 at its actual source (a tap never becomes a rotation) rather than papering over it at apply time.

**Why the original (arithmetic-only) deadband was insufficient.** It only ever addressed gap 1 — "round a tiny residual angle to zero for the zero-test" — which implicitly assumed the zero-test and the frame geometry read the same angle (they didn't, gap 2) and that any residual small enough to reach `applyCrop` was also small enough to be inside the deadband (it wasn't, once amplified by pivot-radius geometry — gap 3). A reviewer round briefly patched the *symptom* of gap 2 by widening `computeCrop`'s no-op test to a 1px tolerance instead of fixing the frame; that tolerance was reverted (`computeCrop`'s no-op test is exact equality again) once gap 2 was fixed at its source, because the tolerance also silently discarded a genuine <=1px trim on the pure-crop path.

**Scope, still deliberately narrow.** None of the three fixes touch:

- `crop.tilt` itself (the stored gesture state) — never snapped by the deadband, and never written at all until the slop-arming fix's `armed` flag flips true.
- `cropFrame()`, which builds the LIVE preview transform from `quarter * (Math.PI / 2) + this.crop.tilt` directly, bypassing `cropAngle()` entirely — so the on-screen preview always tracks the raw pointer once armed, with no deadband-induced "dead zone" feel to the drag, and no jump when arming completes (armed only gates the WRITE to `crop.tilt`, not the preview transform's own math).

So a user who deliberately drags the band past `TILT_SLOP_PX` to, say, 0.05° still sees exactly that tilt live; only a tap/jiggle that never clears the arming slop writes nothing at all, and only the apply-time frame (now built from the same effective angle as the zero-test) decides whether a genuine sub-deadband residual counts as "no rotation."

### Addendum (2026-08-19, UI-1/UI-2 + reviewer polish round): the controls group moves off the SE anchor

Recorded after the browser-verified APPROVE turned up a real rendered-viewport bug that neither the code-trace review nor the earlier device-checklist items had caught: a rendered check on the 390×844 iPhone viewport (CLAUDE.md's mandated "UI reviews include a rendered check") found `.crop-controls` covering essentially the whole image on one fixture and being wider than the image on another.

**UI-1 — the SE-corner anchor does not survive a five-control group.** D2's `.crop-controls` layout inherited its positioning strategy — `positionCropControls`, anchored outward from the crop rect's SE corner, with an inside-the-region fallback when the outward placement clamped — from the two-button `✗ / ✓` group in `docs/design/2026-07-15-crop-tool-v2-handles.md`'s v2. That anchor kept the SE *handle point* clear by `HANDLE_MARGIN_PX` (13px), which was enough when the group itself was 72×32 CSS px. D2 grew the group to 164×102 CSS px to fit the rotate controls and the angle readout, and at that size the SE-corner anchor stopped protecting anything: measured with the 800×200 `WIDE_PNG_BASE64` fixture, the 164×102 group landed on top of the crop region and hid essentially the whole image; with the 120×90 `SMALL_PNG_BASE64` fixture the group was WIDER than the image. It also reaches any stage-filling image once tilted — a 20° tilt of the wide fixture left only a 46×16 CSS px patch of the region clear of the 164×102 panel. The anchor was protecting one point (the SE corner), never the region's visible area, and the group's footprint grew past what one corner's clearance could absorb.

**Fix.** `.crop-controls` is now docked at the **bottom-centre of `#stage`** by pure CSS (`left: 50%; transform: translateX(-50%); bottom: 8px`), inside the existing `body.web-shell #stage` padding (`padding-bottom: 24px`) so it can never reach into `#share-bar`'s territory — see `styles.css`'s own comment on the rule for the full offset arithmetic. `positionCropControls` (the outward placement, the flip-inside fallback, the stage clamp, and the `controls.offsetWidth || 164` / `controls.offsetHeight || 102` pre-layout fallbacks) is deleted outright, along with the `window "resize"` reposition hook it existed to drive (CSS now re-derives the position for free on every stage resize) and its `crop.reposition` state field/teardown. `HANDLE_MARGIN_PX`, left with no other reader once `positionCropControls` was gone, is deleted too. The class names (`crop-controls`, `crop-apply`, `crop-cancel`, `crop-angle`, `crop-rotate-ccw`, `crop-rotate-cw`) are unchanged, so `crop-dismiss.spec.ts`'s selectors keep working untouched. `docs/ARCHITECTURE.md`'s crop section, which described the group as "positioned near the region's bottom-right corner," is updated to match.

This does not eliminate all overlap — a tall, stage-filling image still has its bottom strip covered by a fixed 164×102 CSS px chip — but it bounds the overlap to a small, predictable, always-in-the-same-place region instead of one that can grow to cover (or exceed) the entire image depending on the crop rect's current size and position, which is what the SE anchor could not guarantee.

**UI-2 — the angle readout was illegible over a light image.** `.crop-angle` was a transparent `<span>` with no background of its own; over a light image (visible in the `SMALL_PNG_BASE64` screenshot) it rendered white-on-white. Fix: `.crop-controls` itself now carries the same panel background/border treatment the buttons already had (`background: var(--panel); border: 1px solid #45484e; border-radius: 8px`), so the whole group — including the row gaps and the readout — reads as one opaque chip against any image, not just wherever a button happens to sit. `.crop-angle` keeps its `min-width` + `tabular-nums` (still the mechanism that stops the readout's digit-count changing mid-drag from moving either rotate button).

**Reviewer polish items applied in the same round** (all non-blocking findings from the browser-verified APPROVE, folded in here rather than left for a follow-up task):

1. **`freezeBand()`'s hidden-canvas fallback was mis-sized.** The existing guard (B1) already handled `cropScale()` returning a non-finite value when `#canvas` is `display: none`, but its fallback was a bare `scale = 1` — correct only for a canvas already near its natural on-screen size. For a large import (e.g. 4096px) this produced a band of `40` FRAME px, only ~3.5 CSS px once the canvas became visible: effectively ungrabbable until the first rotate-button tap re-froze the band correctly. `freezeBand()` now derives the scale `fitCanvasToStage()` would itself produce from the STAGE's client box (never `display: none` while crop mode is activating, unlike the canvas), and only falls through to the scale-of-1 constant if that box is also unusable.
2. **Named the apply-time frame.** `applyCrop()` used to build its frame with an inline `cropFrameFor` call, next to (but easy to accidentally reunify with) `cropFrame()`'s LIVE-preview call a few lines away — exactly the kind of adjacency that caused the B2.1 bug this design note's previous addendum already fixed once. A new private `effectiveFrame()` accessor sits directly beside `cropFrame()`, sharing one doc comment that states the raw-tilt-vs-effective-angle split explicitly, and `applyCrop()` now calls it instead of inlining `cropFrameFor`.
3. **Readout precision.** `Math.round(deg)` showed "0°" for anything under 0.5°, even though a real resample already happens above the 0.1° deadband — a bare 4px arming-slop drag on a large desktop canvas lands around 0.46°. Below 1° magnitude (and not exactly 0, which stays a plain "0°" for the genuinely untouched idle state) the readout now shows one signed decimal place instead of wrapping into `[0°, 360°)`; at or above 1° the existing integer/wrap behaviour is unchanged.
4. **Arming-slop e2e coverage.** `tests/e2e/crop-rotate.spec.ts` gained a test that presses on the band, moves 2 CSS px (under `TILT_SLOP_PX = 4`), releases, and applies — asserting the canvas dimensions are unchanged (no crop, no history). This exact regression (a tap/jiggle silently becoming a rotation) had bitten twice before with no direct guard.
5. **Non-vacuity for the no-transparent-corner spec.** The existing tilt-then-apply test could pass vacuously if the tilt drag failed to arm (apply would silently take the no-op path, and all four corners of an already-opaque fixture would trivially read alpha 255). The test now reads `.crop-angle` before applying and asserts it isn't `"0°"`, and asserts the output's dimensions actually shrank versus the pre-crop document size.
6. **`crop.test.ts`'s F9 now goes one step further.** The angle-0 "whole-image crop recovers `{0,0,imgW,imgH}`" test now feeds that recovered `srcRect` into `computeCrop(..., fullImageRect(...), MIN_CROP_PX)` and asserts `null` — pinning TASK-40 AC#3 (no history push on an untouched apply) end-to-end, not just the intermediate geometry it depends on.
7. **`tests/e2e/fixtures.ts`'s stale doc comment fixed.** It claimed `rotate.spec.ts` used the shared `canvasGeometry`/`toScreen` helpers; it does not (nor do the magnifier specs) — each still carries its own private copy. Comment corrected to state that plainly rather than implying a refactor that was never done; the other specs are explicitly left untouched.

### Addendum (2026-08-19, reviewer round): the bottom-centre dock (UI-1) itself covered the corner handles — moved in-flow, superseding UI-1

**This supersedes UI-1 above, not just polishes it.** The bottom-centre dock UI-1 introduced was still `position: absolute` — an overlay ON TOP OF `#stage`, just parked at a fixed point instead of tracking the crop rect's SE corner. A browser-verified review round measured it with `document.elementFromPoint` at the four live crop corner-handle screen positions and found it a **blocking regression**, not a polish item:

| viewport | fixture | sw handle hits | se handle hits |
| --- | --- | --- | --- |
| WebKit 390x844 (shipped iPhone target) | TALL 120x900 | `DIV.crop-controls` | `DIV.crop-controls` |
| WebKit 844x390 (landscape) | TALL 120x900 | `BUTTON.crop-cancel` | `BUTTON.crop-apply` |
| WebKit 844x390 (landscape) | SMALL 120x90 | `BUTTON.crop-rotate-ccw` | `BUTTON.crop-rotate-cw` |
| Chromium 1280x800 (desktop shell) | TALL 120x900 | `DIV.crop-controls` | `DIV.crop-controls` |

A press meant for the bottom-left handle on a portrait photo never reached the canvas at all — the region could not be shrunk from the bottom, directly failing **TASK-4 AC#2** ("dragging a corner shrinks/expands it"), a Done task's regression contract. On the small landscape fixture the same gesture instead landed on a rotate button and silently spun the document 90°. The rotate band's own midpoint (D1's tilt-drag target) was swallowed on 5 of 9 measured geometries too, degrading this design note's own AC#3.

**Root cause.** A fixed-size floating panel anchored to a POINT (the stage's bottom-centre) protects that point's own footprint, never the region it happens to be parked over — exactly the failure UI-1 already diagnosed for the SE-corner anchor it replaced ("protecting one point, never the region's visible area"), just recurring one anchor point later. Sizing the group to fit every corner handle everywhere it could be dragged is not tractable (the handles range over the whole stage); the only fix that actually bounds the overlap to zero is to stop overlapping at all.

**Fix (option A — the precedent TASK-38 already set).** `.crop-controls` becomes an **in-flow flex child of `#app`**, a sibling of `#stage` and `#share-bar` — not an overlay drawn on top of `#stage` at any fixed point. This is the exact fix TASK-38 landed for `#badge-bar` hitting the identical failure mode ("the fixed-overlay bar hides the bottom of the photo, making it impossible to stamp there" → make the bar in-flow so `#stage` shrinks and the canvas rescales into what's left). `body.crop-bar-open` (mirroring `body.badge-bar-open`) hides `#share-bar` while crop is active — crop is modal, so losing Copy/Share for its duration is the same trade-off the badge bar already makes — and the two bars defensively cross-hide each other in CSS so they can never both render, the same "single open" discipline `src/ui/badgebar.ts` documents for itself (crop and the badge tool are different tools and can't legitimately both be open, but the ordering that guarantees this — `initCrop()` runs before `onToolChanged` closes the badge bar inside `setTool()` — is now backed by CSS rather than trusted implicitly).

Now that the group is in-flow, its old two-row layout would double `#app`'s bottom-chrome height (badge-bar-sized, ~102 CSS px) instead of staying close to `#share-bar`'s own. It collapses to **one row**: `[rotate-ccw] [angle] [rotate-cw] [cancel] [apply]`, each button still 44 CSS px minimum. See `src/styles.css`'s `.crop-controls` comment for the full width arithmetic at 390px and the narrowest realistic 320px viewport — it fits both without wrapping or shrinking any button under 44px.

**Ordering hazard.** `freezeBand()` (canvas.ts) reads `#stage`'s own `clientWidth`/`clientHeight` — this became the PRIMARY computation in the N1 reviewer round below, superseding an earlier version of this paragraph that described it as only a `display: none` fallback (B1, pre-existing: a real path in its own right, since `app.ts`'s `syncEmptyState()` un-hides `#canvas` only AFTER `initCrop()` re-arms crop on a fresh `setBackground`/`restore`, and is still handled — see N1). That stage read must observe `#stage` ALREADY SHRUNK by the crop bar just inserted, or it computes a band against the stale, pre-shrink stage size. `initCrop()`'s sequence — insert bar into `#app` → add `body.crop-bar-open` → `freezeBand()` → size the canvas → `fitCanvasToStage()` → set crop state → `render()` — guarantees this for the crop bar's OWN insertion: `clientWidth`/`getBoundingClientRect()` force a synchronous layout recalculation reflecting the CURRENT DOM the moment they're read, independent of `#stage`'s (separate, async) `ResizeObserver`, so as long as the bar/class land strictly before `freezeBand()` runs (which they do, textually, in `initCrop()`), that read is already correct with no extra forced-reflow statement needed. `teardownCrop()` removes the bar and the class (restoring `#share-bar`) unconditionally, before its existing canvas-dimension restore, so the two can never observe an inconsistent order.

This is a **narrower guarantee than an earlier version of this paragraph implied**: it only covers DOM changes `initCrop()` itself makes before calling `freezeBand()` (its own bar, its own class). It does NOT extend to another bar's open/close state changing elsewhere in the SAME `setTool()` call — concretely, switching directly from the badge tool into crop mode: `setTool("crop")` runs `initCrop()` (and therefore `freezeBand()`) while `#badge-bar` is still open and `#stage` is still badge-bar-shrunk, because `body.badge-bar-open` is only removed afterward, when `onToolChanged` fires `src/ui/badgebar.ts`'s close handler later in that same synchronous call. `freezeBand()` therefore correctly measures the stage as it is AT THAT INSTANT, but that instant is not the final, settled layout crop mode is about to render into. Measured on the TALL 120×900 fixture / 390×844 iPhone viewport (N1's reviewer round): a plain entry freezes 35.6 CSS px; entering directly from an open badge bar freezes 32.9 CSS px instead — a small, bounded discrepancy from this cross-bar ordering gap, and NOT the same defect N1 fixed (that one, entering crop with a stubbed soft keyboard already up, is now bit-identical to the plain-entry baseline: 35.6 CSS px both ways, because that staleness lived in `cropScale()`'s reliance on the canvas's own inline box, not in a same-tick DOM-ordering race between two bars). Left unfixed here — out of scope for the N1 finding and not requested by this round of review; if it becomes a real problem the fix would be reordering `setTool()`'s badge-bar-close relative to `initCrop()`, which is an architecture decision for a future round, not a `freezeBand()` change.

**UI-2 (illegible readout) is unaffected**, and effectively subsumed: an in-flow bar with `#share-bar`/`#badge-bar`'s own opaque `background: var(--panel)` is opaque by construction, the same way those two bars already are — no separate "chip" background is needed once the group is no longer floating over arbitrary image content.

**Also corrected in this round** (accumulated staleness, not new design):
- The `164x102` group-size figure quoted by UI-1's width arithmetic (already stale after UI-2's own border addition made it `166x104`) is retired along with the two-row layout it described; `src/styles.css` and `docs/ARCHITECTURE.md` are updated to describe the current single-row in-flow bar instead (the new width arithmetic lives in the CSS comment referenced above). This note's own D2 task-list entry (T6) is left as the historical record of the original two-row plan, not rewritten to chase a number that no longer describes the shipped layout.
- `tests/e2e/crop-rotate.spec.ts`'s comments describing the controls group as "parked at the band's SE corner (D1)" (stale since UI-1, never swept) are corrected to describe the current in-flow bottom bar.
- A new `tests/e2e/crop-rotate.spec.ts` test drags a BOTTOM corner handle on the TALL (120x900) portrait fixture and asserts the region actually shrinks, then applies and asserts the output is smaller than the source — closing the actual coverage gap that let this regression ship past two prior review rounds (every existing crop-drag assertion exercised the TOP handles or no drag at all).
- The arming-slop guard test gained a positive control (an 8 CSS px move, above `TILT_SLOP_PX = 4`) asserting the angle readout DOES leave `"0°"` — the existing negative-only assertion ("readout stays 0°, dims unchanged") could pass vacuously for a pointerdown that never reached the canvas at all, which is exactly this bug class.

## Files this touches

- `src/editor/crop.ts` — frame/inscribed/normalized geometry; `computeCrop` + `applyHandleDrag` re-pointed at `bounds`
- `src/editor/rotate.ts` — `documentRotation`, `rotateAnnotationForDocument`
- `src/editor/canvas.ts` — crop state, frame lifecycle, preview render, chrome, gestures, apply
- `src/styles.css` — single-row, in-flow `.crop-controls` (see the addendum superseding UI-1)
- `src/editor/crop.test.ts`, `src/editor/rotate.test.ts`, `tests/e2e/crop-rotate.spec.ts`, `tests/e2e/fixtures.ts`
- `docs/ARCHITECTURE.md`, backlog TASK-4 / TASK-52

Unchanged by design, to be verified so: `src/editor/exporter.ts`, `src/editor/render.ts`, `src/editor/model.ts`, `src/editor/hittest.ts`, `src/editor/bounds.ts`, `src/editor/resize.ts`, `src/editor/history.ts`, `src/main.ts`, `src/main-web.ts`, `index.html`, `pwa/index.html`, and all of `src-tauri/`.
