---
id: TASK-35.14
title: Large-image import clamp for iOS canvas limits
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 04:08'
labels:
  - web
dependencies:
  - TASK-35.6
parent_task_id: TASK-35
priority: medium
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In the shared background/insert path, downscale imported images whose longest side exceeds ~4096 px (value to confirm on a real device) before use, to avoid iOS canvas memory limits blanking the canvas with 12 MP photos. Applies on both platforms for a single code path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Importing a 12 MP photo on iPhone does not blank the canvas
- [ ] #2 Desktop imports still work within the same clamp
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Web-only clamp implemented per user decision + architect Option A: PlatformIO.maxImportDimension (tauri null / web 4096), Editor field injected by bootstrapEditor, null short-circuits all OffscreenCanvas work. Desktop verified byte-for-byte pre-clamp on all six decode routes; reviewer approved with no findings. 130/130 tests. Remains In Progress until the 12MP-photo AC is exercised on a real iPhone.
<!-- SECTION:NOTES:END -->
