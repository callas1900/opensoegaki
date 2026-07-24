---
id: TASK-35.4
title: Capability-gated toolbar buttons via data-cap attributes
status: Done
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-24 09:57'
labels:
  - web
dependencies:
  - TASK-35.3
parent_task_id: TASK-35
priority: high
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add data-cap="<capability>" to capability-specific buttons in index.html (#capture, #copy, #drag-tab, ...). bootstrapEditor hides any element whose capability is false, so both entries share one toolbar wiring path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With a stub IO where capture=false the capture button is hidden
- [x] #2 Desktop (all capabilities true) shows the exact same toolbar as before
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented; pnpm check + 120 vitest tests + pnpm build pass (Windows via powershell interop). Reviewer approved with nits (no blocking). Remains In Progress until desktop runtime ACs are exercised in pnpm tauri dev on Windows (user-assisted).

2026-07-24 device verification by user (iPhone/web IO, capture=false): capture button hidden, toolbar coherent. Remaining: AC#2 desktop toolbar unchanged (Windows pass).

2026-07-24 Windows pnpm tauri dev verification by user: full desktop checklist pass (capture, paste, drawing tools, text edit, select/move/resize/delete, badge fixed-number bar, crop, image insert, export via save/copy/drag-out, new document, clean exit). All ACs exercised -> Done.
<!-- SECTION:NOTES:END -->
