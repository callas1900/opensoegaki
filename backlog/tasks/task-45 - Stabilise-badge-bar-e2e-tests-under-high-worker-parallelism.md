---
id: TASK-45
title: Stabilise badge-bar e2e tests under high worker parallelism
status: To Do
assignee: []
created_date: '2026-07-27 08:35'
labels:
  - web
dependencies: []
priority: low
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during the TASK-43 review: two tests in tests/e2e/badge-bar.spec.ts — 'no digit overflows the bar' (line 262) and 'open bar rescales a loaded image and closing restores it' (line 286) — intermittently time out on boundingBox() when Playwright runs at its default worker count (8 on this machine), and pass reliably at --workers=2 or 3. Pre-existing and unrelated to TASK-43; the cause is load-induced timing, not a product bug. playwright.config.ts sets fullyParallel: true with no worker cap, so a small CI runner can surface this as intermittent red on an untouched spec. Decide between capping workers in playwright.config.ts, giving the two layout-measuring tests more generous expect timeouts, or making them wait on a settled condition instead of an immediate boundingBox() call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The full Playwright suite passes repeatedly at the default worker count on a loaded machine (verify with several consecutive runs, not one)
- [ ] #2 The chosen fix does not weaken what the two tests assert - the digit-overflow and image-rescale measurements still fail when the layout actually regresses
<!-- AC:END -->
