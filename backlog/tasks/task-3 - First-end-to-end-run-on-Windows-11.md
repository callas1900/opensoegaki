---
id: TASK-3
title: First end-to-end run on Windows 11
status: To Do
assignee: []
created_date: '2026-07-12 02:44'
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
- [ ] #1 Capture, annotate, clipboard and drag-out all work in a real session
- [ ] #2 Clipboard paste verified in at least one external app
<!-- AC:END -->
