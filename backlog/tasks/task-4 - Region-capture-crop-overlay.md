---
id: TASK-4
title: In-editor crop tool
status: Done
assignee: []
created_date: '2026-07-12 02:44'
updated_date: '2026-08-19 02:59'
labels:
  - editor
dependencies:
  - TASK-3
priority: medium
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Crop the current document from within the editor: select a rectangle on the canvas and trim the background image (pasted or captured) to it. This replaces the old region-capture overlay concept — capture-time region selection is covered by Win+Shift+S + clipboard paste (TASK-17), but trimming an image that is already in the editor cannot be done by the OS tool. Design must go through the architect agent first: interaction model (crop as a mode/tool in the toolbar), what happens to annotations outside the crop region, coordinate remapping of remaining annotations, and undo integration consistent with TASK-19.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Architect design notes exist (v1 + v2 revision) covering interaction, annotation handling outside the crop, undo, the handle-based region, and mouse-only apply
- [x] #2 Activating the crop tool starts the region as the full image with draggable corner handles; dragging a corner shrinks/expands it (clamped to bounds and min size), and an on-canvas Apply control usable with the mouse alone applies the crop
- [x] #3 Existing annotations keep their position relative to the image content after cropping
- [x] #4 Crop is a single undoable step (Ctrl+Z restores image and annotations)
- [x] #5 While the crop tool is active on an image there is always a visible region; apply, undo and pasting re-initialize it cleanly. Amended 2026-07-23 (TASK-40, user decision): the on-canvas ✗ control and Esc no longer reset the region — they exit crop mode to the select tool; ✓/Enter applies (or no-ops on an untouched region) and also exits to the select tool.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-14: Deprioritized as region-capture overlay. Product direction changed — region capture is covered by the OS screenshot tool (Win+Shift+S) plus clipboard paste (TASK-17).
2026-07-15: Repurposed per user decision: rewritten from a capture-time region overlay into an in-editor crop tool, priority Low -> Medium.
2026-07-15: v1 (draw rect + Enter) implemented, reviewed, E2E-verified by user. User then requested v2: handle-based region (starts full-image, corner handles shrink inward) + mouse-only apply + legible icon.
2026-07-15: v2 implemented per docs/design/2026-07-15-crop-tool-v2-handles.md: corner handles with pin/clamp/no-flip, floating on-canvas Apply/Cancel controls (text-editor overlay pattern), inline SVG crop icon. Reviewer: approve-after-fixes -> fixes applied (controls offset clear of SE handle; setBackground re-inits crop when crop tool active; 3 nits) -> confirmed-approve. pnpm check clean, pnpm test 58/58. Pending: Windows E2E of AC#2-#5.

2026-07-23: AC#5 amended per user decision in TASK-40 — ✓/✗ (and Enter/Esc) now exit crop mode to the select tool instead of keeping crop armed; the old 'cancel resets to full image' behavior is removed. See TASK-40 for the new contract.

2026-08-19 (TASK-52, user decision): AC#3 gains one explicit exception. Whole-document rotation (added to crop mode by TASK-52) maps every annotation rigidly, but a RECT-lens magnifier cannot carry an angle — magnifier is excluded from canRotate because its drawImage source rectangle is always axis-aligned in image space. Under a FREE (non-quarter) rotation a rect lens therefore un-tilts, keeping its centre and zoom; circle lenses are exact at any angle, and rect lenses are exact under quarter turns. Accepted by the user 2026-08-19 rather than restricting free rotation. See docs/design/2026-08-19-crop-canvas-rotation.md.

2026-08-19 (TASK-52, user decision): AC#2's "on-canvas Apply control" is amended in placement, not in substance. Adding the rotation controls grew the floating group from 2 to 5 controls, and a rendered iPhone check proved the group then covered the two BOTTOM corner handles - a portrait image could not be shrunk from the bottom at all, and in landscape the same gesture tapped a rotate button. The group is therefore no longer an on-canvas overlay: it is an in-flow bar at the bottom of #app that replaces #share-bar while crop is active (body.crop-bar-open, the same pattern TASK-38 established for #badge-bar). AC#2's requirement - the crop is confirmable with the mouse/finger alone, with no keyboard - still holds, and all four corner handles are now reachable (verified: 96/96 elementFromPoint probes at the handles and band midpoints hit the canvas, across three viewports and three fixtures). Losing Copy/Share for crop's duration was accepted by the user 2026-08-19; crop is modal, and the badge bar already sets that precedent.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-15 15:19
---
2026-07-16: v2.1 verified E2E by user on Windows (pnpm tauri dev): handle-based full-image region, mouse-only apply/cancel, cancel/apply/undo re-arm the full-image region, annotations preserved, single-step undo, no chrome in exported PNG. Marked Done.
---
<!-- COMMENTS:END -->
