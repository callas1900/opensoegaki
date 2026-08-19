---
id: TASK-52
title: 'Canvas rotation in crop mode: 90-degree turns and free rotation'
status: In Progress
assignee: []
created_date: '2026-08-19 02:37'
updated_date: '2026-08-19 02:59'
labels:
  - editor
dependencies: []
priority: high
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add whole-document (canvas) rotation to the existing crop tool: 90-degree quarter turns via on-canvas controls, and free rotation by dragging outside the image. User decisions (2026-08-19): rotation lives inside crop mode (no separate toolbar buttons); free rotation auto-crops to the largest inscribed axis-aligned rectangle so no transparent margin is ever produced; the free-rotation gesture is a drag on the band outside the image (no slider, no numeric box); the 90-degree preview swaps the canvas frame (not letterboxed); and the rect-lens magnifier's free-rotation deviation is accepted as specified behaviour.

Rotation is destructive re-rasterization like crop (never a stored angle), so exporter.ts, render.ts and the annotation model stay unchanged. Crop-mode preview lives in a 'frame space' canvas grown by a fixed CSS-px band; the canvas is resized only on discrete events (quarter turn, apply, teardown), never during a drag. See the plan and the architect design note for the coordinate model.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Architect design note exists covering the preview coordinate model, the inscribed-rect auto-crop, the annotation mapping, undo integration, and the rect-magnifier deviation
- [ ] #2 Pressing the on-canvas rotate controls in crop mode turns the preview by 90 degrees and swaps the canvas width/height
- [ ] #3 Dragging the band outside the image tilts the document freely (clamped to +/-45 degrees), with Shift snapping to 15-degree increments
- [ ] #4 Changing the angle makes the crop region follow the largest inscribed rectangle, and the applied output contains no transparent pixel
- [ ] #5 Confirming with the check control applies rotation and crop as ONE undoable step; a single undo fully restores the previous document
- [ ] #6 Existing annotations keep their position and orientation relative to the image content after rotation (documented exception: a rect-lens magnifier un-tilts under free rotation, keeping its centre and zoom)
- [ ] #7 Cancel (x / Esc) discards both the rotation and the crop, exits to the select tool, and restores the canvas dimensions
- [ ] #8 Confirming with zero rotation and an untouched region exits without pushing a history step (TASK-40 AC#3 preserved)
- [ ] #9 The exported PNG contains no crop or rotation chrome
- [ ] #10 Playwright iPhone-viewport specs cover the quarter turn, the cancel-restores-dimensions regression, the single-undo restore and the no-transparent-corner contract; all ACs exercised in the running app on Windows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-08-19: Architect design note written to docs/design/2026-08-19-crop-canvas-rotation.md (frame-space preview model, 40 CSS px rotate band, two-row .crop-controls, normalized crop region, inscribed-rect auto-crop, rigid annotation mapping, single-history-push apply). User decisions recorded there: rotation lives inside crop mode; free rotation auto-crops to the largest inscribed rect; the gesture is a drag on the band outside the image; a quarter turn swaps the canvas frame; the rect-lens magnifier deviation is accepted. Implementation split into T1-T9 in the note.

2026-08-19 round 1 review (reviewer, code-trace only): geometry layer APPROVED after two blocking fixes (restored 27 deleted rotate.test.ts suites; restored TASK-4's overwritten implementation-notes history). Canvas wiring review returned REQUEST-CHANGES with two blocking bugs: (B1) freezeBand() divided by a zero-width canvas box on two initCrop paths (welcome -> crop tool -> load image; crop -> Ctrl+N -> Ctrl+Z), producing an unusable 0x0 canvas on desktop and breaking TASK-36 AC#3; (B2) the tilt deadband was arithmetic-only, so an in-deadband tilt still applied the 1 px inscribed inset and made an untouched apply crop + push history (TASK-40 AC#3), and a 1 CSS px jiggle (~0.19 deg) exceeded the deadband entirely. Both routed back to implementer along with an OffscreenCanvas fallback (Playwright's WebKitGTK build has no OffscreenCanvas, so the three rotated-apply e2e specs could not run; real Safari 16.4+ and WebView2 both have it, and the design note already named document.createElement("canvas") as the fallback).

