---
id: TASK-35.11
title: Touch controls for keyboard-only actions
status: Done
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-24 09:57'
labels:
  - web
dependencies:
  - TASK-35.6
parent_task_id: TASK-35
priority: medium
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a delete button visible while a selection exists (replaces Delete/Backspace) and a crop confirm bar with Apply/Cancel while a crop is pending (replaces Enter/Escape). Shown on both desktop and web to keep a single code path. Ctrl+Shift+V clipboard-insert stays desktop-only via capability flag.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On iPhone an annotation can be selected and deleted without a keyboard
- [x] #2 On iPhone a crop can be applied and cancelled without a keyboard
- [x] #3 Desktop keyboard shortcuts keep working unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (final review approved, no blocking). Code-trace verified; remains In Progress until exercised on a real iPhone per the docs/WEB.md smoke-test checklist.

2026-07-24 device verification by user (iPhone): annotation select+delete and crop apply/cancel all work touch-only, no keyboard. Remaining: AC#3 desktop shortcuts (Windows pnpm tauri dev pass).

2026-07-24 Windows verification by user: desktop keyboard shortcuts unchanged (Ctrl+Z/Y/C/S/V/Shift+V, Del, Esc, Enter). All ACs exercised -> Done.
<!-- SECTION:NOTES:END -->
