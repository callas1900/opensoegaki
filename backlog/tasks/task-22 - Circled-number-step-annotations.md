---
id: TASK-22
title: Circled-number step annotations
status: To Do
assignee: []
created_date: '2026-07-17 01:48'
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
- [ ] #1 A number-badge tool exists in the toolbar; each click places a circle with the next number in sequence
- [ ] #2 Deleting a badge renumbers later badges so the sequence stays contiguous (1..n without gaps)
- [ ] #3 Badges are selectable, movable, deletable, and undo/redo works (including renumbering)
- [ ] #4 Badge color follows the selected palette color and size follows S/M/L presets
- [ ] #5 Exported PNG includes the badges as rendered
<!-- AC:END -->
