---
id: TASK-35.12
title: GitHub Pages deploy workflow
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
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add .github/workflows/pages.yml: trigger on push to main filtered to web paths (src/**, pwa/**, vite.config.web.ts, package.json, pnpm-lock.yaml, the workflow file) plus workflow_dispatch. Steps: pnpm/action-setup, setup-node with pnpm cache, pnpm install --frozen-lockfile, pnpm build:web, actions/upload-pages-artifact on dist-web (.nojekyll), actions/deploy-pages. permissions pages:write + id-token:write, concurrency group. Existing ci.yml untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A push touching web paths publishes the site to the GitHub Pages URL
- [ ] #2 A Rust-only change does not trigger the workflow
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Workflow implemented (upload-pages-artifact@v4 verified to exist; .nojekyll step intentionally omitted — Actions-artifact deploys never run Jekyll). Remains In Progress until the first real push deploys to Pages. Requires repo Settings > Pages > Source = GitHub Actions.
<!-- SECTION:NOTES:END -->
