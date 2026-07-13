---
id: TASK-2
title: Install dependencies and get a clean build baseline
status: To Do
assignee: []
created_date: '2026-07-12 02:44'
labels:
  - foundation
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The project has never been built in this working copy (no node_modules, no target/). Run pnpm install, pnpm check, and cargo fmt --check + cargo clippy inside src-tauri/, fixing anything that fails.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm check passes
- [ ] #2 cargo fmt --check and cargo clippy pass with no warnings (-D warnings, same as CI)
<!-- AC:END -->
