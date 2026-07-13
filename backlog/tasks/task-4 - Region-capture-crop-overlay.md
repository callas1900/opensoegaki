---
id: TASK-4
title: Region-capture crop overlay
status: To Do
assignee: []
created_date: '2026-07-12 02:44'
labels:
  - mvp
dependencies:
  - TASK-3
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The declared next planned task (docs/ARCHITECTURE.md 'Known gap'). Build the region-selection overlay in src/capture/: a borderless fullscreen window showing the frozen capture, drag-to-select rectangle, crop done in TypeScript. Design must go through the architect agent first: new window lifecycle, IPC contract additions, and an ARCHITECTURE.md update.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Architect design note exists and ARCHITECTURE.md IPC table is updated
- [ ] #2 Ctrl+Shift+5 opens the overlay; dragging a rectangle yields a cropped image in the editor
- [ ] #3 Esc cancels the overlay without changing the current document
<!-- AC:END -->
