---
id: TASK-35.16
title: Adaptive annotation sizing for large photos
status: Done
assignee: []
created_date: '2026-07-22 06:07'
updated_date: '2026-07-24 09:57'
labels:
  - web
dependencies: []
parent_task_id: TASK-35
priority: high
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User feedback from iPhone testing: on ~4000px iPhone photos the fixed size presets (stroke width, font size, badge radius) render far too small relative to the image. Adapt annotation default sizes to the image dimensions. Desktop behavior must stay unchanged unless the user explicitly accepts a change (import-clamp precedent: desktop untouched). Architect ruling pending; mechanics to follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On an iPhone photo (~4000px long side), newly created arrows/rects/text/badges/highlights are clearly visible at natural screen scale
- [x] #2 Desktop annotation sizes on typical captures are unchanged
- [x] #3 Sizes survive export, undo/redo, and re-editing consistently
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Retuned round 8 per user feedback (baseline 900, cap 6 — new M renders like old L). User confirmed sizing feels right on a real iPhone (2026-07-22). Desktop factor still always 1 (reviewer-traced). Remaining: Windows desktop AC pass.

2026-07-24 device verification by user (iPhone): annotations clearly visible at natural scale on a ~4000px photo. Remaining: AC#2 desktop sizes unchanged, AC#3 export/undo/redo consistency (Windows pass).

2026-07-24 Windows verification by user: desktop annotation sizes unchanged on typical captures; sizes consistent through resize, undo/redo, re-edit and PNG export. All ACs exercised -> Done.
<!-- SECTION:NOTES:END -->
