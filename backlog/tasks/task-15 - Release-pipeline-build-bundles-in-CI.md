---
id: TASK-15
title: 'Release pipeline: build bundles in CI'
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
labels:
  - platform
dependencies: []
priority: low
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CI only lints today. Add a workflow (tag-triggered) running pnpm tauri build to produce NSIS/MSI artifacts, plus a version-bump flow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tagged release produces installable Windows bundles as CI artifacts
<!-- AC:END -->
