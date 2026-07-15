---
id: TASK-7
title: Replace window.prompt() text input with in-canvas editing
status: Done
assignee: []
created_date: '2026-07-12 02:44'
updated_date: '2026-07-15 03:12'
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
- [x] #1 Clicking with the text tool opens an inline editor at the click position
- [x] #2 Enter commits, Esc cancels; committed text renders identically to preview
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User-verified E2E on Windows 2026-07-15 (pnpm tauri dev): inline typing, Enter/Esc, preview parity, text paste into editor, image paste mid-edit, drag-out with pending text. Done per AC-regression policy.
<!-- SECTION:NOTES:END -->
