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

`src/editor/model.ts` defines `Annotation` (arrow / rect / text) as plain objects.
The live canvas (`canvas.ts`) and the exporter (`exporter.ts`) both render the same
model through one pure function (`render.ts`). Benefits:

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

`src/editor/hittest.ts` is pure, format-agnostic geometry (`boundsOf`, `hitTest`)
over the annotation model — the same code a future `.soegaki` loader or SVG exporter
could reuse. It is deliberately **never imported by `exporter.ts`**; that import
boundary is the mechanical guarantee that selection chrome cannot be rasterized
into exported/copied images. The selection marquee itself is drawn by a private
`Editor.drawSelectionOverlay` method, called from `Editor.render()` after
`renderAnnotations` and the draft — i.e. only reachable from the live canvas path.

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

## IPC contract

| Direction | Name | Payload | Purpose |
| --- | --- | --- | --- |
| TS → Rust (command) | `capture_fullscreen` | none → returns base64 PNG string | Hide window, capture primary monitor, show window, return the shot |
| TS → Rust (command) | `prepare_drag_file` | `png: number[]` → returns temp file path | Materialize export for OS drag |
| TS → Rust (command) | `save_png` | `{ png: number[], defaultName: string }` → `string \| null` | Show native save dialog, write PNG; returns saved path, or `null` if the user cancelled |

Keep this table current — the `reviewer` agent checks IPC contract drift.

The selection tool (hit-test/move/delete) is a pure `src/` feature and introduces
no IPC changes; the table above is unaffected. The inline text editor (below)
is likewise pure `src/`; `save_png` is the only IPC addition on top of the
original two commands. The crop tool (below) is also pure `src/` and
introduces no IPC changes — including its v2 handle-based/mouse-only-apply
revision, which is pure `src/` UI/interaction rework with no Rust or IPC
surface touched.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+C` / `Cmd+C` | Copy exported PNG to clipboard |
| `Del` / `Backspace` | Delete the selected annotation (undoable) |
| `Esc` | Reset the crop region to the full image while cropping, else deselect |
| `Enter` | Apply the crop region (no-op on an unshrunk full-image region) |
| `Ctrl+S` / `Cmd+S` | Save annotated PNG via native dialog |

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

The toolbar's first button is **Select** (`V`), an opt-in tool alongside the three
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
accent state; it is the only toolbar button using SVG today — the rest
remain Unicode glyphs.

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
