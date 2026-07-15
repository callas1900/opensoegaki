---
id: TASK-6
title: Clean up temp files on every exit path
status: Done
assignee: []
created_date: '2026-07-12 02:44'
updated_date: '2026-07-15 10:06'
labels:
  - mvp
dependencies: []
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
cleanup_temp() only runs from the tray Quit menu item (src-tauri/src/lib.rs). Hook RunEvent::Exit (or equivalent) so %TEMP%/opensoegaki is removed however the app terminates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Temp dir is removed on tray Quit, window-close-to-quit paths, and normal process exit
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-15: Implemented: Builder switched to .build().run(RunEvent handler); cleanup_temp() runs on RunEvent::Exit (tray Quit's direct call removed — app.exit(0) flows through RunEvent::Exit, confirmed against tauri 2.11.5). cargo check/clippy clean on Windows. Reviewer approved.
2026-07-15: AC#1 verified E2E by user on Windows: drag-out created %TEMP%/opensoegaki, tray Quit removed it (confirmed via Test-Path after exit).
<!-- SECTION:NOTES:END -->
