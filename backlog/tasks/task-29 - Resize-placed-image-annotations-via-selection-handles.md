---
id: TASK-29
title: Resize selected annotations via selection handles
status: To Do
assignee: []
created_date: '2026-07-19 14:32'
updated_date: '2026-07-20 06:32'
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
- [ ] #1 Selecting an image annotation shows resize handles
- [ ] #2 Dragging a handle resizes the image; the result is undoable
- [ ] #3 Resized images export correctly to PNG
- [ ] #4 Selecting a rect shows resize handles and dragging them resizes it (undoable)
- [ ] #5 Every other annotation kind either supports resize or the design note records why it is excluded
- [ ] #6 Resized annotations of all kinds export correctly to PNG
<!-- AC:END -->
