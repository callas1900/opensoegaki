# Design note — Inline text editing & Save-as-PNG (TASK-7, TASK-10)

Author: architect agent, 2026-07-15. Status: **agreed; implemented and review-approved 2026-07-15; Addenda 1–2 added after E2E/AC-regression findings**.

## 1. Overview

Two mostly-independent features:

- **TASK-7** — replace the blocking `window.prompt("Text:")` in `Editor.onDown` with an in-canvas inline editor: a single positioned DOM `<input>` that is the live preview and commits to a `TextAnnotation` on Enter/blur, cancels on Esc. Pure `src/` work, no IPC, no model change.
- **TASK-10** — Save the exported PNG through a native file dialog (Ctrl+S / toolbar button). One new Rust command over `rfd`; one new Cargo dependency, no new Tauri plugin, no capability change.

The load-bearing constraint for TASK-7 is the **exporter-purity invariant**: `render.ts` is shared with `exporter.ts`, so the editing overlay must be **DOM only** — it never passes through `renderAnnotations`, so it cannot be rasterized into an exported/copied PNG. Committed text renders through the existing shared path, so preview and final output use the same font stack and size.

**In scope (TASK-7):** single-line inline input; Enter/Esc/blur; CSS-scale-correct positioning and font; empty-commit = discard; background-swap / undo / tool-switch teardown; keyboard-guard coordination.
**Out of scope (TASK-7):** multi-line text (model stays single `text: string`), re-editing an existing placed text (double-click-to-edit), changing color/size mid-edit (both captured at open), auto-grow width polish.

**In scope (TASK-10):** native save dialog + write; default filename; Ctrl+S and a Save button; cancel/error handling.
**Out of scope (TASK-10):** remembering last-used directory, export formats other than PNG, "export region".

The two tasks share one small edit in `main.ts` (the keydown handler) — sequence TASK-7 first so the `isTypingTarget` early-return exists before Ctrl+S is wired.

## 2. Decisions

### TASK-7

**2.1 Element: one positioned `<input type="text">`, not contenteditable/textarea.**
The model is a single-line `TextAnnotation` (`text: string`, rendered as one `fillText` line). A single-line `<input>` matches it exactly; contenteditable/textarea would invite multi-line input the model can't represent. Do **not** widen the model. The `<input>` is created on demand, appended to `#stage` (which is already `position: relative`), and removed on commit/cancel. It is transient DOM, never part of `doc`, never in history, never through `renderAnnotations` — same enforcement style as the selection overlay.

**2.2 The input *is* the preview; make its metrics equal the canvas render.**
Both live input and committed render must use the same font. Canvas render uses `fontString(fontSize)` = `bold {px}px system-ui, sans-serif` with `textBaseline = "top"`, drawing the em-box top at `at.y`. The input reuses `fontString` (imported from `render.ts`) so there is one font source. Because the canvas is CSS-scaled, the input lives in **CSS px** while the annotation lives in **bitmap px**; positioning multiplies by `scale = canvasRect.width / canvas.width` (bitmap→CSS):

- `left = (canvasRect.left − stageRect.left) + at.x * scale`
- `top  = (canvasRect.top  − stageRect.top ) + at.y * scale`
- font = `fontString(fontSize * scale)`

The input is styled `padding:0; border:0; margin:0; outline:none; background:transparent; line-height:1.2` and `color = editor.color` so glyph top aligns to `top` (matching `textBaseline:"top"`). A faint white `text-shadow` approximates the render's white outline halo during editing; this is cosmetic — the committed render (via `render.ts`) is authoritative. Store `at`, `color`, `fontSize` at open time so later toolbar changes don't affect the in-flight edit.

**2.3 Commit / cancel / empty.**

- **Enter** → commit; **Esc** → cancel; **blur** → commit (clicking elsewhere keeps the text — the common editor expectation).
- **Commit** reads `input.value`; if it is blank (`value.trim() === ""`) it discards with **no history push** (preserving the current `if (text)` behavior); otherwise it routes through the existing `commit(...)` → exactly **one** undoable push per committed text.
- **Cancel** removes the input with no commit — history untouched.
- Single teardown path avoids double-commit: commit/cancel set `this.textEdit = null` *before* removing the element, and the blur listener early-returns when `this.textEdit` is null (removing a focused element fires blur). So Enter→commit, Esc→discard, and click-away→commit all funnel cleanly.
- Opening a second editor first commits any open one (`openTextEditor` is idempotent).

**2.4 Lifecycle edge cases.**

- **Switch tools during edit:** clicking a tool button blurs the input → commits. No extra code needed.
- **Paste new background / capture during edit:** the paste path reaches `Editor.setBackground`; **cancel (discard)** the editor there — the pending text belonged to the old image. Same in `restore` (undo/redo).
- **Window resize during edit:** register a `resize` listener (only while editing) that re-runs positioning from the stored bitmap `at`, so the input tracks the reflowed/rescaled canvas. (Mid-edit `#stage` scroll is a known minor gap; text edits are short.)

