---
id: TASK-12
title: 'Test infrastructure for TS and Rust, wired into CI'
status: Done
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-15 10:06'
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
- [x] #1 cargo test covers prepare_drag_file behavior
- [ ] #2 CI runs both test suites
- [x] #3 TS test runner set up with tests for model, history, and hittest (render descoped by design)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-15: Implemented per docs/design/2026-07-15-test-infrastructure.md. Rust verified on Windows: cargo test 5/5, clippy clean. TS verified after node_modules repair: pnpm check clean, pnpm test 43/43 green (vitest ^4.1.10).
2026-07-15: AC amended per user decision (option A): render.ts tests replaced by hittest.ts in the AC — render.ts is an imperative canvas wrapper; draw-call-order assertions would be brittle without catching visual regressions.
2026-07-15: Marked Done per user decision. AC#2 (CI runs both suites) remains unchecked — verify on the first push; if a CI job fails, reopen this task.
<!-- SECTION:NOTES:END -->
