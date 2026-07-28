# Magnifier / loupe annotation — design note

Superseded in part by Addendum A: [./2026-08-01a-magnifier-creation-revision.md](./2026-08-01a-magnifier-creation-revision.md) — creation gesture revised after real-iPhone testing.

Superseded in part by Addendum B: [./2026-08-02-magnifier-connector-and-size-limits.md](./2026-08-02-magnifier-connector-and-size-limits.md) — connector simplified to one segment, and lens/source size clamps replaced with operability-based limits.

Partially overridden by Addendum C: [./2026-08-02a-magnifier-tapered-connector.md](./2026-08-02a-magnifier-tapered-connector.md) — connector widened and tapered toward the lens after real-iPhone feedback.

*Date: 2026-08-01 · Status: agreed, ready for implementation · Author: architect agent*

**User decisions folded in (final, not open):** circular lens inset; smooth interpolation (`imageSmoothingQuality: "high"`); S/M/L selects the lens's target size as a fraction of the canvas's long side.

## Problem

A user photographs or captures a wide scene for context but wants the recipient to actually *see* one small detail in it. Today that means two images (wide + crop) or a crop that loses the context. The magnifier annotation puts both in one image: a **source region** somewhere on the background, and a magnified **lens** of that region drawn elsewhere on the same image, visibly linked. It must be a first-class object annotation (movable, resizable, undoable, re-editable, rasterized only on export), must work with a mouse on Windows 11 and a finger in the iPhone PWA, must not block the macOS port, and must not introduce a second copy of "where does this pixel data come from" that can go stale (the `Doc.images` staleness hazard must not be replicated).

## Decision

### 1. Data model

New kind `"magnifier"`, added to `ToolKind` (so it joins `AnnotationKind` automatically):

```ts
export interface MagnifierAnnotation extends AnnotationBase {
  kind: "magnifier";
  /** CENTER of the lens circle, in bitmap coords — same convention as
   *  BadgeAnnotation's `at` (a center, not a corner). */
  at: Point;
  /** Lens radius, bitmap px. */
  radius: number;
  /** Magnification factor (> 1). */
  zoom: number;
  /** CENTER of the source region, in bitmap coords. The source region is
   *  DERIVED: a circle of radius `radius / zoom` centered here. */
  from: Point;
}
```

**Authority: the lens (`at`, `radius`), `zoom` and `from` are authoritative; the source region is derived.** One derived-geometry owner lives in a new pure leaf module `src/editor/magnifier.ts`:

```ts
export function magnifierSourceRadius(a: MagnifierAnnotation): number;  // a.radius / a.zoom
export function magnifierSourceRect(a: MagnifierAnnotation): Bounds;    // bounding SQUARE of the source circle
export function magnifierLensRect(a: MagnifierAnnotation): Bounds;      // bounding SQUARE of the lens circle
```

Why this authority and not the reverse (source authoritative, lens derived) or both stored:

- With a circle there is exactly one size scalar per object, so deriving the source from `radius / zoom` makes **uniform magnification structural** — there is no representable state where the magnified pixels are distorted, and no invariant for five call sites to maintain.
- The lens is the object the user directly frames and drags; keeping it authoritative means the existing badge-shaped machinery (`cornerHandles(bounds)`, center-pinned radius resize, filled-circle hit test) applies almost verbatim.
- Storing both circles would be a redundant representation of one fact — the same argument `rotate.ts` already makes for not giving arrow an `angle`.

**Source marker: a circle, radius `radius / zoom` — not the sampled square.** `ctx.drawImage` samples an axis-aligned rectangle, so internally we sample the source circle's **bounding square** (side `2·radius/zoom`, centered on `from`) and paint it into the lens's bounding square (side `2·radius`), clipped to the lens circle. The square's corners are therefore **never visible** in the output. Marking the square on the image would over-claim what the lens shows; the honest marker is the circle whose content actually survives the clip. It also makes the connector a clean circle↔circle external-tangent construction. The sampled square stays an implementation detail (`magnifierSourceRect`), drawn nowhere.

**`boundsOf` returns the lens circle's bounding square** — `{ x: at.x − radius, y: at.y − radius, w: 2·radius, h: 2·radius }`, structurally identical to the badge case. Not the union of lens + source: `boundsOf`'s documented job is the box that the marquee, the resize handles and the rotation pivot are positioned from, and every one of those wants the lens. The source circle is a **satellite** with its own handle family and its own hit region — the precedent already exists in `resizeHandlesFor`, where arrow's handles are read off the annotation rather than off `bounds`. Say this out loud in `boundsOf`'s doc comment.

