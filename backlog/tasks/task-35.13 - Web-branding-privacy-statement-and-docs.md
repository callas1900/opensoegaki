---
id: TASK-35.13
title: 'Web branding, privacy statement and docs'
status: Done
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-24 09:40'
labels:
  - web
dependencies:
  - TASK-35.12
parent_task_id: TASK-35
priority: medium
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Inject __APP_VERSION__ from package.json into an About/footer line. Add a visible statement that the app runs entirely on-device and images are never uploaded (UI + README). Save the architect design note as docs/WEB.md including the iOS manual test checklist, and update README.md and docs/ARCHITECTURE.md for the web target.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Displayed version matches package.json
- [x] #2 Privacy statement visible in the web UI and in README
- [x] #3 docs/WEB.md exists with design note and iOS manual smoke-test checklist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: version + privacy line in web shell (confirmed in built output), README web section with real Pages URL, ARCHITECTURE.md web section, WEB.md reconciled + iOS smoke checklist. Remains In Progress until visually confirmed in a browser.

2026-07-24 AC#3 verified: docs/WEB.md exists with design note and iOS manual smoke-test checklist (line 280). README privacy statement present (line 67); AC#2 waits only on the in-UI visual confirm, AC#1 on the welcome-screen version readout.

2026-07-24 device verification by user: welcome screen shows privacy statement and 'OpenSoegaki v0.1.2' matching package.json. All ACs exercised → Done.
<!-- SECTION:NOTES:END -->
