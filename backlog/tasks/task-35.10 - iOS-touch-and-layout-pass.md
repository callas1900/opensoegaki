---
id: TASK-35.10
title: iOS touch and layout pass
status: In Progress
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-22 03:59'
labels:
  - web
dependencies:
  - TASK-35.6
parent_task_id: TASK-35
priority: medium
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
touch-action:none on stage/canvas, overscroll-behavior none, user-select none, maximum-scale=1, 100dvh layout with env(safe-area-inset-*) padding. Replace e.detail>=2 double-click text re-edit with a pointer-based double-tap detector in canvas.ts (additive; desktop dblclick keeps working). Keep the inline text input visible above the soft keyboard via visualViewport resize/scroll handling.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Drawing on iPhone never scrolls or zooms the page
- [ ] #2 Double-tap re-opens text editing on iPhone; double-click still works on desktop
- [ ] #3 Inline text input is never hidden by the iOS keyboard
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (final review approved, no blocking). Code-trace verified; remains In Progress until exercised on a real iPhone per the docs/WEB.md smoke-test checklist.
<!-- SECTION:NOTES:END -->