**Rotation: `canRotate("magnifier") === false`** (no code change — `canRotate` is an allowlist; add the rationale row to the ARCHITECTURE table). The reason is correctness, not taste: `ctx.drawImage`'s *source* rectangle is always axis-aligned in image space and is unaffected by the ctx transform, while the source ring drawn inside `renderAnnotations`'s generic rotate transform *would* swing around the lens's pivot. The ring would end up pointing at a region the loupe does not sample — the annotation's entire spatial claim, broken. (A circle is rotationally symmetric anyway, so the affordance would be visually meaningless even where it were safe.) Magnifier becomes the third exemption alongside arrow (redundant representation) and highlight (shape distortion).

> **Forward hazard to record for TASK-42 (multi-select group rotation):** group rotation must treat magnifier as **translation-only** — rigidly rotate the `from` and `at` points, leave `angle` at 0. Setting `angle` on a magnifier silently produces the broken state above. Put this warning in both `drawMagnifier` and the `canRotate` doc comment.

**Crop.** `applyCrop` translates every annotation by `−origin` via `translateAnnotation`, which for magnifier moves **both** `from` and `at` — the existing translate-and-keep policy, unchanged and fully undoable. If the source region then falls partly outside the new background, the lens renders **only the overlapping part**: `clampSampleRect` intersects the sample square with the bitmap and clips the destination square in the same proportion, so the corresponding slice of the lens shows content and the rest lets the background through. Fully outside → nothing painted inside the lens, but the border, the source ring and the connector still draw, so the user can see the loupe and drag it back. No auto-delete, no clamping of `from` into the image — consistent with the documented crop policy ("kept, translated, never clipped or deleted"). Because the loupe samples `doc.imageBitmap` **live**, a crop (or an undo of one) is picked up for free — which is exactly why pre-baked crops in `Doc.images` were rejected. The magnifier therefore adds **no pixel storage and no `Doc.images` staleness surface at all**.

**Constants:**

| Constant | Value | Home |
| --- | --- | --- |
| `MAGNIFIER_LENS_FRACTION_PRESETS` | `{S: 0.22, M: 0.30, L: 0.40}` — target lens **diameter** as a fraction of the canvas's long side | `model.ts` |
| `MIN_MAGNIFIER_ZOOM` / `MAX_MAGNIFIER_ZOOM` | `1.2` / `16` | `magnifier.ts` |
| `MIN_MAGNIFIER_SOURCE_RADIUS_PX` | `2` (sampled square side ≥ 4 px) | `magnifier.ts` |
| `MAGNIFIER_TAP_SLOP_PX` | `12` **CSS** px, `× cropScale()` at the call site | `magnifier.ts` |
| `MAGNIFIER_TAP_SOURCE_RADIUS_FRACTION` | `0.06` of the canvas's short side | `magnifier.ts` |
| `MAGNIFIER_GAP_PX` | `12` bitmap px — rim-to-rim gap for auto-placement | `magnifier.ts` |
| `MAGNIFIER_CONNECTOR_MIN_GAP_PX` | `2` — below this rim gap the connector is suppressed | `magnifier.ts` |
| `MAGNIFIER_SOURCE_STROKE_RATIO` | `0.6` (source ring weight relative to `strokeWidth`, min 1) | `render.ts` |
| `MAGNIFIER_ZOOM_HANDLE_ANGLE` | `Math.PI / 4` (SE on the source rim) | `resize.ts` |
| `MIN_MAGNIFIER_RADIUS` / `MAX_MAGNIFIER_RADIUS` | `12` / `4096` | `resize.ts` |

The S/M/L diameters are nudged down from the 25/33/45 % that a rectangular inset would have used: a disc is visually dominant and must coexist on the same canvas with its own source region and the connector between them, whereas a rectangle could be wide-and-short.

`MAX_MAGNIFIER_RADIUS` is deliberately generous (a 4000 px imported photo wants an ~800 px lens at L); the *effective* upper limit in practice comes from the zoom clamp and the sample floor, not from this number.

### 2. Rendering

`drawMagnifier(ctx, a, background)` — draw order matters:

