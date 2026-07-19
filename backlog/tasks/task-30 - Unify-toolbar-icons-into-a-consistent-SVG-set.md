---
id: TASK-30
title: Unify toolbar icons into a consistent SVG set
status: Done
assignee: []
created_date: '2026-07-19 14:47'
updated_date: '2026-07-19 14:52'
labels:
  - ux
dependencies: []
priority: medium
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User feedback 2026-07-19: toolbar icons look uneven ('ガタガタ'). Root cause: mixed emoji/text glyphs (⛶ ⬚ ➤ ▭ T ✎ ① ↩ ↪) and stroke SVGs (insert-image, crop) with differing visual sizes, weights and baselines. Replace all glyph toolbar buttons with inline stroke SVGs matching the two existing ones (24 viewBox, 18px, stroke-width 2, currentColor, round caps/joins) and center button content with flex.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every toolbar button icon is an inline stroke SVG with identical size (18px) and stroke width; no emoji/text glyph icons remain in the toolbar (size letter and color chip stay as value displays)
- [x] #2 Icons are vertically and horizontally centered in their buttons; the row reads as one consistent set
- [x] #3 All toolbar buttons keep working (tool switching, capture, insert, undo/redo, popovers)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-19: all 9 glyph buttons (capture/select/arrow/rect/text/highlight/badge/undo/redo) replaced with inline stroke SVGs matching the existing insert-image/crop style (24 viewBox, 18px, stroke-width 2, currentColor); #toolbar button got inline-flex centering; .tool svg rule replaced by '#toolbar button svg { display: block }'. Verified in the running Windows app via screenshots: row renders as one consistent set; clicking the rect SVG switches the active tool (click-through SVG children proven); color popover opens with all 8 swatches under its trigger. Reviewer APPROVE incl. TASK-26 AC regression pass (popovers are #toolbar siblings so the new CSS does not leak; popover.ts uses contains() so SVG-child clicks dismiss correctly). pnpm check green. Nit for future: icon-only buttons rely on title for accessible names; aria-label pattern-wide cleanup could be a follow-up.
<!-- SECTION:NOTES:END -->
