---
id: TASK-35.8
title: 'PWA manifest, icons, iOS meta and install hint'
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-25 16:34'
labels:
  - web
dependencies:
  - TASK-35.7
parent_task_id: TASK-35
priority: medium
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add pwa/manifest.webmanifest (standalone display, relative start_url/scope, maskable 192/512 icons), apple-touch-icon 180, theme-color, viewport-fit=cover meta, apple-mobile-web-app-* meta. One-time iOS-only hint explaining Add to Home Screen via the Share sheet (iOS has no beforeinstallprompt).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App installs to the iOS home screen and launches standalone (no Safari chrome)
- [x] #2 Install hint appears once on iOS Safari and can be dismissed permanently
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (final review approved, no blocking). Code-trace verified; remains In Progress until exercised on a real iPhone per the docs/WEB.md smoke-test checklist.

2026-07-24 device verification by user: install hint appeared once in iOS Safari and stayed dismissed after reload (AC#2 checked). AC#1 (home-screen install + standalone launch) still pending explicit confirmation.

2026-07-26: install hint restyled to an accent card (bigger text, 44x44 dismiss, tap-anywhere-dismiss) and, per architect decision (Option B), suppressed entirely at max-height: 500px to avoid covering #welcome-pick in phone landscape (844x390 etc.) — no fixed-position card could clear both #share-bar and the CTA simultaneously, and #welcome-pick's y is not constant across viewports. CSS-only, no resize/orientation listener (cf. TASK-38/39). Trade-off: phone-landscape first-run users only see the hint after rotating to portrait; the dismissed-flag/localStorage semantics are unaffected. ACs unchanged.
<!-- SECTION:NOTES:END -->
