---
id: TASK-35.17
title: 'Web share bar: Share button instead of Save'
status: Done
assignee: []
created_date: '2026-07-22 06:07'
updated_date: '2026-07-24 09:57'
labels:
  - web
dependencies: []
parent_task_id: TASK-35
priority: medium
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User feedback: on web the export action should present as iOS sharing, not saving. io.savePng already prefers navigator.share({files}) on secure contexts (local HTTP preview fell back to download — environmental, works on Pages/HTTPS). Change the web shell (pwa/index.html) button label/icon/title to Share with an SVG consistent with the icon set; keep the download fallback for non-share browsers; desktop keeps Save unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Web build shows a Share-labeled/iconed button where desktop shows Save
- [x] #2 On iOS Safari over HTTPS the button opens the share sheet
- [x] #3 Desktop share bar is unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Share-sheet bug found in device testing: iOS shares title text instead of the file when share payload contains both. Fixed by passing files-only payload (web.ts savePng); filename travels with the File object. Rebuilt and re-served via HTTPS tunnel for re-test. Copy button confirmed working on iPhone by user.

2026-07-24 device verification by user: Share button visible on iPhone web build and opens the iOS share sheet (AC#1, AC#2 checked). AC#3 (desktop share bar unchanged) remains for the Windows pnpm tauri dev pass.

2026-07-24 Windows verification by user: desktop share bar unchanged (Save/Copy/drag-out). All ACs exercised -> Done.
<!-- SECTION:NOTES:END -->
