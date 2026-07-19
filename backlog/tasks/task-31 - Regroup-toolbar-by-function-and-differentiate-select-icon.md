---
id: TASK-31
title: Regroup toolbar by function and differentiate select icon
status: Done
assignee: []
created_date: '2026-07-19 15:01'
updated_date: '2026-07-19 15:04'
labels:
  - ux
dependencies: []
priority: medium
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User feedback 2026-07-20: toolbar buttons are scattered across categories (capture=intake, insert-image/arrow/rect/text/highlight/badge=annotation, select/crop/undo/redo=editing, color/size=annotation settings). Regroup into: capture | annotation tools (arrow, rect, text, highlight, badge, insert-image) | color+size | select, crop, undo, redo — separated by the existing .sep dividers. Also: select and arrow icons are too similar; change select to a dashed-marquee rectangle. Supersedes TASK-26 AC#5 button order (user decision recorded there).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Toolbar order is: capture | arrow, rect, text, highlight, badge, insert-image | color, size | select, crop, undo, redo, with separators between the four groups
- [x] #2 Select tool icon is a dashed selection marquee, clearly distinct from the arrow tool icon
- [x] #3 All buttons keep working after the reorder (tool switching, popovers anchored under their moved triggers, undo/redo, capture, insert)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + verified 2026-07-20 in the running Windows app via screenshot/click probes: toolbar regrouped to capture | arrow/rect/text/highlight/badge/insert-image | color/size | select/crop/undo/redo (3 seps); select icon replaced with dashed marquee rect (stroke-dasharray 3.5 3), clearly distinct from the arrow tool. Click on relocated select button switches the active tool; color popover anchors under its relocated trigger. Markup-only reorder (ids/data-tool/handlers untouched, all id-bound in main.ts), pnpm check green — judged trivial, formal reviewer round skipped. TASK-26 AC#5 supersession recorded in TASK-26 notes.
<!-- SECTION:NOTES:END -->
