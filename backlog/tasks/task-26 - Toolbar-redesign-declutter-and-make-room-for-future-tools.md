---
id: TASK-26
title: 'Toolbar redesign: declutter and make room for future tools'
status: In Progress
assignee: []
created_date: '2026-07-19 01:11'
updated_date: '2026-07-19 03:49'
labels: []
dependencies: []
priority: medium
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The single-row toolbar has grown cluttered: capture, 7 tool buttons, undo/redo, 8 palette swatches, S/M/L sizes all in one row. Upcoming features (TASK-20 image insert, TASK-16 blur tool etc.) will add more. Redesign the toolbar layout/grouping so current tools fit cleanly and future annotation tools have room. Design via architect; direction to be chosen by the user before implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Color popover holds the 8 swatches; trigger chip always shows the current color; size popover holds S/M/L; trigger shows the current letter; both close on selection
- [ ] #2 Popover behavior: only one open at a time; click-outside closes; a dismiss press on the canvas does not draw/place an annotation; Escape closes the popover with priority over crop-cancel/selection-clear; permission modal renders above popovers
- [ ] #3 Narrow windows wrap the toolbar to a second line with all controls reachable; popovers anchor under their wrapped trigger
- [ ] #4 Capture button remains in the toolbar and works (TASK-18 AC)
- [ ] #5 At normal width the toolbar is a single row: flat capture, select/arrow/rect/text/highlight/badge/crop tools, undo/redo, color chip, size letter (no overflow button)
- [ ] #6 Crop works exactly as before from its flat button (TASK-4 ACs: activation, floating apply/cancel, Enter/Esc)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-19 per architect Option A spec (user-chosen direction): new src/ui/popover.ts (minimal popover manager: single-open, capture-phase outside-press dismissal with canvas-press swallowing, resize/scroll close, edge clamping); crop moved to overflow flyout; palette/sizes moved into color/size popovers with current-value trigger buttons; toolbar wraps at narrow widths; Escape priority modal > text edit > popover > crop/selection. Reviewer APPROVE incl. AC regression pass (TASK-4/7/8/9/17/18/19/21/22 all PASS, every main.ts selector verified against the new DOM). pnpm check + 78 tests green. Awaiting manual AC pass in pnpm tauri dev on Windows.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-19 03:49
---
User decision 2026-07-19: collapsing color/size freed enough room - drop the overflow (...) flyout and keep crop as a flat toolbar button. Popover machinery stays for color/size (and future flyouts).
---
<!-- COMMENTS:END -->
