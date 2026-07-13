---
id: TASK-8
title: 'Selection tool: hit-test, move, delete annotations'
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
labels:
  - editor
dependencies: []
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Annotations cannot be edited after placement. Add a select tool: hit-testing against the object model (src/editor/model.ts), move by drag, delete via Del key. Keep hit-testing logic alongside the pure renderer (src/editor/render.ts) so live canvas and future formats share it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking an annotation selects it with a visible highlight
- [ ] #2 Selected annotation can be moved by drag and deleted with Del, both undoable
<!-- AC:END -->
