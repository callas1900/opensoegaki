# OpenScrawl — Architecture

## Overview

OpenScrawl is a tray-resident screenshot annotation tool built on Tauri 2.

```
┌─────────────────────────── OpenScrawl ───────────────────────────┐
│                                                                  │
│  Rust core (src-tauri/)              TypeScript UI (src/)        │
│  ─────────────────────               ───────────────────         │
│  tray icon & lifecycle    events →   editor (Canvas)             │
│  global hotkeys           ────────   annotation object model     │
│  screen capture (xcap)    ← invoke   undo/redo history           │
│  drag-out temp files                 PNG export (OffscreenCanvas)│
│  clipboard plugin                    toolbar / palette UI        │
└──────────────────────────────────────────────────────────────────┘
```

## Responsibility split

- **Rust owns the OS.** Everything that touches the operating system — tray, global
  shortcuts, monitor capture, temp files for drag-and-drop — lives in `src-tauri/`.
- **TypeScript owns the canvas.** All drawing, hit-testing, interaction and export
  logic lives in `src/`. It never touches the filesystem directly.

## The annotation object model

The core design decision: **annotations are data, not pixels.**

`src/editor/model.ts` defines `Annotation` (arrow / rect / text) as plain objects.
The live canvas (`canvas.ts`) and the exporter (`exporter.ts`) both render the same
model through one pure function (`render.ts`). Benefits:

- Undo/redo is a list snapshot, not a bitmap diff (`history.ts`)
- Future features fall out naturally: select/move/delete, a re-editable ".scrawl"
  file format, SVG export

## IPC contract

| Direction | Name | Payload | Purpose |
| --- | --- | --- | --- |
| Rust → TS (event) | `openscrawl://captured` | base64 PNG string | New capture ready |
| TS → Rust (command) | `prepare_drag_file` | `png: number[]` → returns temp file path | Materialize export for OS drag |

Keep this table current — the `reviewer` agent checks IPC contract drift.

## Capture flow

1. User presses `Ctrl+Shift+5` / `Ctrl+Shift+6` (registered by
   `tauri-plugin-global-shortcut`).
2. Rust captures the primary monitor via `xcap` and emits `openscrawl://captured`.
3. The editor loads the PNG as an `ImageBitmap` and resets the document.

**Known gap (MVP):** region capture currently captures the full screen; the
click-and-drag crop overlay (`src/capture/`) is the next planned task. Design intent:
a borderless fullscreen window showing the frozen capture, drag-to-select, crop in TS.

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
   Screen Recording permission UX, `.icns` icon, and hotkey conventions (`Cmd+Shift+5`
   conflicts with the system screenshot tool — needs a different default).
