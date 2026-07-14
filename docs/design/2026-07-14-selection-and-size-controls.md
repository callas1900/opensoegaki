# Design note — Selection tool & size controls (TASK-8, TASK-9)

Author: architect agent, 2026-07-14. Status: agreed, ready for implementation.

## Overview

Two independent frontend-only features that make placed annotations editable and give the
user size control before drawing:

- **TASK-8** — a `select` tool: hit-test the object model, move the hit annotation by drag,
  delete it with `Del`. Both move and delete are single undo steps.
- **TASK-9** — an S/M/L size control in the toolbar that governs the stroke width
  (arrow/rect) and font size (text) of *new* annotations.

Both are pure `src/` work — no Rust, no new dependency, no IPC change. The load-bearing
constraint throughout is the **exporter-purity invariant**: `render.ts` is shared with
`exporter.ts`, so nothing selection-related may pass through `renderAnnotations`, or it
would be rasterized into exported PNGs. The design enforces this structurally (the exporter
never imports the selection/hit-test code).

The two tasks are decoupled and can be implemented in either order. TASK-8 is the larger chunk.

## Decisions

### 1. Selection state — where it lives, cardinality, lifecycle

- **Lives in `Editor` as `selectedId: string | null`.** Not in the model: selection is
  transient view/interaction state, not document data, and it must not be structuredCloned
  into history snapshots or rasterized on export.
- **Store the id, never the object reference.** `doc.annotations` is replaced wholesale on
  every mutation (draw/move/delete/undo/restore), and `history.cloneSnapshot` runs
  `structuredClone` on the array. An object reference would dangle after any undo/restore or
  move; an `id` survives cloning and array replacement. `selectedAnnotation()` resolves the
  id against the current array each render, and simply yields nothing if the id is gone — so
  a stale id is self-healing, never a crash.
- **Single-select only.** Matches both ACs and Skitch behavior; avoids marquee-select,
  multi-move, and set bookkeeping. Multi-select is a clean future extension
  (`selectedId` → `Set<string>`).
- **Cleared on:** tool switch (any → any), `setBackground` (new paste/capture), and
  `restore` (undo/redo, since the restored array may not contain the id and the highlight
  would be misleading). Cleared on `Escape` and on a click that hits nothing.

### 2. Hit-testing

- **New pure module `src/editor/hittest.ts`**, alongside `render.ts`. It is format-agnostic
  geometry (a future `.scrawl` loader or SVG exporter can reuse `boundsOf`/`hitTest`).
  **The exporter must never import it** — that is the mechanical guarantee selection cannot
  leak into PNGs.
- **Per-shape algorithms:**
  - **arrow** — distance from point to the segment `from→to`; hit when
    `dist ≤ tol + strokeWidth/2`. Arrowhead ignored for hit (the shaft covers the clickable
    intent).
  - **rect** — **edge-band, not filled interior.** Rects render as outlines, so clicking the
    hollow center must *not* select the rect (otherwise a large rect would swallow clicks
    meant for shapes inside it). Hit when the point is within `tol + strokeWidth/2` of the
    perimeter: inside the outward-inflated bounds AND outside the inward-deflated bounds
    (degenerate thin rects fall back to filled).
  - **text** — filled measured bounding box (glyphs are filled area). Box = `at`, measured
    width via `ctx.measureText`, height `≈ fontSize * 1.2`, inflated by `tol`.
- **Font single-source.** `render.ts` currently hardcodes
  `bold ${fontSize}px system-ui, sans-serif`. Extract `fontString(fontSize)` and have both
  `drawText` and the text hit-test use it, so measurement always matches what was drawn.
  `hittest.ts` needs a measuring context; `canvas.ts` passes its own `ctx` (setting
  `ctx.font` to measure is harmless — `render()` reassigns font/stroke on every draw).
- **Z-order:** iterate `annotations` from last to first (topmost drawn = topmost hit) and
  return the first match.
