---
id: TASK-11
title: Multi-monitor capture support
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
labels:
  - editor
dependencies: []
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
capture_primary_monitor() always uses the primary display (src-tauri/src/capture.rs). Decide behavior (monitor under cursor vs picker vs all) via the architect agent, then implement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Architect design note decides the multi-monitor behavior
- [ ] #2 Capture works correctly on a 2+ monitor setup including mixed DPI
<!-- AC:END -->
