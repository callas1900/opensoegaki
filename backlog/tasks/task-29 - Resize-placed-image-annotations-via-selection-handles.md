---
id: TASK-29
title: Resize placed image annotations via selection handles
status: To Do
assignee: []
created_date: '2026-07-19 14:32'
labels:
  - feature
dependencies:
  - TASK-20
priority: low
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-20: images are now selectable/movable/deletable, but resizing a placed image is not possible. Add resize handles to the selection overlay for image annotations (and decide whether other kinds like rect/text get them too — architect design needed: handle hit-testing, aspect-ratio lock with Shift?, minimum size). Depends on TASK-20.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Selecting an image annotation shows resize handles
- [ ] #2 Dragging a handle resizes the image; the result is undoable
- [ ] #3 Resized images export correctly to PNG
<!-- AC:END -->