- **Tolerance in bitmap pixels, scale-compensated at the call site.** The canvas is
  CSS-scaled, so `canvas.ts` computes `scale = canvas.width / rect.width` and passes
  `BASE_TOL_PX * scale` (≈6 screen px) as the absolute bitmap-px tolerance. `hittest.ts`
  stays pure and unit-agnostic; adds the shape's own `strokeWidth/2` internally so thick
  strokes are easier to grab.

### 3. Selection highlight rendering

- A **dashed rounded marquee** around `boundsOf(selected)`, no resize handles (out of scope
  — see §7).
- **Drawn as a private method on `Editor` (`drawSelectionOverlay`), not in `render.ts`.**
  Rationale: the strongest possible enforcement of the exporter-purity invariant is that the
  overlay code is *unreachable* from `exporter.ts`. The overlay reuses `boundsOf` from
  `hittest.ts`. It is called in `Editor.render()` after `renderAnnotations` and the draft,
  guarded by `selectedAnnotation()` returning non-null. Uses `ctx.setLineDash` (reset with
  `setLineDash([])` after) with a white + accent double stroke for contrast on any
  background.

### 4. Move-by-drag

State machine extension of `onDown/onMove/onUp`, branched by `tool`:

- **`onDown` (select tool):** `hitTest`. If hit → `selectedId = hit.id`; arm a pending move
  `this.move = { original: structuredClone(hit), anchor: p, moved: false }`; **do not push
  history yet**. If no hit → deselect (`selectedId = null`). Draw tools keep their existing
  draft path, now reading `this.strokeWidth`/`this.fontSize`.
- **`onMove` (move armed):** `delta = p − anchor`. On the *first* frame where `delta ≠ 0`,
  push history **once** (`this.move.moved` guard) — this captures the pre-move array before
  any change, honoring "push before mutate." Then rebuild the array from the **stored
  original** (not incrementally, to avoid drift):
  `annotations.map(a => a.id === selectedId ? translateAnnotation(this.move.original, dx, dy) : a)`
  and assign wholesale. `translateAnnotation` returns a fresh object, preserving
  replace-not-mutate.
- **`onUp`:** clear `this.move`. A pure click that never moved pushed no history entry — so
  selecting is *not* undoable (only move/delete are, per AC).
- **One undo step per completed drag** falls out of the single guarded `push`.

### 5. Delete

- Handled in `main.ts` keydown: `Delete` or `Backspace` → `editor.deleteSelected()`, which
  is undoable (`history.push(snapshot())` before the filter;
  `annotations = annotations.filter(a => a.id !== selectedId)`; clear `selectedId`; render).
- **Focus guard:** a new `isTypingTarget(el)` helper (input/textarea/`isContentEditable`)
  gates `Delete`/`Backspace`/`Escape` so a global handler never eats keys destined for a
  text field. `window.prompt` (current text tool) is synchronous and blocks the event loop,
  so it is already safe, but the guard future-proofs the planned inline text editor and
  stops stray `Backspace` from triggering history-back.

### 6. TASK-9 scope ruling

