---
id: TASK-41
title: Rotate selected annotations with the select tool
status: To Do
assignee: []
created_date: '2026-07-23 17:29'
labels: []
dependencies: []
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow rotating annotations that are selected with the select tool. Add a rotation handle to the selection UI (typical pattern: a handle above the bounding box, or rotate cursors near the corners). Rotation must be part of the annotation object model (an angle property on shapes) and applied at render time and at export rasterization — never baked into the shape's points. Rotation must be undoable and must compose with move/resize (TASK-8, TASK-29 behavior must keep working).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A selected annotation shows a rotation affordance and can be rotated by dragging it
- [ ] #2 Rotation is stored in the object model as data (angle), not by mutating the shape geometry
- [ ] #3 Rotated annotations render correctly on canvas and in the exported/copied PNG
- [ ] #4 Rotation is undoable/redoable
- [ ] #5 Hit-testing, move, and resize still work correctly on a rotated annotation
<!-- AC:END -->
