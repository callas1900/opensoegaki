# Addendum A — touch-first creation gesture (round 2, real-iPhone feedback)

Superseded in part by Addendum B: [./2026-08-02-magnifier-connector-and-size-limits.md](./2026-08-02-magnifier-connector-and-size-limits.md) — connector simplified to one segment, and lens/source size clamps replaced with operability-based limits.

Partially overridden by Addendum C: [./2026-08-02a-magnifier-tapered-connector.md](./2026-08-02a-magnifier-tapered-connector.md) — connector widened and tapered toward the lens after real-iPhone feedback.

*Date: 2026-08-01 · Status: agreed, ready for implementation · Delta to `docs/design/2026-08-01-magnifier-loupe.md`.*

## Feedback being answered

1. *"When placing a loupe I want to slide it to the right spot and release to confirm — but dragging changes the magnification/size, which is painful."* The radial creation drag (down = source center, drag distance = source radius) makes every finger movement a zoom change, and the finger sits on top of the very detail being magnified.
2. *"Having to go magnifier → select every time is tedious."* The committed loupe is not auto-selected, so all four adjustment handles require a manual tool round-trip.

Both are creation/adjustment ergonomics. **Nothing in the data model, the render path, the handle model, or the export path changes.**

## Revised gesture — slide to aim, release to confirm

**The insight that drives this:** the finger occludes the source region, but it never occludes the **lens** — `placeLens` deliberately offsets the lens by `sourceRadius + gap + lensRadius`. The lens is already a live magnified readout of whatever is under the finger. So the correct touch gesture is *aim with the finger, read the lens*: the lens becomes the viewfinder, and occlusion stops being a problem and becomes the point.

| Phase | Behaviour |
| --- | --- |
| `pointerdown` | Plant the source circle at `p` with the **default source radius**; derive `{radius, zoom}` once via `deriveLensSizeForSource`; place the lens once via `placeLens`; **freeze** `offset = at − from`, `radius`, `zoom` for the whole gesture. |
| `pointermove` | `from = p`; `at = clampLensCenter(p + offset, radius, canvasSize)`. **`radius` and `zoom` never change.** The lens rides alongside the finger at a constant offset, showing live magnified content. |
| `pointerup` | Commit unconditionally, then auto-select the new loupe and switch to the select tool. |

Consequences and the reasoning behind each:

