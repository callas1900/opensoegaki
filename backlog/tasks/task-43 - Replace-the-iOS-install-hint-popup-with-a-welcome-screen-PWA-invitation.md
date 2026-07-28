---
id: TASK-43
title: Replace the iOS install-hint popup with a welcome-screen PWA invitation
status: Done
assignee: []
created_date: '2026-07-27 07:08'
updated_date: '2026-07-28 14:01'
labels:
  - web
dependencies: []
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retire the one-time floating install hint (#install-hint) from the web shell and instead invite the user to install the app from the welcome screen: an understated line under the Choose Photo button, shown in every browser and hidden only when already running standalone. Removes the localStorage dismissal state, the badge-bar suppression rule and the phone-landscape media query the fixed card needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No install popup exists in any shell or viewport (no #install-hint markup, CSS, JS or storage key)
- [x] #2 The invitation disappears together with the welcome screen once an image is loaded
- [x] #3 The web welcome screen shows a PWA install invitation in portrait, and hides it when the app runs standalone
- [x] #4 The invitation never overlaps the share bar; the Choose Photo CTA is fully visible without scrolling at every supported viewport; the version line is never unreachable - it is either visible or reachable by scrolling the empty-state stage; below a 500px viewport height the invitation is suppressed instead
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-29: device-verified on a real iPhone against the deployed Pages URL (v0.2.0/v0.2.1). AC#1 - confirmed no #install-hint markup/CSS/JS/storage key exists anywhere. AC#2 - the invitation disappears together with the rest of the welcome screen once a photo is loaded. AC#3 - shown in Safari portrait, hidden when launched standalone from the home screen. AC#4 (amended 2026-07-28) - the invitation never overlaps the share bar, the Choose Photo CTA stayed fully visible without scrolling at every tested orientation, and the version line was either visible outright or reachable with a short scroll (confirmed at the tightest portrait viewport); below 500px height in landscape the invitation was suppressed as expected. This closes out the wrap-threshold fragility discovered via the v0.2.0 CI failure and fixed via TASK-44's scrollable-empty-state change.
<!-- SECTION:NOTES:END -->
