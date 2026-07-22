---
id: TASK-35.5
title: 'createWebIO: file input, Web Share, best-effort clipboard'
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
labels:
  - web
dependencies:
  - TASK-35.1
parent_task_id: TASK-35
priority: high
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add src/platform/web.ts. pickImage via hidden <input type=file accept=image/*> (iOS: photo library/camera/files; null on cancel). savePng via navigator.share({files}) gated on canShare, falling back to <a download> blob URL. copyPng via navigator.clipboard.write(ClipboardItem) feature-detected; capabilities.copyPng=false when unsupported. capture/dragOut/readClipboardImage absent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On iOS Safari picking from Photos loads the image
- [ ] #2 Save opens the share sheet and can save to Photos; falls back to download where share is unavailable
- [ ] #3 Copy either works or the Copy button is hidden (no broken button)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (3 rounds incl. lazy-producer copyPng contract per architect ruling, pick cancel double-fire fix, deferred blob revoke). Remains In Progress until exercised on iOS Safari (photo pick / share sheet / copy).
<!-- SECTION:NOTES:END -->
