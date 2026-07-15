---
id: TASK-11
title: Multi-monitor capture support
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-15 06:18'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-15: Won't Do. Decision: multi-monitor capture support is not needed. Rationale: since TASK-17 made OS snipping tool (Win+Shift+S) + clipboard paste the core capture workflow, multi-monitor and mixed-DPI cases are fully handled by the OS. The in-app capture button is a convenience that captures the primary monitor only; full-screen capture involves no coordinate mapping, so nothing breaks on multi-monitor setups. If ever needed, xcap Monitor::from_point() allows a cheap 'capture the monitor under the app window' follow-up. Same rationale as the TASK-4 deprioritization.
<!-- SECTION:NOTES:END -->
