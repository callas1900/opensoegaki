---
id: TASK-35.1
title: Define PlatformIO interface and Capabilities flags
status: Done
assignee: []
created_date: '2026-07-21 17:42'
updated_date: '2026-07-21 17:56'
labels:
  - web
dependencies: []
parent_task_id: TASK-35
priority: high
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add src/platform/io.ts: PlatformIO interface (pickImage, savePng, copyPng, optional captureBackground/readClipboardImage/beginDragOut/onExternalImageDrop/openCapturePermissionSettings) plus a Capabilities flag set (capture, pickImage, savePng, copyPng, readClipboardImage, dragOut). Each member documents the desktop operation it replaces. Contract source: docs/WEB.md design note.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm check passes with the new module
- [ ] #2 Every PlatformIO member has a doc comment naming the desktop op it replaces
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and verified: pnpm check passes; every member documents the desktop op it replaces. Reviewer approved (code-trace).
<!-- SECTION:NOTES:END -->
