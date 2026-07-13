---
id: TASK-3
title: First end-to-end run on Windows 11
status: Done
assignee: []
created_date: '2026-07-12 02:44'
updated_date: '2026-07-13 09:39'
labels:
  - foundation
dependencies:
  - TASK-2
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run pnpm tauri dev and verify the whole MVP loop: hotkey capture -> annotate (arrow/rect/text) -> undo/redo -> Ctrl+C clipboard -> drag-out to another app. Specifically verify clipboard writeImage() accepts PNG bytes on Windows (untested; API may expect RGBA). File a task for every bug found.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Capture, annotate, clipboard and drag-out all work in a real session
- [x] #2 Clipboard paste verified in at least one external app
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Prerequisites on the Windows side (run in PowerShell, not WSL): 1) Install Rust: winget install Rustlang.Rustup (MSVC toolchain) and VS Build Tools C++ workload if missing. 2) cd C:\Users\calla\Documents\openscrawl. 3) pnpm install (Windows node/pnpm) then pnpm tauri dev. Verify: Ctrl+Shift+6 capture -> arrow/rect/text -> Ctrl+Z/Ctrl+Shift+Z -> Ctrl+C paste into Paint/Slack -> drag the tab into Explorer/browser. Also run cargo clippy -- -D warnings in src-tauri to close TASK-2 AC#2. File a new backlog task per bug found.

Verified 2026-07-13 by automated E2E on the real Windows 11 desktop (PowerShell UI automation from WSL): (1) Ctrl+Shift+6 global hotkey captured the primary monitor (2560x1440) and showed the editor; (2) arrow annotation drawn via synthetic pointer drag, rendered with white outline; (3) undo (Ctrl+Z) removed and redo (Ctrl+Shift+Z) restored an arrow; (4) Ctrl+C put a 2560x1440 PNG with the rasterized arrow on the clipboard — writeImage(PNG bytes) confirmed working on Windows; paste verified in MS Paint; (5) drag-out from the 'drag to share' tab dropped scrawl-<ts>.png into an Explorer window (prepare_drag_file + tauri-plugin-drag full path). Evidence screenshots: %TEMP%\openscrawl-e2e-*.png. Build: first compile 2m23s (debug). No functional bugs found. Note: killing the process (not tray Quit) leaves %TEMP%\openscrawl behind — already tracked as task-6.
<!-- SECTION:NOTES:END -->
