---
id: TASK-21
title: Highlighter tool (freehand marker)
status: Done
assignee: []
created_date: '2026-07-17 01:48'
updated_date: '2026-07-19 09:59'
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
- [x] #1 A highlighter tool button exists in the toolbar and can be activated
- [x] #2 Dragging draws a freehand semi-transparent stroke in the selected palette color; underlying image/text remains readable
- [x] #3 Highlight strokes are annotation objects: selectable, movable, deletable with the select tool, and undo/redo works
- [x] #4 Exported PNG (copy/save/drag) includes highlights exactly as shown on canvas
- [x] #5 Holding Shift while dragging locks the stroke horizontal: y is fixed at the stroke start, x follows the cursor
- [x] #6 Highlight strokes are clearly visible on dark/black backgrounds while underlying light text stays readable
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-19 (batched with TASK-22, architect design + implementer + reviewer APPROVE). New 'highlight' annotation kind: points polyline, multiply blend alpha 0.45, width = strokeWidth x3, Shift = live straight line. pnpm check + 78 vitest tests green. Awaiting manual AC pass in pnpm tauri dev on Windows before Done.

Amendment 2026-07-19 per user feedback: (1) drawHighlight now dual-pass over the same polyline path in one save/restore - multiply @ 0.45 then screen @ 0.3 (multiply keeps light-bg behavior, screen makes strokes visible on dark/black backgrounds; accepted trade-off: slight tint of dark text on light bg). (2) Shift now locks y to the stroke start (horizontal marking, x follows cursor). Reviewer re-APPROVE; pnpm check + 78 tests green. Awaiting user re-verification on Windows.

All ACs verified by the user in pnpm tauri dev on Windows 2026-07-19: freehand marker readable on light bg, visible on dark bg (dual-pass), Shift horizontal lock, select/move/delete/undo/redo, export parity.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-19 00:54
---
User verification 2026-07-19: freehand + light-background behavior good; two changes requested: (1) Shift straight line must lock y (horizontal marking), not free-angle; (2) multiply blending is nearly invisible on dark/black screenshots - needs a rendering approach that works on dark backgrounds too. AC #3 replaced and a dark-background AC added per user decision.
---
<!-- COMMENTS:END -->
