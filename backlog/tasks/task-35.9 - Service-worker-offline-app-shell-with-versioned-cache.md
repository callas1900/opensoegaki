---
id: TASK-35.9
title: 'Service worker: offline app shell with versioned cache'
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
labels:
  - web
dependencies:
  - TASK-35.7
parent_task_id: TASK-35
priority: medium
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add pwa/sw.js (~40 lines, no dependency): stale-while-revalidate for index.html and hashed assets, cache name soegaki-v<APP_VERSION> injected via Vite define, skipWaiting + clients.claim, purge old caches on activate. Never caches user content (screenshots stay in memory only). Register from main-web.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After one online visit the app loads fully offline
- [ ] #2 A version bump replaces the cache and purges the old one
- [ ] #3 No user image data is ever written to Cache Storage
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (final review approved, no blocking). Code-trace verified; remains In Progress until exercised on a real iPhone per the docs/WEB.md smoke-test checklist.
<!-- SECTION:NOTES:END -->
