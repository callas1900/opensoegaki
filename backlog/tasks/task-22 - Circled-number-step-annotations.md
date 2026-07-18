---
id: TASK-22
title: Circled-number step annotations
status: Done
assignee: []
created_date: '2026-07-17 01:48'
updated_date: '2026-07-19 00:53'
labels: []
dependencies: []
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a numbered-badge tool for documenting step-by-step instructions: clicking the canvas places a filled circle containing the next number (1, 2, 3, ...), auto-incrementing per click. Deleting a number renumbers subsequent badges to close the gap (e.g. delete 2 of 1..4 -> remaining become 1,2,3). Badge uses current palette color with contrasting number text; size follows S/M/L presets. New annotation kind in src/editor/model.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A number-badge tool exists in the toolbar; each click places a circle with the next number in sequence
- [x] #2 Deleting a badge renumbers later badges so the sequence stays contiguous (1..n without gaps)
- [x] #3 Badges are selectable, movable, deletable, and undo/redo works (including renumbering)
- [x] #4 Badge color follows the selected palette color and size follows S/M/L presets
- [x] #5 Exported PNG includes the badges as rendered
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-19 (batched with TASK-21, architect design + implementer + reviewer APPROVE). New 'badge' annotation kind: at/number/radius, radius presets S14/M20/L28, contrastText for number color, renumberBadges inside deleteSelected's single history push (atomic undo). pnpm check + 78 vitest tests green. All ACs verified by the user in pnpm tauri dev on Windows 2026-07-19: click auto-increment, delete renumbering, move/undo/redo, palette+S/M/L, export.
<!-- SECTION:NOTES:END -->
