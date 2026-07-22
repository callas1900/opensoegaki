---
id: TASK-35.11
title: Touch controls for keyboard-only actions
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
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
- [ ] #1 On iPhone an annotation can be selected and deleted without a keyboard
- [ ] #2 On iPhone a crop can be applied and cancelled without a keyboard
- [ ] #3 Desktop keyboard shortcuts keep working unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (final review approved, no blocking). Code-trace verified; remains In Progress until exercised on a real iPhone per the docs/WEB.md smoke-test checklist.
<!-- SECTION:NOTES:END -->
