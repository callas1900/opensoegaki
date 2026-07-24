---
id: TASK-35.10
title: iOS touch and layout pass
status: Done
assignee: []
created_date: '2026-07-21 17:43'
updated_date: '2026-07-24 09:57'
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
- [x] #1 Drawing on iPhone never scrolls or zooms the page
- [x] #2 Double-tap re-opens text editing on iPhone; double-click still works on desktop
- [x] #3 Inline text input is never hidden by the iOS keyboard
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second device fix (2026-07-22): tall-photo canvas overflowed #stage on the user's iOS Safari (bottom crop corners unreachable under the share bar) while Playwright WebKit 26 laid out correctly — version-specific %-max-height mis-resolution for replaced grid items on older Safari. Deterministic fix in main-web.ts: fitCanvasToStage() sets canvas max-width/height in px from #stage's content box (computed padding read at runtime), re-run on resize/orientationchange/visualViewport. Web-only; desktop untouched. Earlier notes: stage padding fix, double-tap + keyboard avoidance confirmed on device.

2026-07-24 device verification by user: double-tap re-opens text editing on iPhone (iPhone half of AC#2). AC#2 stays unchecked until desktop double-click is confirmed in the Windows pnpm tauri dev pass.

2026-07-24 device verification by user (iPhone): drawing never scrolls/zooms the page; inline text input never hidden by the keyboard. iPhone double-tap re-edit already confirmed. Remaining: desktop double-click half of AC#2 (Windows pass).

2026-07-24 Windows verification by user: desktop double-click re-edit works; combined with the 2026-07-24 iPhone confirmations -> all ACs exercised -> Done.
<!-- SECTION:NOTES:END -->
