---
id: TASK-9
title: Stroke-width and font-size controls in toolbar
status: Done
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-15 03:12'
labels:
  - editor
dependencies: []
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DEFAULTS in src/editor/model.ts are fixed (strokeWidth 6, fontSize 28). Add toolbar controls so new annotations use the chosen size.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User can pick at least S/M/L stroke width and font size before drawing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User-verified E2E on Windows 2026-07-15: S/M/L presets apply to new arrow/rect/text. Done per AC-regression policy.
<!-- SECTION:NOTES:END -->
