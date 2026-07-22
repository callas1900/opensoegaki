---
id: TASK-35.2
title: Extract createTauriIO into src/platform/tauri.ts
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-21 17:56'
labels:
  - web
dependencies:
  - TASK-35.1
parent_task_id: TASK-35
priority: high
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move every Tauri call out of src/main.ts behavior-identically: invoke(capture_fullscreen/pick_image/read_image_file/save_png/prepare_drag_file/open_screen_recording_settings), plugin-clipboard writeImage/readImage, startDrag, onDragDropEvent. No behavior change on desktop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No @tauri-apps or @crabnebula import remains outside src/platform/tauri.ts
- [ ] #2 Capture, pick image, save, copy, paste-insert, drag-out, drag-drop and macOS permission flow all work unchanged in pnpm tauri dev on Windows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented; pnpm check + 120 vitest tests + pnpm build pass (Windows via powershell interop). Reviewer approved with nits (no blocking). Remains In Progress until desktop runtime ACs are exercised in pnpm tauri dev on Windows (user-assisted).
<!-- SECTION:NOTES:END -->