**2.5 Keyboard-guard coordination (`isTypingTarget`).**
Move the existing `isTypingTarget(e.target)` check to the **top** of the `main.ts` window `keydown` handler as an early return, so while the input is focused **no** global shortcut fires: Ctrl+Z / Ctrl+Shift+Z fall through to the input's **native** undo/redo, Ctrl+C is native text copy, Delete/Backspace edit text, and Ctrl+S is inert (harmless in a text field). **Escape** is handled by the input's own `keydown` listener (→ cancel), not the global handler. The input's `keydown` also calls `stopPropagation()` as belt-and-suspenders so editing keys can never reach global handlers even if the guard is later refactored.

### TASK-10

**2.6 Single custom Rust command over `rfd`, not `tauri-plugin-dialog`.**
`tauri-plugin-dialog` wraps `rfd` anyway, and the plugin route needs either plugin-fs (a second plugin, fs scope/permissions, JS glue to write the file) or the plugin's own save-file write path plus capability entries. The bytes already cross into Rust for drag-out (`prepare_drag_file`), so keeping them in Rust adds **no new privacy surface**. A single command that shows the dialog and writes the file is the smallest surface: one crate (`rfd`), one command, and **no capability change** (invoking an app-defined command is allowed by `core:default`; only plugin/core commands need explicit permissions).

**2.7 Cross-platform: `rfd::AsyncFileDialog` inside an `async` command.**
The command is `async fn`, so it runs on Tauri's async runtime, not the main thread. `rfd`'s **blocking** `FileDialog` on that thread is unsafe on macOS (native panels must be driven from the main thread). `AsyncFileDialog::save_file().await` dispatches to the main thread on macOS and spawns a message-pumping thread on Windows — correct on the Windows-11 primary target and not blocking the planned macOS port. The file write (`std::fs::write`) is synchronous but trivial.

**2.8 Default filename in JS, no chrono.**
Format `scrawl-YYYYMMDD-HHMMSS.png` in TS (trivial `Date` formatting) and pass it as `defaultName`; doing this in Rust would need a date crate. Filter to `*.png`.

**2.9 No last-directory memory; native overwrite.**
Keep it light — rely on the OS dialog's own remembered location. The native panel handles overwrite confirmation. Dialog **cancel is not an error** → command returns `Ok(None)` and JS does nothing. **Write failure** → `Err(String)` surfaced via `console.error`, matching the existing copy/drag sinks (no new UI).

**2.10 Ctrl+S wiring.**
Add a `mod && key === "s"` branch to the `main.ts` keydown handler *after* the 2.5 early return, so it cannot fire while the inline editor is focused. Also add a **Save** button in the share bar next to Copy.

## 3. IPC contract additions

Append one row to the `docs/ARCHITECTURE.md` IPC table:

| Direction | Name | Payload | Purpose |
| --- | --- | --- | --- |
| TS → Rust (command) | `save_png` | `{ png: number[], defaultName: string }` → `string \| null` | Show native save dialog, write PNG; returns saved path, or `null` if the user cancelled |

