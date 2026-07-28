---
id: TASK-35.12
title: GitHub Pages deploy workflow
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
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add .github/workflows/pages.yml: trigger on push to main filtered to web paths (src/**, pwa/**, vite.config.web.ts, package.json, pnpm-lock.yaml, the workflow file) plus workflow_dispatch. Steps: pnpm/action-setup, setup-node with pnpm cache, pnpm install --frozen-lockfile, pnpm build:web, actions/upload-pages-artifact on dist-web (.nojekyll), actions/deploy-pages. permissions pages:write + id-token:write, concurrency group. Existing ci.yml untouched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pushing a release tag (v*) publishes the site to the GitHub Pages URL
- [x] #2 A push to main without a tag does not trigger the workflow
- [x] #3 workflow_dispatch still allows a manual deploy
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-29 (as v0.2.0/v0.2.1): first real tag deploy completed. GitHub's github-pages environment initially blocked the v0.2.0 tag ref with a default deployment-branch protection rule (error: "Tag v0.2.0 is not allowed to deploy to github-pages due to environment protection rules") - fixed via Settings > Environments > github-pages > Deployment branches and tags > added a Tag rule for v* pattern. After that, v0.2.0 deployed the Pages site (AC#1), a push to main without a tag confirmed no Pages run fires (AC#2), workflow_dispatch was run manually and succeeded (AC#3). v0.2.1 tag deployed cleanly afterward with no further protection-rule issue, confirming the fix is durable. All three ACs verified against the real repo/Actions, not just code-trace.
<!-- SECTION:NOTES:END -->
