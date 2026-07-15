---
id: TASK-6
title: Clean up temp files on every exit path
status: To Do
assignee: []
created_date: '2026-07-12 02:44'
updated_date: '2026-07-15 03:31'
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
- [ ] #1 Temp dir is removed on tray Quit, window-close-to-quit paths, and normal process exit
<!-- AC:END -->