Rust signature (matches `prepare_drag_file`'s `Vec<u8>` convention; `Option<String>` serializes to `string | null`):

```
#[tauri::command]
async fn save_png(png: Vec<u8>, default_name: String) -> Result<Option<String>, String>
```

TASK-7 introduces **no** IPC changes.

## 4. Implementation tasks

Continuing the prior note's numbering (it ended at 9).

### TASK-7 — Inline text editor

10. **`src/editor/canvas.ts` — editor state & methods.** Import `fontString` from `./render`. Add field `private textEdit: { input: HTMLInputElement; at: Point; color: string; fontSize: number; reposition: () => void } | null = null;`. Add private methods:
    - `openTextEditor(at: Point)` — if `textEdit` set, `commitTextEditor()` first; create the `<input class="text-editor">`, capture `color`/`fontSize` from the editor, store in `textEdit`, call `positionTextEditor()`, set `input.style.color`, append to `this.canvas.parentElement`, add `keydown` (Enter→`commitTextEditor` + `preventDefault`; Escape→`cancelTextEditor` + `preventDefault`; always `stopPropagation`), add `blur`→`commitTextEditor`, `window.addEventListener("resize", reposition)`, then `input.focus()`.
    - `positionTextEditor()` — compute `scale = canvasRect.width / canvas.width`; set `left`/`top` from `at` and the canvas-vs-stage offset; set `input.style.font = fontString(fontSize * scale)`.
    - `commitTextEditor()` — early-return if `textEdit` null; read value; set `textEdit = null`; `input.remove()`; remove the resize listener; if value non-blank call existing `commit({ id: nextId(), color, strokeWidth: this.strokeWidth, kind: "text", at, text: value, fontSize })`; `render()`.
    - `cancelTextEditor()` — early-return if null; set `textEdit = null`; `input.remove()`; remove resize listener; `render()`.
    *Verify:* `pnpm check` passes; no import of these from `exporter.ts`/`render.ts`.

11. **`src/editor/canvas.ts` — `onDown` text branch.** Replace the `window.prompt` branch: when `tool === "text"`, call `this.openTextEditor(p)` and `return` **before** `setPointerCapture` (text editing needs no pointer capture); leave arrow/rect/select branches unchanged. *Verify:* clicking with the text tool opens an input at the click point; typing shows text at the correct position/size; Enter commits, Esc discards; committed text visually matches the input preview.

12. **`src/editor/canvas.ts` — teardown on doc change.** Call `this.cancelTextEditor()` at the top of `setBackground` and `restore`. *Verify:* pasting a new screenshot or pressing Ctrl+Z while an editor is open discards the pending text and leaves history/document consistent.

13. **`src/styles.css` — `.text-editor`.** `position:absolute; margin:0; padding:0; border:0; outline:none; background:transparent; line-height:1.2; white-space:pre;` plus a faint white `text-shadow` to approximate the render outline, and a small `min-width` so the caret is visible on an empty field. *Verify:* input background is transparent over the screenshot; caret visible; no border box.

14. **`src/main.ts` — keyboard guard.** Move `if (isTypingTarget(e.target)) return;` to the **first line** of the window `keydown` handler and drop the now-redundant inner `!isTypingTarget(...)` guard around Delete/Backspace/Escape. *Verify:* while editing text — Ctrl+Z is native input undo (not canvas undo), Ctrl+C copies selected text (not export-to-clipboard), Delete/Backspace edit text; when not editing, all global shortcuts behave as before.

### TASK-10 — Save as PNG

15. **`src-tauri/Cargo.toml`.** Add `rfd = "0.15"` to `[dependencies]`. (Default features are fine for Windows/macOS; if Linux CI is later added, select the `xdg-portal` feature.) *Verify:* `cargo build` on Windows succeeds.

16. **`src-tauri/src/lib.rs` — `save_png` command.** Add the `async fn save_png(png: Vec<u8>, default_name: String) -> Result<Option<String>, String>` from §3: build `rfd::AsyncFileDialog::new().set_file_name(&default_name).add_filter("PNG image", &["png"]).save_file().await`; on `Some(file)` write bytes with `std::fs::write(file.path(), &png)` and return `Ok(Some(path))`; on `None` return `Ok(None)`; map write errors to `Err(e.to_string())`. Register it in `generate_handler![prepare_drag_file, capture_fullscreen, save_png]`. *Verify:* `cargo clippy` clean; invoking with dummy bytes writes a valid PNG; cancel returns `null` without error.

17. **`src/main.ts` — save wiring.** Add a `timestamp()` helper producing `YYYYMMDD-HHMMSS` and a `savePng()`: guard `editor.hasImage()`, `png = await exportPng(editor.doc)`, `await invoke<string | null>("save_png", { png: Array.from(png), defaultName: \`scrawl-${timestamp()}.png\` })`, `catch` → `console.error`. Add a keydown branch (after the Ctrl+C branch) `mod && e.key.toLowerCase() === "s"` → `preventDefault()` + `void savePng()`. *Verify:* Ctrl+S opens the dialog with the default name; saving writes the PNG; cancel is silent.

18. **`index.html` + `src/styles.css` + `src/main.ts` — Save button.** Add `<button id="save" title="Save PNG (Ctrl+S)">Save</button>` in `#share-bar` (reuse the `#copy` button style, e.g. extend the selector to `#copy, #save`); wire `#save` click → `void savePng()`. *Verify (Windows, `pnpm tauri dev`):* AC — both Ctrl+S and the Save button open the native dialog and write the annotated PNG.

## 5. `docs/ARCHITECTURE.md` updates

- **IPC contract table** — add the `save_png` row from §3.
- **Keyboard shortcuts table** — add `Ctrl+S / Cmd+S` = "Save annotated PNG via native dialog"; update the `Esc` row / `isTypingTarget` note to state that while the inline text editor is focused all global shortcuts are suppressed (native undo/copy in the field; Esc cancels the editor).
- **Capture flow / editing** — note that the text tool now opens an in-canvas `<input>` overlay (DOM only, never through `renderAnnotations`, so it cannot be rasterized), single-line, committing one undoable `TextAnnotation`; replaces the former `window.prompt`.
- **New short "Save flow" subsection** — TS exports via `exporter.ts` and invokes `save_png`; Rust shows an `rfd::AsyncFileDialog` (main-thread-safe on macOS, threaded on Windows) and writes the file; cancel = `null` (no-op), write error surfaced in console. Note the deliberate choice of a custom `rfd` command over `tauri-plugin-dialog` to keep the dependency/permission surface minimal (no capability entry needed).
- **Privacy stance** — unchanged; note `save_png` writes only to a user-chosen local path, no network I/O.

## Addendum (2026-07-15)

Manual Windows E2E found a regression in TASK-7: with the text tool, clicking the
canvas opened the inline editor, but typing was impossible because the `<input>`
lost focus immediately.

**Root cause:** `onDown` handles the text branch during `pointerdown`, and
`openTextEditor` calls `input.focus()`. The browser then still runs the
compatibility `mousedown` event's default action for that same interaction,
which moves focus to the clicked element; the canvas is not focusable, so
focus falls through to `body`. That fires `blur` on the input →
`commitTextEditor()` → the (still-empty) value discards → the editor is
removed before the user can type anything.

**Fix:** step 11's "no pointer capture" instruction is amended to additionally
require `e.preventDefault()` on the `pointerdown` event before calling
`openTextEditor(p)`. Per the Pointer Events spec, canceling `pointerdown`
suppresses the compatibility mouse events' default action (including the
focus change), so focus stays on the DOM input. No other change to step 11
or the surrounding lifecycle.

