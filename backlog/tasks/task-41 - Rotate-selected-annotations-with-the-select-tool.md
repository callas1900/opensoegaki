---
id: TASK-41
title: Rotate selected annotations with the select tool
status: Done
assignee: []
created_date: '2026-07-23 17:29'
updated_date: '2026-07-27 06:55'
labels: []
dependencies: []
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Allow rotating annotations that are selected with the select tool. Add a rotation handle to the selection UI (typical pattern: a handle above the bounding box, or rotate cursors near the corners). Rotation must be part of the annotation object model (an angle property on shapes) and applied at render time and at export rasterization — never baked into the shape's points. Rotation must be undoable and must compose with move/resize (TASK-8, TASK-29 behavior must keep working).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A selected annotation shows a rotation affordance and can be rotated by dragging it
- [x] #2 Rotation is stored in the object model as data (angle), not by mutating the shape geometry
- [x] #3 Rotated annotations render correctly on canvas and in the exported/copied PNG
- [x] #4 Rotation is undoable/redoable
- [x] #5 Hit-testing, move, and resize still work correctly on a rotated annotation
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-26 per docs/design/2026-07-26-rotate-selected-annotations.md. angle?: number (radians, CW, pivot = unrotated bounds center) on AnnotationBase; rendered via a single pivot transform in renderAnnotations (shared by canvas + exporter, so export is covered); hit-testing inverse-rotates the pointer; resize composes in the unrotated local frame with a re-anchor translation (drift-free, exact no-op at angle 0). Rotatable: rect/image/text/badge. Exempt with recorded rationale: arrow (direction is first-class in from/to; endpoint drag + Shift-45 already rotates it), highlight (same rationale as its TASK-29 resize exemption). New leaf modules bounds.ts (single owner of boundsOf/metrics) and rotate.ts (pure math, reusable for TASK-42 group rotation). Knob placement north/south/clamped (clamped keeps off-canvas annotations rotatable); knob vs resize handles resolved nearest-wins with knob tie-break; delete button drops below when its rect lands within the knob's touch disc. Shift snaps to 15 degrees. One undo snapshot per gesture. Knob visual (user-selected from mockups): naked circular-arrow glyph - 260-degree arc with filled arrowhead and centre pivot dot, PALETTE[0] over white casing with drop shadow, tilts with the shape as an angle read-out; data-SVG rotate cursor with grab/grabbing fallback. Reviewer approved 4 rounds (browser-verified incl. rendered pixel probes): pnpm check clean, 194/194 unit tests, 21/21 Playwright e2e incl. new rotate.spec.ts (stable across repeats). Pending for Done: AC pass in pnpm tauri dev on Windows (esp. export/copy of rotated text + manual badge, WebView2 rotate-cursor check) and iPhone device checks (knob reachability at image top, delete-button placement on a small badge, rotated-text re-edit with soft keyboard).

Verified by the user in the running app on 2026-07-27 (final knob visual: 260-degree arc + arrowhead + 3.2px-ratio pivot dot). All 5 ACs exercised and confirmed; task marked Done.
<!-- SECTION:NOTES:END -->
