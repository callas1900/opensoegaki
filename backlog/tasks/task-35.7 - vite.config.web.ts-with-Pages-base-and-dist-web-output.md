---
id: TASK-35.7
title: vite.config.web.ts with Pages base and dist-web output
status: Done
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
labels:
  - web
dependencies:
  - TASK-35.6
parent_task_id: TASK-35
priority: high
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add vite.config.web.ts: root pwa/, build.outDir ../dist-web, base from PAGES_BASE env defaulting to /opensoegaki/. Add package.json scripts build:web (tsc --noEmit && vite build --config vite.config.web.ts) and preview:web. Desktop vite.config.ts stays untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm build:web emits dist-web/index.html with assets resolved under the configured base
- [ ] #2 pnpm build still emits dist/ unchanged for Tauri (frontendDist intact)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ACs exercised: pnpm build:web emits dist-web with /opensoegaki/ base (verified in output + preview fetch); pnpm build still emits dist/ unchanged. Reviewer approved.
<!-- SECTION:NOTES:END -->
