---
id: TASK-39
title: 'UI review hardening: checklist + Playwright smoke tests'
status: In Progress
assignee: []
created_date: '2026-07-23 03:11'
updated_date: '2026-07-23 03:21'
labels:
  - process
  - testing
dependencies: []
priority: high
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to TASK-38: the reviewer APPROVEd UI work by code-trace only, missing two iPhone-visible bugs (digit grid overflowing a 210px panel: 5x40 + 4x6 = 224px > 198px effective; iOS soft keyboard firing resize/scroll which the popover manager treats as dismiss). Two-part fix, user-approved 2026-07-23:
1. CLAUDE.md review rules: UI reviews must (a) re-do the arithmetic on fixed-dimension containers, (b) audit global resize/scroll/focus handlers against iOS soft-keyboard events, (c) state verification scope in every verdict - APPROVE (code-trace only) / (browser-verified) / (device-verified), (d) run the Playwright iPhone-viewport smoke before sign-off on UI diffs.
2. Playwright (@playwright/test, WebKit, iPhone 14 viewport 390x844 DPR3 hasTouch) smoke suite in tests/e2e/, test:e2e script, wired into the ubuntu web CI job (build:web -> playwright install webkit -> test:e2e). Local runs go through powershell.exe (WSL cannot run this repo's toolchain).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLAUDE.md documents the UI review checklist including mandatory verification-scope labels on verdicts
- [ ] #2 Playwright smoke suite runs in CI (ubuntu web job) against the built web bundle with a WebKit iPhone viewport
- [x] #3 Smoke tests cover: popover content containment (overflow regression), popover survives a resize while its input is focused (keyboard regression), digit/auto tap closes the popover
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-23. Playwright 1.61.1 (WebKit, iPhone-14-like 390x844 DPR3 touch) with webServer=preview:web on port 4173; 3 smoke tests green locally via powershell. CI: frontend job now runs build:web -> playwright install --with-deps webkit -> test:e2e. CLAUDE.md rule 5 (UI review checklist incl. mandatory verification-scope labels) added by the main session per the user-approved plan (implementer correctly declined to edit CLAUDE.md without direct user signal). AC #2 stays unchecked until the CI job actually runs green on GitHub.
<!-- SECTION:NOTES:END -->
