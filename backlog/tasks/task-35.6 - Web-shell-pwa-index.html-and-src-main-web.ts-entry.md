---
id: TASK-35.6
title: Web shell pwa/index.html and src/main-web.ts entry
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
labels:
  - web
dependencies:
  - TASK-35.4
  - TASK-35.5
parent_task_id: TASK-35
priority: high
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add pwa/index.html reusing the shared toolbar markup and importing ../src/main-web.ts, which runs bootstrapEditor(createWebIO()). Welcome screen gets a prominent Choose Photo button since capture does not exist on web.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App renders and all editing tools work in a desktop browser via the web entry
- [ ] #2 dist-web bundle contains no @tauri-apps code (grep of build output)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed; dist-web verified free of Tauri code; preview fetch smoke OK. Remains In Progress until editing tools are exercised in a real browser.
<!-- SECTION:NOTES:END -->
