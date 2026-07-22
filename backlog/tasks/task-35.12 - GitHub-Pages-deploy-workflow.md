---
id: TASK-35.12
title: GitHub Pages deploy workflow
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 08:32'
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
- [ ] #1 Pushing a release tag (v*) publishes the site to the GitHub Pages URL
- [ ] #2 A push to main without a tag does not trigger the workflow
- [ ] #3 workflow_dispatch still allows a manual deploy
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC changed by user decision 2026-07-22: Pages deploys on release tags (v*, same trigger as release.yml) instead of path-filtered main pushes — web and desktop release together from one tag, and every deploy bumps __APP_VERSION__, which keys the SW cache purge. Workflow implemented (upload-pages-artifact@v4 verified; .nojekyll intentionally omitted). Remains In Progress until the first real tag deploys. Requires repo Settings > Pages > Source = GitHub Actions.
<!-- SECTION:NOTES:END -->