1. **Connector, first (underneath both rings)** so the tangent segments tuck under the rims' strokes. `connectorTangents(from, r1, at, r2)` returns the two **external tangent segments** between the source circle (center `c1 = from`, radius `r1 = radius/zoom`) and the lens circle (center `c2 = at`, radius `r2 = radius`), or `null`.

   Exact construction (pure, unit-testable):

   ```
   d = |c2 − c1|
   if (d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX) return null;   // overlapping, touching, or too close
   u  = (c2 − c1) / d
   cosT = (r1 − r2) / d              // |r1 − r2| < d is guaranteed by the guard above
   sinT = sqrt(1 − cosT²)
   n±   = ( u.x·cosT ∓ u.y·sinT ,  u.y·cosT ± u.x·sinT )    // u rotated by ±T
   segment± = [ c1 + r1·n± ,  c2 + r2·n± ]
   ```

   The derivation: a common external tangent touches both circles along the *same* unit normal `n`, and the touch-to-touch segment must be perpendicular to it, i.e. `(c2 − c1)·n + (r2 − r1) = 0` ⇒ `u·n = (r1 − r2)/d`. The two solutions are `u` rotated by `±T`.

   The single distance guard **subsumes containment** (`d < |r2 − r1|` implies `d < r1 + r2`) and the coincident-centers case (`d = 0`), so there is exactly one `null` condition to test and to explain: *no connector when the two circles overlap or nearly touch* — a connector through the overlap looks broken and communicates nothing the adjacency already says.

   Drawn in the house two-pass style: `OUTLINE` (`rgba(255,255,255,0.9)`) at `strokeWidth + 4`, then `a.color` at `strokeWidth`, `lineCap: "round"`.

2. **Source ring:** `arc(from, sourceRadius)`, same two-pass style but at `max(1, strokeWidth × MAGNIFIER_SOURCE_STROKE_RATIO)` so it reads as secondary to the lens. Outline only — no dimming of the exterior; dimming is crop *chrome*, and this is exported content.

3. **Lens content:**

   ```
   ctx.save();
   ctx.beginPath(); ctx.arc(a.at.x, a.at.y, a.radius, 0, 2*Math.PI); ctx.clip();
   ctx.imageSmoothingEnabled = true;
   ctx.imageSmoothingQuality = "high";
   const s = clampSampleRect(magnifierSourceRect(a), background.width, background.height, magnifierLensRect(a));
   if (s) ctx.drawImage(background, s.src.x, s.src.y, s.src.w, s.src.h, s.dest.x, s.dest.y, s.dest.w, s.dest.h);
   ctx.restore();
   ```

   If `background === null`, skip this step only (the silently-skip policy `drawImageAnnotation` already uses for a missing bitmap).

   - **`save`/`restore` here is load-bearing**, in the same way `drawBadge`'s is: `imageSmoothingEnabled`/`Quality` and the clip are ctx state and would otherwise leak into the next annotation's `drawImage` — `drawImageAnnotation` sits in the same loop. Say so in the comment.
   - **Smoothing on** (user decision, and the recommendation): at the typical 2–4×, high-quality resampling reads as a real close-up for both photos and antialiased UI text, whereas nearest-neighbour reads as "broken/pixelated"; the app has no pixelate tool for which blockiness would be the point.
   - We compute the clamp ourselves rather than relying on the spec's proportional clipping of an out-of-range source rect, because out-of-range/zero-area source rects have historically behaved differently across engines and we ship on WebView2, WKWebView and mobile Safari. It is ~10 lines of pure rect math with a vitest around it. The clamp stays correct under the circular clip because both squares share the same uniform `zoom` mapping, so clipping the source square and mapping the same fraction of the destination square lines the pixels up exactly.

4. **Lens border last**, over the clipped content so the stroke isn't half-clipped: `arc(at, radius)`, `OUTLINE` at `strokeWidth + 4`, then `a.color` at `strokeWidth`.

There are no corner-radius constants — the circle removes them.

**Z-order / what is sampled.** The loupe samples **`doc.imageBitmap` only** — never other annotations, never `ctx.canvas`. Sampling the canvas would make the result depend on draw order, differ between the live canvas (which also has a draft in flight) and the export, and create paradoxes with two loupes pointing at each other. So an arrow drawn over the detail does **not** appear magnified inside the lens; a user who wants that annotates inside the lens. Otherwise the magnifier is an ordinary list member: a later annotation paints over it, an earlier one under it. A lens overlapping its own source region is legal (nothing is clamped in this app) but suppresses the connector.

**Selection chrome (live canvas only, never exported):** the marquee around the lens's padded bounding square, the lens's 4 square corner handles, the source circle's 2 round handles, and a small `"2.4×"` zoom readout beside the source ring. All inside `drawSelectionOverlay`, which `exporter.ts` cannot reach.

