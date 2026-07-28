---
id: TASK-35.8
title: 'PWA manifest, icons, iOS meta and install hint'
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
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add pwa/manifest.webmanifest (standalone display, relative start_url/scope, maskable 192/512 icons), apple-touch-icon 180, theme-color, viewport-fit=cover meta, apple-mobile-web-app-* meta. iOS has no beforeinstallprompt, so the app also has to tell the user how to install: originally a one-time popup hint, replaced by a static welcome-screen invitation in TASK-43 (2026-07-27).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 App installs to the iOS home screen and launches standalone (no Safari chrome)
- [x] #2 The web build invites the user to install to the home screen from the welcome screen, without a popup
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-29: device-verified on a real iPhone against the deployed Pages URL. AC#1 - Add to Home Screen from the Safari share sheet installs the app and it launches standalone (no Safari chrome), confirming the manifest.webmanifest (standalone display, relative start_url/scope), apple-touch-icon and apple-mobile-web-app-* meta are all correctly wired. AC#2 (rewritten 2026-07-27 per TASK-43, further amended 2026-07-28 for reachability-not-visibility) - the welcome-screen invitation is visible in Safari in portrait, absent when launched standalone, and reachable via a short scroll on the tightest viewports without needing an unscrolled pixel-perfect fit (see TASK-43/TASK-44 notes for the scrollable-empty-state fix that this final verification also covers).
<!-- SECTION:NOTES:END -->
