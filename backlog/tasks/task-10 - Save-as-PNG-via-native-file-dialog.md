---
id: TASK-10
title: Save as PNG via native file dialog
status: Done
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-15 03:12'
labels:
  - editor
dependencies: []
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Export is only reachable via drag-out or clipboard. Add Save-as using a native dialog (Tauri dialog plugin or a custom command - challenge the new dependency per CLAUDE.md keep-it-light rule).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ctrl+S / toolbar button opens a native save dialog and writes the exported PNG
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User-verified E2E on Windows 2026-07-15: native save dialog via Ctrl+S and Save button writes annotated PNG; Ctrl+S inert mid-edit. Done per AC-regression policy.
<!-- SECTION:NOTES:END -->
