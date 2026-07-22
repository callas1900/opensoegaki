---
id: TASK-35.13
title: 'Web branding, privacy statement and docs'
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
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
- [ ] #1 Displayed version matches package.json
- [ ] #2 Privacy statement visible in the web UI and in README
- [ ] #3 docs/WEB.md exists with design note and iOS manual smoke-test checklist
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: version + privacy line in web shell (confirmed in built output), README web section with real Pages URL, ARCHITECTURE.md web section, WEB.md reconciled + iOS smoke checklist. Remains In Progress until visually confirmed in a browser.
<!-- SECTION:NOTES:END -->