### 3. The `renderAnnotations` seam — confirmed, with one amendment

```ts
export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  list: Annotation[],
  images: ReadonlyMap<string, ImageBitmap>,
  background: ImageBitmap | null,   // 4th param, REQUIRED (no default)
): void;
```

Confirmed. Amendment: name it **`background`**, not `source` — `source` collides conceptually with `MagnifierAnnotation.from`/`magnifierSourceRect` and with `drawImage`'s own source rectangle. Required (not optional) so TypeScript forces both call sites to be updated in the same commit: `canvas.ts` `render()` (two calls — the list and the draft) passes `this.doc.imageBitmap`; `exporter.ts:13` passes `doc.imageBitmap` (non-null past its own guard). `drawOne` takes the same parameter.

Rejected in one line each: passing the whole `Doc` (widens a deliberately narrow pure contract and invites recursive access to `annotations`); bundling `{images, background}` into an options object (larger diff, no benefit today); pre-baking source crops into `Doc.images` (goes stale on crop/undo and re-imports the monotonic-cache wart).

Import boundary stays legal: `exporter → render → {bounds, rotate, magnifier} → model`. `magnifier.ts` is a pure geometry leaf with no chrome knowledge, so it is a safe addition to that graph, exactly like `bounds.ts`/`rotate.ts`. It must never import `hittest`/`resize`/`crop`.

### 4. UI & interaction

**Toolbar button.** `<button data-tool="magnifier" class="tool" title="Magnifier (M)">`, placed **after `badge`, before `#insert-image`** — last of the draw tools, ahead of the insert/color/size group. It needs **no `app.ts` change**: the generic `button.tool` loop and `onToolChanged` pick it up. Note for the implementer: the `(M)` in the tooltip follows the existing convention, but single-letter tool shortcuts are **not implemented anywhere today** (A/R/T/H/N/V/C are all cosmetic) — do not go looking for a key handler and do not invent one.

**Icon (18×18, `viewBox="0 0 24 24"`, `fill="none" stroke="currentColor" stroke-width="2"`, round caps/joins)** — two circles of clearly different size joined by a short diagonal bridge, i.e. the feature's own geometry at icon scale:

```svg
<circle cx="6" cy="17.5" r="3.5" />
<circle cx="15.5" cy="8.5" r="6" />
<line x1="8.5" y1="15" x2="11.3" y2="12.7" />
```

