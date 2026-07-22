---
id: TASK-35.8
title: 'PWA manifest, icons, iOS meta and install hint'
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
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add pwa/manifest.webmanifest (standalone display, relative start_url/scope, maskable 192/512 icons), apple-touch-icon 180, theme-color, viewport-fit=cover meta, apple-mobile-web-app-* meta. One-time iOS-only hint explaining Add to Home Screen via the Share sheet (iOS has no beforeinstallprompt).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 App installs to the iOS home screen and launches standalone (no Safari chrome)
- [ ] #2 Install hint appears once on iOS Safari and can be dismissed permanently
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (final review approved, no blocking). Code-trace verified; remains In Progress until exercised on a real iPhone per the docs/WEB.md smoke-test checklist.
<!-- SECTION:NOTES:END -->
