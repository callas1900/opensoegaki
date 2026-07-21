---
id: TASK-29
title: Resize selected annotations via selection handles
status: Done
assignee: []
created_date: '2026-07-19 14:32'
updated_date: '2026-07-21 08:11'
labels:
  - feature
dependencies:
  - TASK-20
priority: low
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Originally a follow-up to TASK-20 for images only; scope broadened 2026-07-20 per user request: any annotation chosen with the select tool should be resizable. Add resize handles to the selection overlay for all resizable kinds (image, rect, arrow, text, badge, highlight — architect decides per-kind semantics: e.g. text/badge may resize via font-size/radius, arrow via endpoint drag). Architect design needed: handle hit-testing, aspect-ratio lock with Shift?, minimum size. Depends on TASK-20.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Selecting an image annotation shows resize handles
- [x] #2 Dragging a handle resizes the image; the result is undoable
- [x] #3 Resized images export correctly to PNG
- [x] #4 Selecting a rect shows resize handles and dragging them resizes it (undoable)
- [x] #5 Every other annotation kind either supports resize or the design note records why it is excluded
- [x] #6 Resized annotations of all kinds export correctly to PNG
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-21 with TASK-23 (same select-tool pipeline). New pure module src/editor/resize.ts (+42 tests): 8 handles for rect/image (image corner drag aspect-locked by default, Shift frees; rect free, Shift locks), arrow endpoint handles with Shift 45-degree snap, text corner handles scale fontSize (8-400), badge corner handles set radius (8-400), highlight excluded by design (bbox-scaling a freehand polyline distorts stroke shape; rationale in docs/ARCHITECTURE.md). One undo snapshot per gesture. Reviewer approved after 2 fix rounds; pnpm check + 120/120 tests. All ACs exercised in pnpm tauri dev on Windows 2026-07-21 and confirmed by user.
<!-- SECTION:NOTES:END -->
