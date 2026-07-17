---
id: TASK-21
title: Highlighter tool (freehand marker)
status: To Do
assignee: []
created_date: '2026-07-17 01:48'
labels: []
dependencies: []
priority: medium
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a highlighter annotation tool, like a text marker pen. Freehand stroke drawn with the mouse; holding Shift constrains the stroke to a straight line. Rendered semi-transparent (multiply-style blending) so underlying text stays readable. Uses the currently selected palette color and S/M/L stroke presets (highlighter widths may be scaled up from the presets). New annotation kind in src/editor/model.ts (object model — rasterize only at export); rendering/interaction in src/editor/canvas.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A highlighter tool button exists in the toolbar and can be activated
- [ ] #2 Dragging draws a freehand semi-transparent stroke in the selected palette color; underlying image/text remains readable
- [ ] #3 Holding Shift while dragging draws a straight-line stroke
- [ ] #4 Highlight strokes are annotation objects: selectable, movable, deletable with the select tool, and undo/redo works
- [ ] #5 Exported PNG (copy/save/drag) includes highlights exactly as shown on canvas
<!-- AC:END -->
