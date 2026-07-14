# OpenScrawl — Architecture

## Overview

OpenScrawl is a tray-resident screenshot annotation tool built on Tauri 2.

```
┌─────────────────────────── OpenScrawl ───────────────────────────┐
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
- Select/move/delete (below) and a re-editable ".scrawl" file format or SVG export
  fall out naturally from the same object model

Selection itself is **not** part of the document: `Editor.selectedId` is transient
view state (a `string | null` keyed by annotation `id`), never stored on `doc`,
never `structuredClone`d into a history snapshot, and never passed through
`renderAnnotations` — so it cannot be undone/redone as data and cannot leak into
an exported PNG.

## Selection & hit-testing

`src/editor/hittest.ts` is pure, format-agnostic geometry (`boundsOf`, `hitTest`)
over the annotation model — the same code a future `.scrawl` loader or SVG exporter
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

Keep this table current — the `reviewer` agent checks IPC contract drift.

The selection tool (hit-test/move/delete) is a pure `src/` feature and introduces
no IPC changes; the table above is unaffected.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+Z` / `Cmd+Z` | Undo |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| `Ctrl+C` / `Cmd+C` | Copy exported PNG to clipboard |
| `Del` / `Backspace` | Delete the selected annotation (undoable) |
| `Esc` | Deselect |

`Del`/`Backspace`/`Esc` are gated by an `isTypingTarget` guard in `main.ts` so a
global handler never eats keys destined for a text field (e.g. a future inline
text editor).

## Capture flow

OpenScrawl's primary input path is pasting a screenshot taken with the OS tool; a
toolbar button covers full-screen capture as a secondary path.

1. **Paste (primary).** The user shoots with the OS screenshot tool (Win+Shift+S;
   Cmd+Shift+4 on macOS) and presses Ctrl+V / Cmd+V in OpenScrawl. The webview fires
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

**Known gap (MVP):** the Capture button always captures the full screen; a
click-and-drag crop overlay (`src/capture/`) is a possible future addition.

## Toolbar

The toolbar's first button is **Select** (`V`), an opt-in tool alongside the three
draw tools (arrow/rect/text, default). Selecting an annotation shows a dashed
marquee and allows drag-to-move or `Del`/`Backspace` to remove it (see
"Selection & hit-testing" above); switching tools, `Esc`, or clicking empty canvas
clears the selection. New annotations are not auto-selected after drawing.

## Share flow (drag-out)

1. User drags the tab in the share bar.
2. TS rasterizes the document (`exporter.ts`) and invokes `prepare_drag_file`.
3. Rust writes `%TEMP%/openscrawl/scrawl-<ts>.png` and returns the path.
4. `tauri-plugin-drag` starts a native OS drag with that file.
5. Temp files are removed on app exit.

## Privacy stance

Screenshots are sensitive. OpenScrawl performs **no network I/O** and must stay that
way unless a feature is explicit, opt-in, and reviewed.

## Platform roadmap

1. **Windows 11** (current) — NSIS/MSI bundles.
2. **macOS** — xcap and tauri-plugin-drag both support it; main work items are
   Screen Recording permission UX (needed for the Capture button's `xcap` call) and a
   `.icns` icon. The paste path needs no platform-specific work: WKWebView fires the
   same DOM `paste` event as WebView2 for Cmd+V.
