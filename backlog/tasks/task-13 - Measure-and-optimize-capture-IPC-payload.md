---
id: TASK-13
title: Measure and optimize capture IPC payload
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
labels:
  - performance
dependencies: []
priority: low
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Captures travel as base64 strings in Tauri events (capture_and_emit in src-tauri/src/lib.rs) - heavy for 4K screens. Measure first; if slow, switch to binary payloads or a temp-file handoff.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Latency measured for a 4K capture and recorded in the task
- [ ] #2 If above ~100ms, an optimized transport is implemented
<!-- AC:END -->