- **S/M/L presets apply to NEW annotations only** (exactly AC-1). **Live restyle of the
  selected annotation is ruled OUT** of both tasks. Rationale: it needs a second undoable
  mutation path *and* two-way toolbar sync (the size/color buttons would have to reflect the
  selected object's current values), which is real scope creep beyond either AC. It is a
  clean follow-up (`editor.restyleSelected`) once selection lands. Clicking a swatch/size
  while something is selected therefore only sets the defaults for the next annotation —
  unsurprising and non-conflicting.
- **One size control, not two.** A single S/M/L segmented control sets both `strokeWidth`
  and `fontSize` from index-aligned preset tables. Arrow/rect consume `strokeWidth`, text
  consumes `fontSize`; the user never sees two size widgets.
- **Presets live in `model.ts`** (data/config), editor holds mutable
  `strokeWidth`/`fontSize` fields (mirroring the existing `color` field). `DEFAULTS` stays
  as the initial values; `M` equals today's defaults for visual continuity.
- **Exact px values:**
  - `STROKE_PRESETS = { S: 3, M: 6, L: 12 }`
  - `FONT_PRESETS   = { S: 18, M: 28, L: 44 }`

### 7. Toolbar / UX

- **Select button** added as the first `.tool` (`data-tool="select"`, `title="Select (V)"`).
  **Default tool stays `arrow`** — the capture→annotate flow is draw-first; select is
  opt-in.
- **Cursor feedback** set by `setTool`: draw tools → `crosshair`; select tool → `default`,
  switching to `move` on hover over a hit annotation (cheap per-move hit-test), `grabbing`
  while dragging.
- **Deselect** on `Escape` and on click-empty (§1/§4).
- **New annotations are NOT auto-selected** after drawing — keeps MVP minimal and avoids an
  unexpected tool/mode flip after each draw.
- **No resize handles / endpoint editing** — explicitly out of TASK-8 scope (task is
  hit-test/move/delete). Move translates the whole shape; geometry editing is a separate
  future task and would build naturally on `boundsOf` + handle hit regions.

## IPC / API contract

**None.** Both tasks are pure `src/` features; the Rust boundary and the
`capture_fullscreen` / `prepare_drag_file` contract are untouched.

## Module-by-module change list

### `src/editor/model.ts` (data)
- `export type Tool = ToolKind | "select";` (keep `ToolKind` as the three annotation kinds —
  annotations must never have `kind: "select"`).
- `export type SizeName = "S" | "M" | "L";`
- `export const STROKE_PRESETS: Record<SizeName, number> = { S: 3, M: 6, L: 12 };`
- `export const FONT_PRESETS: Record<SizeName, number> = { S: 18, M: 28, L: 44 };`
- `export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation`
  — returns a new annotation with shifted `from/to` (arrow), `a/b` (rect), or `at` (text);
  pure, no mutation.

### `src/editor/render.ts` (pure rendering, shared with exporter)
- `export const FONT_STACK = "system-ui, sans-serif";`
- `export function fontString(fontSize: number): string` → `` `bold ${fontSize}px ${FONT_STACK}` ``.
- `drawText` uses `fontString(a.fontSize)`.
- **No selection/highlight code added here** (invariant).

### `src/editor/hittest.ts` (new — pure geometry, NOT imported by exporter)
- `export interface Bounds { x: number; y: number; w: number; h: number; }`
- `export function boundsOf(a: Annotation, measure: CanvasRenderingContext2D): Bounds`
- `export function hitTest(list: Annotation[], p: Point, measure: CanvasRenderingContext2D, tolerance: number): Annotation | null`
  — topmost-first.
- Private helpers: `distanceToSegment(p, v, w)`, `nearRectOutline(p, r, tol)`,
  `pointInBounds(p, b)`.
- Imports `fontString` from `render.ts` for text measurement.

### `src/editor/canvas.ts` (interaction)
- Type of `tool` widens to `Tool`; default stays `"arrow"`.
- New fields: `strokeWidth = DEFAULTS.strokeWidth`, `fontSize = DEFAULTS.fontSize`,
  `selectedId: string | null = null`,
  `private move: { original: Annotation; anchor: Point; moved: boolean } | null = null`.
- `onDown` branches on `tool === "select"` (select/arm-move vs draw); draw branch uses
  `this.strokeWidth`/`this.fontSize` instead of `DEFAULTS`.
- `onMove` handles armed move (translate from original, first-move history push) and
  select-tool hover cursor.
- `onUp` finalizes move (clears `this.move`).
- New methods: `setTool(t: Tool): void` (clears selection, sets cursor),
  `setSize(name: SizeName): void`, `deleteSelected(): void`, `clearSelection(): void`,
  `private selectedAnnotation(): Annotation | undefined`,
  `private drawSelectionOverlay(a: Annotation): void`.
- `render()` appends the overlay call after draft.
- `setBackground` and `restore` clear `selectedId`.
- Tolerance at call site: `hitTest(list, p, this.ctx, BASE_TOL_PX * scale)` with
  `scale = canvas.width / rect.width`.

### `src/main.ts` (UI wiring)
- Tool-button loop calls `editor.setTool(btn.dataset.tool as Tool)` (so switching clears
  selection + sets cursor) in addition to the active-class toggle.
- Wire `#sizes button[data-size]` → `editor.setSize(name)` + active-class toggle.
- keydown: add `Delete`/`Backspace` → `editor.deleteSelected()` and `Escape` →
  `editor.clearSelection()`, all gated by `isTypingTarget(e.target)`; add that helper.

### `index.html`
- Add select `.tool` button (first tool) with `data-tool="select"`.
- Add a `<div id="sizes">` segmented group with three `button[data-size="S|M|L"]`, `M`
  active by default, placed after the palette.

### `src/styles.css`
- Style `#sizes` to match toolbar buttons; `.active` uses the existing accent rule.

## Implementation tasks

### TASK-8 — Selection tool (hit-test, move, delete)

1. **model.ts:** add `Tool` type and `translateAnnotation(a, dx, dy)`. *Verify:*
   `pnpm check` passes; `translateAnnotation` returns a new object for each kind.
2. **render.ts:** extract `FONT_STACK` + `fontString`, use in `drawText`. *Verify:* exported
   PNG text looks identical to before; `pnpm check`.
3. **hittest.ts (new):** implement `Bounds`, `boundsOf`, `hitTest` (+ helpers), importing
   `fontString`. *Verify:* arrow near shaft hits, rect center misses / edge hits, text box
   hits; topmost-first order.
4. **canvas.ts — selection state & overlay:** add `selectedId`, `selectedAnnotation()`,
   `drawSelectionOverlay`, call in `render()`; clear selection in `setBackground`/`restore`;
   add `setTool`/`clearSelection` and cursor handling. *Verify:* selecting draws a marquee;
   export/copy PNG contains **no** marquee.
5. **canvas.ts — move & delete:** implement the `onDown/onMove/onUp` select branch with the
   single guarded `history.push`, move from stored original via `translateAnnotation`, and
   `deleteSelected()`. *Verify:* drag moves the shape; one Undo reverts the whole move; Del
   removes selection and one Undo restores it; a pure click creates no undo step.
6. **index.html + main.ts + styles.css — select tool wiring:** add the select button, route
   tool switches through `editor.setTool`, add `Delete`/`Backspace`/`Escape` handlers with
   `isTypingTarget` guard. *Verify (Windows, `pnpm tauri dev`):* AC-1 click selects with
   highlight; AC-2 drag-move and Del both work and are undoable; Escape/empty-click
   deselect; switching tools clears selection.

### TASK-9 — Stroke-width & font-size controls

7. **model.ts:** add `SizeName`, `STROKE_PRESETS`, `FONT_PRESETS`. *Verify:* `M` equals
   current `DEFAULTS` (6 / 28); `pnpm check`.
8. **canvas.ts:** add `strokeWidth`/`fontSize` fields + `setSize(name)`; `onDown` uses them
   for new arrow/rect/text. *Verify:* changing size then drawing yields the chosen
   stroke/font; existing annotations unchanged.
9. **index.html + main.ts + styles.css:** add `#sizes` S/M/L group, wire to
   `editor.setSize`, active-class toggle, styling. *Verify (Windows):* AC-1 — pick S/M/L,
   draw an arrow/rect and a text; default is M.

## `docs/ARCHITECTURE.md` updates (do together with TASK-8)

- **"The annotation object model"** — move "select/move/delete" from future benefit to
  implemented; add that selection is transient `Editor` state keyed by annotation `id`
  (never in the document/history/export).
- **New short subsection "Selection & hit-testing"** — `hittest.ts` is pure,
  format-agnostic, shared by the live canvas and future formats, and deliberately not
  imported by `exporter.ts`; the selection marquee is drawn only by `Editor.render()`.
  State the rect edge-band rule and bitmap-px (scale-compensated) tolerance.
- **Keyboard shortcuts** — `Del`/`Backspace` = delete selection, `Esc` = deselect.
- **IPC contract table** — one-line note that TASK-8/9 introduce no IPC changes.
- **Toolbar description** — mention the select tool and the S/M/L size control.