## Addendum 2 (2026-07-15) — paste & drag-out vs pending text

Manual E2E + AC regression audit surfaced two composed-behavior defects where TASK-7's inline editor collides with existing input paths. Both fixes below; they compose with Addendum 1's pointerdown-focus fix and preserve exporter purity and one-undo-push semantics.

### Defect 1 — unconditional `preventDefault` blocks native text paste

The `main.ts` window `paste` listener calls `e.preventDefault()` before it knows whether the clipboard holds an image. When the inline text editor is focused and the user pastes **text**, the cancel suppresses the input's native paste, so nothing is inserted. Fix: decide first, cancel only for images.

19. **`src/main.ts` — conditional paste handling.** Restructure the window `paste` listener to scan `clipboardData.items` for the first `image/*` item *before* deciding: if an image item is found, `e.preventDefault()`, `getAsFile()`, and route to `editor.loadImageBlob(...)` exactly as today (this keeps decision 2.4: `setBackground` cancels any open editor, so an image paste mid-edit still replaces the background and discards the pending text); if **no** image item is present, `return` **without** `preventDefault()`, letting the focused input perform its native text paste. Do not early-return before the scan, and do not depend on focus state — a no-image paste with nothing focused simply does nothing, as before. *Verify:* (a) TASK-17 ACs intact — pasting a Snipping Tool / OS screenshot loads it as background; a paste carrying no image does nothing and throws no error; (b) with the inline editor focused, pasting text inserts it into the input; (c) with the inline editor open, pasting an image replaces the background and discards the in-flight text (no committed leftover, history consistent).

### Defect 2 — drag-out exports before the blur-commit lands

The `#drag-tab` `mousedown` handler calls `exportPng(editor.doc)` synchronously; the input's `blur`→commit fires only after the mousedown listener's synchronous portion has already read `doc` (browser focus fixup runs after the handler), so freshly typed text is silently dropped from the dragged PNG. (Copy/Save are `click` handlers whose button press blurs the input synchronously first, so their commit already lands before export — they are unaffected.) Fix: commit explicitly at the top of the drag path.

20. **`src/editor/canvas.ts` — public commit wrapper.** Add `commitPendingText(): void { this.commitTextEditor(); }` to the Editor public API. It delegates to the existing private `commitTextEditor()`, which is idempotent (no-op when `textEdit` is null) and already routes a non-blank value through the single `commit(...)` push and removes the overlay DOM before returning — so exporter purity and one-undo-push semantics are unchanged. Rationale for a named method over blurring `document.activeElement`: it is explicit and deterministic (no reliance on which element happens to be focused or on blur-listener timing), matches the existing public-method style (`setTool`/`clearSelection`/…), and is trivially callable from any export sink. *Verify:* `pnpm check` passes; calling `commitPendingText()` with no open editor is a no-op and pushes no history.

21. **`src/main.ts` — commit before drag export.** At the top of the `#drag-tab` `mousedown` handler, call `editor.commitPendingText()` before `exportPng(editor.doc)`, so any in-flight text is materialized into `doc` first. Do **not** add the call to the Copy or Save handlers: their button-press blur commits the text synchronously before their async work runs, making it redundant there; `commitPendingText()` is idempotent so a future defensive addition would be harmless, but we keep the change minimal to the one path that actually needs it (the one whose export runs before focus fixup). *Verify:* type text with the text tool, then immediately drag the share tab without clicking elsewhere — the dragged/dropped PNG contains the typed text, and exactly one undo removes that text; Copy and Save of the same state still include the text (regression check).
