---
id: TASK-19
title: Make background replacement (paste/capture) undoable
status: To Do
assignee: []
created_date: '2026-07-14 03:25'
updated_date: '2026-07-14 03:41'
labels:
  - feature
dependencies: []
priority: medium
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pasting or capturing over an existing document silently discards the previous image and annotations. Instead of a confirm() dialog (rejected: modal on the hot Ctrl+V path), push the current {background, annotations} state onto the undo history before setBackground so Ctrl+Z restores a replaced screenshot. Architect ruling 2026-07-14 during TASK-17/18 implementation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ctrl+Z after paste/capture restores the previous background image and its annotations
- [ ] #2 Redo re-applies the replacement
- [ ] #3 No confirmation dialog is shown on paste or capture
<!-- AC:END -->
