---
id: TASK-33
title: Per-color step numbering mode for badges
status: To Do
assignee: []
created_date: '2026-07-20 06:32'
labels:
  - feature
dependencies: []
priority: medium
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend TASK-22 badges with a document-level numbering mode toggle: 'mixed' (current behavior — one 1..N sequence across all badges regardless of color) and 'per-color' (each palette color gets its own independent 1..N sequence). Switching the mode renumbers all existing badges to match the selected scheme. In per-color mode, placing a badge uses the next number of the current palette color's sequence, and deleting a badge renumbers only that color's sequence. Current mixed behavior must remain available as the default mode. Touches nextBadgeNumber/renumberBadges in src/editor/model.ts and needs a small toolbar UI for the mode toggle (architect: where it lives after the TASK-26/31 toolbar regroup).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A document-level toggle switches badge numbering between mixed (current, default) and per-color modes
- [ ] #2 In per-color mode each color's badges number 1..N independently; deleting a badge renumbers only that color's sequence
- [ ] #3 Switching modes renumbers existing badges accordingly and is undoable
- [ ] #4 Mixed mode behaves exactly as today (TASK-22 ACs keep passing)
- [ ] #5 Exported PNG reflects the numbers as displayed
<!-- AC:END -->
