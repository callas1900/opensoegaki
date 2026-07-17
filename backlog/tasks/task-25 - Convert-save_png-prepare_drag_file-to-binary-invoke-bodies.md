---
id: TASK-25
title: Convert save_png / prepare_drag_file to binary invoke bodies
status: To Do
assignee: []
created_date: '2026-07-17 07:28'
labels:
  - performance
dependencies: []
priority: low
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TS→Rust image transfers still use Array.from(Uint8Array) JSON number arrays (src/main.ts save/drag handlers → save_png / prepare_drag_file in src-tauri/src/lib.rs), which is heavier than the base64 the capture path just dropped (TASK-13 Phase 2). Latency-noncritical (gated behind a dialog/drag) so it was deferred. Needs its own small design: Tauri 2 raw invoke bodies (tauri::ipc::Request / InvokeBody::Raw) with the extra arg (default_name) moved to headers or a separate arg channel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 save_png and prepare_drag_file receive raw bytes (no JSON number arrays) and both save and drag-out still work E2E on Windows
<!-- AC:END -->
