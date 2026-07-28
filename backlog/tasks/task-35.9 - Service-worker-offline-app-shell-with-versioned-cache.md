---
id: TASK-35.9
title: 'Service worker: offline app shell with versioned cache'
status: Done
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-28 14:01'
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
- [x] #1 After one online visit the app loads fully offline
- [x] #2 A version bump replaces the cache and purges the old one
- [x] #3 No user image data is ever written to Cache Storage
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-29: device-verified on iPhone Safari against the deployed Pages site. AC#1 - after one online visit at v0.2.0, app loaded fully offline (airplane mode) and remained editable. AC#2 - after the v0.2.1 tag deploy, reload picked up the new version (version line updated to v0.2.1) and DevTools > Application > Cache Storage showed only soegaki-v0.2.1 - the old soegaki-v0.2.0 cache was purged, confirming the activate handler's cache-name-prefix cleanup (pwa/public/sw.js) works across a real version bump, not just in unit/code-trace review. AC#3 - confirmed no user image/PNG data ever appears in Cache Storage; only the app shell keys are cached, per the SW's own-origin/own-scope GET-only fetch handler.
<!-- SECTION:NOTES:END -->
