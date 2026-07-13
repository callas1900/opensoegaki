---
id: TASK-7
title: Replace window.prompt() text input with in-canvas editing
status: To Do
assignee: []
created_date: '2026-07-12 02:44'
labels:
  - editor
dependencies: []
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Text tool currently uses window.prompt (src/editor/canvas.ts onDown). Replace with an in-canvas positioned text input/overlay: type at the click point, commit on Enter/blur, style preview matches the final rendering.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Clicking with the text tool opens an inline editor at the click position
- [ ] #2 Enter commits, Esc cancels; committed text renders identically to preview
<!-- AC:END -->
