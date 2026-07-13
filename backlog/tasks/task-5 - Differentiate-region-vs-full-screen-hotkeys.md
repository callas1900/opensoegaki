---
id: TASK-5
title: Differentiate region vs full-screen hotkeys
status: To Do
assignee: []
created_date: '2026-07-12 02:44'
labels:
  - mvp
dependencies:
  - TASK-4
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Both shortcuts currently run the identical full-screen path (src-tauri/src/lib.rs:61 handler ignores which shortcut fired). Route Ctrl+Shift+5 into the region overlay flow and keep Ctrl+Shift+6 as direct full-screen capture.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ctrl+Shift+5 triggers region flow, Ctrl+Shift+6 triggers full-screen flow
<!-- AC:END -->
