---
id: TASK-35.15
title: 'Web: user-visible error message on iOS < 16.4'
status: To Do
assignee: []
created_date: '2026-07-22 03:56'
labels:
  - web
dependencies: []
parent_task_id: TASK-35
priority: low
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reviewer follow-up from the web-version final review: on iOS Safari below 16.4, OffscreenCanvas.convertToBlob (exporter.ts) and the OffscreenCanvas downscale path fail as a silent console.error the user cannot see. Ship decision: documented 16.4+ floor without a toBlob fallback is acceptable, but a small user-visible 'requires iOS 16.4 or later' message on export/import failure would beat a dead button. Detect once (typeof OffscreenCanvas / convertToBlob) and surface a friendly notice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a browser without OffscreenCanvas.convertToBlob, exporting or importing shows a visible message instead of failing silently
<!-- AC:END -->