The bridge sits *between* the two circles and never protrudes outward, which is what keeps it from reading as a magnifying glass with a stem (i.e. "zoom the editor viewport" — a feature the app does not have and might later want). If review still finds it ambiguous at 18 px, replace the single bridge with the two external-tangent lines (the artifact's real geometry); that is unmistakable but busier, so it is the fallback, not the default.

**Creation gesture — one flow, mouse and touch: a radial drag over the detail.**

`pointerdown` places the **source center**, `pointermove` grows the **source radius** (`hypot(p − downPoint)`), `pointerup` commits — the badge tool's radial idiom (`applyBadgeResize` already uses exactly this "distance from a fixed center" formula), and structurally the rect tool's draft/commit template, so the code path is already there. Because the draft is a real `MagnifierAnnotation` rendered through `renderAnnotations`, the user sees the **magnified content live while dragging**. The lens is derived and auto-placed on every frame:

`deriveLensSizeForSource(sourceRadius, sizeName, canvasSize)` (post-review rename: this step never used `from` — the four steps below depend only on `sourceRadius`/`size`/`canvasSize` — so the parameter was dropped and the function renamed to stop implying it derives placement too; placement is `placeLens`, below):

1. `targetRadius = min(MAGNIFIER_LENS_FRACTION_PRESETS[size] × canvasLongSide / 2, 0.45 × canvasShortSide)` — the second term is the insert-image 90 %-of-canvas precedent, expressed as a radius.
2. `zoom = clamp(targetRadius / sourceRadius, MIN_MAGNIFIER_ZOOM, MAX_MAGNIFIER_ZOOM)`
3. `radius = sourceRadius × zoom`
4. `radius = clamp(radius, MIN_MAGNIFIER_RADIUS, 0.45 × canvasShortSide)`; if that clamp bit, re-derive `zoom = clamp(radius / sourceRadius, MIN, MAX)` **once** and accept the pair.

Recomputing the dependent value from the clamped one is the discipline `applyTextResize` already documents ("the effective scale is recomputed from the clamped value"). Two passes, deterministic, unit-testable.

`placeLens(from, sourceRadius, lensRadius, canvasSize, gap)`: candidate centers at `from + dir × (sourceRadius + gap + lensRadius)` for `dir` in the fixed order **E, W, S, N, SE, SW, NE, NW**. Take the first candidate whose lens circle lies fully inside the canvas (`cx − R ≥ 0`, `cx + R ≤ W`, likewise y). If none fits, take the candidate whose center, after component-wise clamping into `[R, W−R] × [R, H−R]`, is farthest from `from` (least overlap with the source) — allowing overlap is legal, nothing is ever refused. Cardinals before diagonals because a side-by-side loupe reads more clearly than a diagonal one; the fixed order keeps the result predictable rather than "cleverest".

A two-step *place-source-then-place-lens* flow is rejected: it doubles the taps, introduces a modal in-between state that needs its own cancel affordance on touch, and cannot show live magnified content during step one.

**Tap (drag shorter than `MAGNIFIER_TAP_SLOP_PX × cropScale()`) creates a default loupe** rather than being discarded: `sourceRadius = MAGNIFIER_TAP_SOURCE_RADIUS_FRACTION × canvasShortSide`, centered on the pointer-down point, same derivation and auto-placement. Precise dragging is the hardest gesture on a phone, and the badge tool already establishes single-tap-commits in this app. The slop threshold **must** be CSS-px-based and scale-compensated (`× cropScale()`, like `DOUBLE_TAP_SLOP_PX`): a fixed bitmap-px threshold would turn a 2-CSS-px sloppy tap on a 4000 px photo into a "drag" producing a useless few-pixel source circle.

**Selection behaviour.** Hit-test (`hitsAnnotation`): the lens as a **filled circle** — `hypot(p − at) ≤ radius + tolerance`, the auto-badge precedent verbatim — **or** the source circle's **ring band**, `|hypot(p − from) − sourceRadius| ≤ tolerance + sourceStroke/2` (a new `nearCircleOutline` helper mirroring the existing `nearRectOutline`; the ring is hollow, so its interior must not swallow clicks meant for what is underneath).

| Gesture | Effect | Fields changed |
| --- | --- | --- |
| Drag the lens body | Moves **the lens only** | `at` |
| Drag a lens corner handle (4, square, on the bounding square) | Resizes the lens at **fixed zoom** (see more/less of the image at the same magnification), center pinned | `radius` |
| Drag `src-move` (round handle at `from`) | Moves the source region | `from` |
| Drag `src-zoom` (round handle at 45° SE on the source rim) | Changes **zoom** at fixed lens radius: a smaller source ring = more magnification, center pinned | `zoom` |

This is the one orthogonal assignment: every degree of freedom (lens position, lens size, source position, zoom) has exactly one control, and every control has exactly one meaning. Body-drag moving **the lens only** is the important call — grabbing a magnified disc and dragging it must *not* silently change what is magnified, which is the one thing the user wants stable. Implementation: extend `translateAnnotation(a, dx, dy, part: "all" | "lens" = "all")`; only the magnifier case reads `part`, and the default keeps all three existing call sites (crop, resize re-anchor, text re-anchor — all rigid, both points move) byte-identical. `canvas.ts`'s move branch is the only caller passing `"lens"`.

Handle details:

- The lens reuses the existing `cornerHandles(bounds)` layout and the existing `"nw"|"ne"|"sw"|"se"` ids on its bounding square — the corners sit just outside the circle on the diagonals, reading as a "resize disc" affordance exactly as they already do for badges. **No new ids for the lens.** Its transform is `applyBadgeResize`'s math: `radius = clamp(max(|p.x − at.x|, |p.y − at.y|), lo, MAX_MAGNIFIER_RADIUS)` with `lo = max(MIN_MAGNIFIER_RADIUS, zoom × MIN_MAGNIFIER_SOURCE_RADIUS_PX)` — that one expression is what keeps the derived source circle above the sample floor as the lens shrinks. `at` and `zoom` never change.
- Only two new `ResizeHandle` ids: `"src-move"` (`pos = from`) and `"src-zoom"` (`pos = from + sourceRadius × (cos 45°, sin 45°)`). Both drawn as **circles** (accent fill + white ring) via a new optional `HandleSpec.shape?: "square" | "circle"`, so the two families are unmistakable. `src-move` is listed first in `resizeHandlesFor` so it wins exact ties in `nearestHandle`.
- `src-move` sets `from = pointer` (handle drags snap to the pointer everywhere else in this app; under a finger the jump is invisible). `src-zoom` sets `zoom = clamp(radius / max(hypot(p − from), ε), MIN_MAGNIFIER_ZOOM, min(MAX_MAGNIFIER_ZOOM, radius / MIN_MAGNIFIER_SOURCE_RADIUS_PX))` — a single scalar radial drag; `hypot = 0` yields `Infinity`, which the clamp absorbs with no special case.
- `anchorPointFor` returns `{x: a.at.x, y: a.at.y}` for **every** magnifier handle: the lens center is invariant under all four gestures. (It is only ever consulted when `angle !== 0`, which the UI can never produce for a magnifier — the badge/highlight precedent for "not really applicable".)
- `cursorForResizeHandle` (exhaustive) gains `"src-move" → "move"` and `"src-zoom" → "nwse-resize"`. The lens corners already map through the existing box cases.

The **zoom readout** (`"2.4×"`, one decimal, trailing `.0` trimmed) is drawn beside the source ring in `drawSelectionOverlay` only — selection chrome, never exported. It is the answer to "what magnification am I at" now that no numeric control exists.

**Degenerate / edge cases.**

1. Tiny drag → tap-to-create default loupe (above), never discarded.
2. Source region near or over the image edge → allowed, never clamped (consistent with move/crop). The sample square is clamped at draw time and the destination clipped proportionally, so the lens shows the in-bounds slice.
3. Auto-placement collides with the image edge → `placeLens`'s eight-candidate order, then the farthest-after-clamp fallback; it never fails.
4. Derived lens larger than the canvas → capped at `0.45 × canvasShortSide`, zoom re-derived once from the capped radius.
5. Very high zoom → `MAX_MAGNIFIER_ZOOM` plus the `MIN_MAGNIFIER_SOURCE_RADIUS_PX` floor (both expressed through `clampZoom`) bound the source circle's collapse; the lens-resize `lo` expression enforces the same floor from the other direction.
6. Lens overlaps (or nearly touches) its own source → legal; connector suppressed by the single distance guard.
7. No background bitmap → content fill skipped, rings and connector still drawn.
8. Crop leaves the source fully outside → empty lens, rings and connector still drawn, one undo restores.

**Accepted limitation (document it, don't fight it):** on a phone showing a 4000 px photo at ~300 CSS px, a small source circle is only a few CSS px on screen and its two round handles crowd each other. This is the same resolution-vs-screen tension `docScale`/`ANNOTATION_SCALE_BASELINE` already manage, it does not affect the exported image (where the ring is at bitmap resolution), and the generous touch hit radius (`HANDLE_HIT_PX × TOUCH_HIT_MULTIPLIER × cropScale()`) plus nearest-wins arbitration with `src-move` winning ties keep it usable in the common cases.

**Cross-platform:** pure `src/`. 9-arg `drawImage`, `arc`, `clip` and `imageSmoothingQuality` are all supported in WebView2, WKWebView and mobile Safari 15+. Nothing here blocks the macOS port; there is no platform branch.

**Performance:** one extra `drawImage` per loupe per frame during a drag, on top of the full-background redraw `render()` already does every frame. Acceptable; if profiling ever shows jank on a 4000 px photo at high zoom, an offscreen cache keyed by `{from, zoom, radius}` is a later, purely local optimization.

## Alternatives considered

- **Rounded-rectangle inset** — the architect's original recommendation (preserves rectangular detail, more inset area on a portrait screen, reuses box-resize machinery); **overridden by the user in favour of the circular lens metaphor**. It can return later as an optional `shape?: "circle" | "rect"` field: purely additive (`width`/`height` as optional fields alongside `radius`, with the source aspect following the lens aspect), no migration, because `at` is already a center.
- **Marking the sampled square instead of the source circle** — rejected: the square's corners are clipped away and never appear in the lens, so drawing it over-claims what the loupe shows; it would also force an ugly circle↔rect connector.
- **Source authoritative (lens derived)** — rejected: the lens is what the user frames and drags; deriving it would fight the badge-shaped resize machinery and make "resize the lens at constant zoom" unexpressible.
- **Both circles stored explicitly** — rejected: a redundant representation of one fact, needing an invariant enforced in several places.
- **Pre-baked source crops in `Doc.images`** — rejected: goes stale on crop/undo, adds pixel storage and re-imports the monotonic-cache wart.
- **Sampling the composited canvas instead of `doc.imageBitmap`** — rejected: makes output depend on draw order, diverges between the live canvas (draft in flight) and the export, and creates loupe-pointing-at-loupe paradoxes.
- **Connector as selection chrome only** — rejected: the connector *is* the statement "this lens comes from there"; without it the exported PNG shows a mysterious floating disc.
- **`boundsOf` returning the union of lens + source** — rejected: gives a huge marquee, a meaningless pivot, and handle positions nobody wants.
- **Two-step place-source-then-place-lens creation** — rejected: doubles the taps, adds a modal state needing its own cancel, no live preview.
- **A magnifier options bar (badgebar-style) for zoom** — rejected for v1: the `src-zoom` rim handle expresses zoom natively and costs no new UI surface.
- **Nearest-neighbour interpolation** — rejected by the user decision and by the recommendation: it reads as broken at 3× on a photo; the app has no pixelate tool for which blockiness is the point.

## IPC / API contract

**No IPC changes.** This is a pure `src/` feature: no Rust, no new Tauri command, no new capability. `docs/ARCHITECTURE.md`'s IPC table is unaffected — extend its existing "the selection tool … is a pure `src/` feature and introduces no IPC changes" paragraph to name the magnifier, so the reviewer's IPC-drift check has something to match.

The real contract is internal and cross-module:

| Surface | Signature | Consumers |
| --- | --- | --- |
| `render.ts` | `renderAnnotations(ctx, list, images, background: ImageBitmap \| null)` — 4th param **required** | `canvas.ts` (×2: list + draft), `exporter.ts` |
| `model.ts` | `translateAnnotation(a, dx, dy, part: "all" \| "lens" = "all")` | `canvas.ts` move branch passes `"lens"`; crop / resize re-anchor / text re-anchor keep the default |
| `resize.ts` | `ResizeHandle` += `"src-move" \| "src-zoom"`; `HandleSpec.shape?: "square" \| "circle"` | `canvas.ts` chrome + cursors |
| `magnifier.ts` (new leaf) | `magnifierSourceRadius(a): number`; `magnifierSourceRect(a): Bounds`; `magnifierLensRect(a): Bounds`; `clampSampleRect(src, bmpW, bmpH, dest): {src: Bounds, dest: Bounds} \| null`; `connectorTangents(c1, r1, c2, r2): [Segment, Segment] \| null`; `placeLens(from, srcR, lensR, canvas, gap): Point`; `deriveLensSizeForSource(srcR, size, canvas): {radius, zoom}` (post-review rename/signature narrowing — see the Creation gesture section above); `clampZoom(z, a): number` | `render`, `hittest`, `resize`, `canvas` |
| `bounds.ts` | `boundsOf` magnifier case = the **lens circle's bounding square** | all |
| `hittest.ts` | new private `nearCircleOutline(p, center, r, tol)` | `hitsAnnotation` |

Import boundary (must hold): `exporter → render → {bounds, rotate, magnifier} → model`. `magnifier.ts` must not import `hittest`/`resize`/`crop`.

## Implementation tasks

Hand these to `implementer` one at a time, in order. Tasks 1–7 keep the tree compiling at every step.

1. **Model** (`src/editor/model.ts`): add `MagnifierAnnotation`, `"magnifier"` to `ToolKind`, the union member, `MAGNIFIER_LENS_FRACTION_PRESETS`, and the `part: "all" | "lens" = "all"` parameter on `translateAnnotation` (magnifier is the only kind that reads it). Extend `src/editor/model.test.ts`: rigid translate moves both `from` and `at`; `"lens"` moves only `at`; existing call sites unchanged.
2. **New pure leaf** (`src/editor/magnifier.ts`) with all eight functions and the geometry constants above, plus `src/editor/magnifier.test.ts`: source radius/rect derivation; `clampSampleRect` for fully-inside / partly-outside / fully-outside / zero-area; `connectorTangents` — both endpoints lie on their own circles, each segment is perpendicular to its normal, the two segments are distinct, and `null` for overlapping / touching / contained / coincident-center configurations; `placeLens`'s eight-candidate order and the farthest-after-clamp fallback; `deriveLensSizeForSource`'s two-pass clamping; `clampZoom` bounds including the `MIN_MAGNIFIER_SOURCE_RADIUS_PX` floor.
3. **Bounds** (`src/editor/bounds.ts`): the `"magnifier"` case returning the lens circle's bounding square, with the "satellite source circle, see `magnifierSourceRadius`" doc comment. Extend `bounds.test.ts`.
4. **Render seam + drawing** (`src/editor/render.ts`, `src/editor/canvas.ts:453-454`, `src/editor/exporter.ts:13`): thread the required `background` param through `renderAnnotations`/`drawOne` and update both call sites in the same task; implement `drawMagnifier` in the four-step order (connector → source ring → clipped smoothed content → lens border), with the load-bearing `save`/`restore` comment about the clip and `imageSmoothingEnabled` leaking into `drawImageAnnotation`, the "never sample `ctx.canvas`" note, and the group-rotation hazard note.
5. **Hit-testing** (`src/editor/hittest.ts`): magnifier = filled lens circle `||` source ring band; add the `nearCircleOutline` helper. Extend `hittest.test.ts` (lens interior hits; source-ring interior does **not**; the ring itself does).
6. **Resize** (`src/editor/resize.ts`): the two new `ResizeHandle` ids and `HandleSpec.shape`; `MIN_MAGNIFIER_RADIUS`/`MAX_MAGNIFIER_RADIUS`/`MAGNIFIER_ZOOM_HANDLE_ANGLE`; `resizeHandlesFor` → `cornerHandles(bounds)` (square) + `src-move` (circle, first) + `src-zoom` (circle, on the rim at 45°); `applyResize` → the badge-style center-pinned radius formula with the `lo = max(MIN_MAGNIFIER_RADIUS, zoom × MIN_MAGNIFIER_SOURCE_RADIUS_PX)` floor for lens corners, `from = pointer` for `src-move`, and the `radius / hypot` + `clampZoom` formula for `src-zoom`; `anchorPointFor` → `a.at` for every magnifier handle. Add the `canRotate` exemption comment in `rotate.ts` (no code change). Extend `resize.test.ts`.
7. **Creation flow** (`src/editor/canvas.ts`): `onDown`/`onMove`/`onUp` for `tool === "magnifier"` — radial draft (down = source center, move = source radius) rebuilt each frame via `deriveLensSizeForSource` + `placeLens` so the preview is live; `MAGNIFIER_TAP_SLOP_PX × cropScale()` tap fallback producing the default source radius; commit through the existing `commit()`. `base.strokeWidth` already carries `docScale`.
8. **Selection & chrome** (`src/editor/canvas.ts`): pass `"lens"` from the move branch's `translateAnnotation`; draw circle-vs-square handles per `HandleSpec.shape` in `drawSelectionOverlay`; draw the `"2.4×"` zoom readout beside the source ring (selection chrome only); add the two `cursorForResizeHandle` cases.
9. **Toolbar** (`index.html` **and** `pwa/index.html` — the blocks must stay byte-identical): the new `data-tool="magnifier"` button with the two-circle icon, after `badge` and before `#insert-image`. Confirm no `app.ts` change is needed.
10. **E2E** (`tests/e2e/magnifier.spec.ts`, iPhone viewport, modelled on `tests/e2e/rotate.spec.ts`): inline a new fixture — a 120×90 **white** PNG with a 10×10 **black** square at (20,20) — as base64 (no fixture file, no new dependency). Then: pick the magnifier tool; radial-drag from the black square's center (25,25) outward ~8 bitmap px; assert `pixelAt(lensCenter)` is black. *(The lens center always maps exactly to `from`, so this assertion is zoom-independent and placement-independent — read the committed annotation's `at` through `page.evaluate` or derive it from `placeLens`'s documented E-first order.)* Then select the loupe, drag the lens body ~20 CSS px, and assert the **new** lens center is still black while the **old** lens center has reverted to white — proof that body-drag moves `at` and not `from`. Finish with `#undo` restoring the pre-loupe pixels.
11. **Docs**: this design note at `docs/design/2026-08-01-magnifier-loupe.md`; a new "Magnifier (loupe)" section in `docs/ARCHITECTURE.md` covering the data model + derived-source rule, the circle-not-square marker rationale, the `background` seam change, the live-sampling rule, crop behaviour, and the handle-assignment table; add the magnifier row to the `canRotate` table with the `drawImage`-source-rect rationale; add `magnifier.ts` to the documented `exporter.ts` import-boundary graph; extend the "pure `src/`, no IPC changes" paragraph.

The parent session should create the corresponding backlog task with the `backlog` CLI (carrying these as acceptance criteria) before task 1, since acceptance criteria are regression contracts here.