- **Size/zoom is no longer set during creation.** It comes from the S/M/L preset (already the design's rule) and is adjusted afterwards with the lens corner handles and the `src-zoom` rim handle — where the user can *see* the result instead of predicting it. This is the whole fix for pain 1.
- **The lens placement is frozen at pointerdown, not recomputed per frame.** Re-running `placeLens` every frame would make the lens flip sides (E→W) mid-slide as the source approaches a canvas edge — jarring, and it would move the thing the user is reading. A constant offset plus a canvas clamp is predictable and matches this file's established "recompute from a fixed base, never incrementally" anti-drift discipline (`move`/`resize`/`rotateDrag` all do it). If a long slide pushes the frozen offset against an edge, the clamp keeps the lens fully on-canvas and possibly close to the source; the user fixes that in one drag, which is now immediately available.
- **Tap-to-create is preserved as the zero-length case of the same gesture** — no branch, no threshold, no separate code path. A tap and a slide differ only in where `from` ends up.
- **There is no in-gesture cancel.** Release always commits; `Ctrl+Z`/`#undo` is the safety net, consistent with `clearDocument`'s stated stance ("no confirmation dialog — undo is the safety net").

### Deliberate deviation: the tap-slop test is deleted, not kept

The revised gesture has **no tap-vs-drag branch at all**, so `isMagnifierTapTravel`, `buildTapMagnifier` and `MAGNIFIER_TAP_SLOP_PX` have no consumers left. Keeping a threshold with no decision behind it would be dead code and a future reader's trap — the project's own rule from the TASK-38 regression is that the loser gets **deleted, not left as a fallback**. The constraint's intent (never two competing thresholds) is satisfied more strongly by having zero. Delete all three; the source-radius fraction survives, renamed, as the *only* creation radius.

### Default source radius: switch from short-side to long-side-based

Now that the drag no longer sets the source radius, the default is the sole determinant of creation zoom, so its definition matters much more than it did:

```ts
export function defaultSourceRadius(canvasSize: {w, h}): number {
  return Math.min(0.06 * longSide, 0.15 * shortSide);
}
```

With today's `0.06 × shortSide`, zoom = `8.33 × preset × (long/short)` — it swings from 3.3× on a 4:3 photo to 5.4× on a phone screenshot, for the same "M". With the long-side term governing (which it does for every aspect up to 2.5:1), the presets collapse to a **constant, aspect-independent zoom**:

| Preset | Lens diameter | Creation zoom |
| --- | --- | --- |
| S (0.22) | 22 % of long side | **≈ 1.8×** |
| M (0.30) | 30 % of long side | **≈ 2.5×** |
| L (0.40) | 40 % of long side | **≈ 3.3×** |

The `0.15 × shortSide` term is a guard for extreme panoramas (beyond 2.5:1), where a long-side-derived source circle would be nearly as tall as the image; past that point `deriveLensSizeForSource`'s existing `0.45 × shortSide` cap and two-pass re-derivation take over unchanged. Predictable zoom numbers matter more now that S/M/L is the only creation-time size control and the zoom readout is the user's feedback.

## Adjustment: auto-select and switch to the select tool on commit

On commit the new loupe becomes **selected**, and the active tool becomes **select**.

Rationale:

- It is exactly the tedium the user described, removed: after release, all four handles (lens corners, `src-move`, `src-zoom`), the lens body drag and the floating delete button are live with zero extra taps.
- **There is a precedent in this codebase for a compound tool handing off to select on completion:** `applyCrop()`/`cancelCrop()` both exit via `setTool("select")` (TASK-40). The magnifier is the other compound tool.
- The switch is **visible**, not a hidden mode change: `onToolChanged` moves the toolbar's `.active` highlight, and the cursor becomes `default`. Nothing about the app's state is silently different from what the toolbar shows.
- Multi-loupe workflows cost exactly **one extra tap** (re-tap the magnifier button, which also clears the selection via `setTool`). That is strictly better than today, where *every* loupe costs a magnifier→select→magnifier round trip; the extra tap now lands only on the rarer branch.

Rejected alternatives:

- **Auto-select but stay on the magnifier tool** — the handles would be *drawn* while `onDown`'s handle arbitration stays gated on `tool === "select"`, i.e. chrome that lies. Making them live means importing select-tool behaviour into a draw tool.
- **Tool-local move: a magnifier-tool drag starting on an existing lens moves it** — rejected. With auto-switch you are already in select immediately after creating, which is when ~all adjustment happens, so it buys almost nothing; and it is genuinely ambiguous, because "magnify this spot, which happens to lie inside an existing loupe" is a legitimate intent and a lens is a large target, so it would frequently steal creation presses. Keep the tool model honest: draw tools create, the select tool edits.

### Documented-invariant carve-out

`docs/ARCHITECTURE.md` currently states: *"New annotations are not auto-selected after drawing."* This revision makes the magnifier the one exception. No Done task's acceptance criteria restate that sentence (it appears only in ARCHITECTURE.md and the historical `docs/design/2026-07-14-selection-and-size-controls.md`), so there is no AC conflict — this is a living-doc amendment. Amend the ARCHITECTURE sentence to name the exception and its reason (a compound object whose two halves almost always need adjusting immediately); leave the 2026-07-14 note as the dated historical record.

## Exact `canvas.ts` behaviour changes

1. **New gesture state**, mirroring `move`/`resize`/`rotateDrag`:
   ```ts
   private magnifierPlace: { offset: Point; radius: number; zoom: number } | null = null;
   ```
   Storing `radius`/`zoom` here (not just reading them off the draft) is what makes "sizing cannot change mid-gesture" structural rather than a rule. Null it alongside `move`/`resize`/`rotateDrag` in `setBackground`/`restore`/`clearDocument`/`applyCrop`, and in `onUp`.

2. **`onDown`, magnifier branch**:
   ```ts
   const from = p;
   const { at, radius, zoom } = this.magnifierGeometry(from, defaultSourceRadius(canvasSize));
   this.magnifierPlace = { offset: { x: at.x - from.x, y: at.y - from.y }, radius, zoom };
   this.draft = { ...base, kind: "magnifier", from, at, radius, zoom };
   ```

3. **`onMove`, magnifier draft branch**:
   ```ts
   const { from, at } = magnifierSlideUpdate(p, this.magnifierPlace!, canvasSize);
   this.draft.from = from;
   this.draft.at = at;
   // radius / zoom deliberately untouched
   ```

4. **`onUp`, magnifier branch** — commit unconditionally, then hand off. **Ordering is load-bearing:** `setTool()` calls `clearSelection()`, so selecting before the switch is a silent no-op.
   ```ts
   this.magnifierPlace = null;
   this.commit(d);
   this.setTool("select");   // clears selection, sets cursor, moves the toolbar highlight, renders
   this.selectedId = d.id;   // MUST come after setTool
   this.render();
   return;
   ```

5. **Delete** `isMagnifierTapTravel`, `buildTapMagnifier`, `magnifierTapSourceRadius` and dead imports; import `defaultSourceRadius` and `magnifierSlideUpdate`. `magnifierGeometry` stays as-is, now called only from `onDown`.

New pure exports in `src/editor/magnifier.ts`:

```ts
export function defaultSourceRadius(canvasSize: {w: number; h: number}): number;
export function clampLensCenter(center: Point, radius: number, canvasSize: {w: number; h: number}): Point;
export function magnifierSlideUpdate(
  p: Point,
  frozen: { offset: Point; radius: number; zoom: number },
  canvasSize: { w: number; h: number },
): { from: Point; at: Point };
```

`placeLens` must be refactored to call `clampLensCenter` so there is one owner of "keep the lens fully on canvas". `magnifierSlideUpdate` returning only `{from, at}` is deliberate: radius and zoom **cannot** change during a slide by construction, and that is unit-testable.

## Amendment (review round 2) — clamp `from` during the slide

Round-2 implementation review flagged that `magnifierSlideUpdate` let `from`
(the source center) follow the raw pointer with no bound, while every other
annotation move/translate in this codebase is deliberately unclamped ("never
clamp annotations" — crop/move can push a shape off-canvas and that is
accepted, reversible behavior). The architect ruled: **clamp `from` to the
bitmap during the slide-to-aim creation gesture specifically**, via a new
named helper:

```ts
export function clampPointToCanvas(p: Point, canvasSize: {w: number; h: number}): Point;
```

`magnifierSlideUpdate` now computes `from = clampPointToCanvas(p,
canvasSize)` first, then derives `at = clampLensCenter(from + offset, ...)`
from that *clamped* `from` — not from the raw pointer.

**Rationale.** The "never clamp annotations" policy exists to preserve data
on an *existing* annotation: nothing is lost by letting a committed shape
sit partly off-canvas, and clamping it on every subsequent move would
silently fight the user's own positioning. A *creation* gesture is a
different situation: its entire job is to produce a visible, usable loupe.
A source circle planted fully off-bitmap samples nothing —
`clampSampleRect` returns `null` and the lens renders provably empty — a
dead, unrecoverable result rather than merely an inconvenient one. Clamping
`from` during the slide rules out that dead end while still leaving every
useful framing reachable: a source near (but not past) the bitmap edge
still overlaps it and samples the in-bounds slice via `clampSampleRect`,
exactly as crop's own partial-overlap case already does — corner and edge
framings are not lost, only the fully-off-canvas case is excluded.

**This does not reopen "never clamp annotations" for the general case.**
Once a magnifier is committed, its `src-move` handle (an edit of an
existing, undoable annotation, driven by the user directly, not a creation
gesture) sets `from = pointer` **unclamped**, deliberately — the general
policy applies there unchanged. If `src-move` is ever revisited to clamp
too, it should reuse `clampPointToCanvas` rather than re-deriving the same
clamp independently.

Also fixed in this round: two `canvas.ts` gesture-lifetime bugs unrelated to
the clamp ruling itself — `this.draft` was never reset alongside `move`/
`resize`/`rotateDrag`/`magnifierPlace` in `setBackground`/`restore`/
`clearDocument`/`applyCrop` (a mid-drag document reset could throw on the
next pointermove, or commit a phantom shape into the reset document — a
latent bug shared by arrow/rect/highlight, not just the magnifier), and
`magnifierPlace`'s reset in `onUp` was moved from inside the magnifier
commit branch to the shared gesture-end choke point next to `this.draft =
null`, so its lifetime is "one gesture" rather than "one branch."
