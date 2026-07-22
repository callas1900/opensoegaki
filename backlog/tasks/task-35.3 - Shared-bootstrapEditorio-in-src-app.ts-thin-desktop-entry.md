---
id: TASK-35.3
title: Shared bootstrapEditor(io) in src/app.ts; thin desktop entry
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-21 17:56'
labels:
  - web
dependencies:
  - TASK-35.2
parent_task_id: TASK-35
priority: high
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Move all platform-neutral wiring from main.ts into src/app.ts bootstrapEditor(io: PlatformIO): tool buttons, palette/size popovers, undo/redo, keyboard shortcuts, window paste listener, copy/save/insert routed through io. src/main.ts becomes bootstrapEditor(createTauriIO()) plus desktop-only capture button and permission modal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Desktop behavior is identical before/after
- [ ] #2 AC regression pass: all Done desktop task ACs re-verified in pnpm tauri dev on Windows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented; pnpm check + 120 vitest tests + pnpm build pass (Windows via powershell interop). Reviewer approved with nits (no blocking). Remains In Progress until desktop runtime ACs are exercised in pnpm tauri dev on Windows (user-assisted).
<!-- SECTION:NOTES:END -->
