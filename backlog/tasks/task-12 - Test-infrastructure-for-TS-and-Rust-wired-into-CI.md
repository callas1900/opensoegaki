---
id: TASK-12
title: 'Test infrastructure for TS and Rust, wired into CI'
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
labels:
  - testing
dependencies: []
priority: medium
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Zero automated tests today; CI only runs typecheck/lint. Add unit tests for src/editor/{model,history,render}.ts (runner choice, likely Vitest, to be confirmed by architect under the keep-it-light rule) and Rust unit tests for capture.rs / prepare_drag_file, then add test jobs to .github/workflows/ci.yml.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TS test runner set up with tests for model, history, and render
- [ ] #2 cargo test covers prepare_drag_file behavior
- [ ] #3 CI runs both test suites
<!-- AC:END -->
