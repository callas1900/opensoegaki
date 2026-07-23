---
id: TASK-42
title: 'Select tool: rubber-band (marquee) selection and shift-click multi-select'
status: To Do
assignee: []
created_date: '2026-07-23 17:29'
labels: []
dependencies: []
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the select tool with multi-selection. Dragging on empty canvas with the select tool draws a rubber-band rectangle and selects all annotations it covers. Shift+click adds/removes individual annotations to/from the current selection. Operations on a multi-selection (move, delete — and resize/rotate where defined) apply to all selected annotations as a group. Builds on TASK-8 (selection tool) and must not regress single-selection behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dragging from an empty area with the select tool shows a marquee rectangle and selects the annotations within it on release
- [ ] #2 Shift+click toggles an annotation in and out of the current selection
- [ ] #3 Multi-selection is visually indicated (each selected annotation or a combined bounding box)
- [ ] #4 Move and delete apply to every annotation in the multi-selection, and are undoable as one step
- [ ] #5 Plain click behavior (single select, deselect on empty click) is unchanged
<!-- AC:END -->