2026-08-19 device checklist additions (from the review, must be exercised before Done): entering crop mode on a 12 MP (4096x3072) import now creates a 4096x3988 backing store - first time a normal photo reaches the cap-squared worst case TASK-35.14 guards; and a rendered check of the 164x102 CSS px two-row .crop-controls group on the 390 px iPhone viewport (TASK-35.11).

2026-08-19 round 2 review (reviewer): APPROVE (browser-verified) - pnpm check clean, unit 529/529, Playwright iphone-webkit 52/52 including the 4 new crop-rotate specs and both unmodified crop-dismiss specs. B1/B2 re-traced and confirmed fixed.

2026-08-19 rendered check (iPhone 390x844 screenshots): found a real UI defect the code-trace reviews could not see - the 164x102 CSS px .crop-controls group lands ON TOP of the crop region and hides the image (worst with a wide 800x200 fixture and with any small image; also with any stage-filling image once tilted, where a 20 deg tilt leaves a 46x16 region under a 164x102 panel). The SE-corner anchoring inherited from the 2-button v2 group does not survive a 5-control group. Decision: dock the crop controls at the bottom centre of #stage and drop the SE-anchor placement logic. The angle readout was also illegible (transparent span over a light image) and gained the panel background.

2026-08-19 round 3 review (reviewer, browser-verified): REQUEST-CHANGES. The bottom-centre overlay dock introduced in round 2 covers the two BOTTOM crop corner handles - measured with document.elementFromPoint at the computed handle positions, a portrait image on the 390x844 iPhone target hits DIV.crop-controls at both bottom corners (TASK-4 AC#2 FAIL: the region cannot be shrunk from the bottom), and in landscape with a small image the same gesture taps the rotate buttons and silently turns the document 90 deg. The bottom rotate band midpoint is swallowed in 5 of 9 measured geometries (degrades TASK-52 AC#3). No e2e spec had ever dragged a corner handle, which is how it passed two review rounds. Fix (decided): follow TASK-38's precedent and make the crop control group an IN-FLOW #app child that replaces #share-bar while crop is active (body.crop-bar-open, mirroring body.badge-bar-open), collapsed to a single row so the chrome height stays comparable to #share-bar; #stage shrinks and fitCanvasToStage rescales the canvas for free. Plus a new e2e spec that drags a bottom corner handle on the TALL fixture.

2026-08-19 round 4 review (reviewer, browser-verified): APPROVE. Occlusion independently re-measured at 96/96 points across WebKit 390x844 / 844x390 / 320x568 and Chromium 1280x800 with the SMALL/WIDE/TALL fixtures - every crop corner handle and band midpoint hits the canvas. Reviewer surfaced one decision (the bar is no longer "on-canvas" and hides Copy/Share while crop is active); user chose 2026-08-19 to keep the replacement, and TASK-4 AC#2's wording amendment is recorded there. Remaining non-blocking items applied afterwards: freezeBand() now measures the stage (a stale canvas inline box made the band 70.5 CSS px instead of 35.6 when crop was entered with the soft keyboard up); teardownCrop refits unconditionally; #app lookup is guarded; two stale ARCHITECTURE.md paragraphs fixed (including a pre-TASK-40 crop keyboard contract); .crop-apply/.crop-cancel got a structural 44px min-width; and the arming-slop e2e spec now places a badge first so a wrongly-pushed history step cannot hide.

Known, documented limitation for the device pass: the rotate band's on-screen thickness oscillates with the frame's aspect ratio across quarter turns (TALL 120x900: 35.6 -> 21.7 -> 66.2 CSS px). It is a full-edge-length strip, so it stays grabbable, but 21.7 CSS px is below the 44 pt guidance - worth a look on the phone.

Status: unit 529/529, e2e 51/51, pnpm check clean, browser-verified. STILL IN PROGRESS: the Windows `pnpm tauri dev` AC pass is outstanding (per "Done means verified"), including the 12 MP crop-entry check and the band-thickness look on a real phone.
<!-- SECTION:NOTES:END -->
