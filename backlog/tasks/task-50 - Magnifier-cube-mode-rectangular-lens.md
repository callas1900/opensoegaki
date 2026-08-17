---
id: TASK-50
title: Magnifier cube mode (rectangular lens)
status: Done
assignee: []
created_date: '2026-08-08 03:27'
updated_date: '2026-08-17 16:57'
labels: []
dependencies: []
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a rectangular, freely-resizable lens variant to the magnifier tool, for magnifying a strip of text. Second-tap on the magnifier toolbar button toggles circle/rect and swaps the icon. Rect mode keeps the source marker + tapered connector composition. Design: docs/design/2026-08-08-magnifier-cube-mode.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Second-tap on the active magnifier toolbar button toggles circle/rect mode and swaps the button icon (both desktop index.html and pwa/index.html)
- [x] #2 In rect mode, slide-to-aim creates a wide rectangular lens with a rectangular source marker and corner-to-corner connector lines, magnifying the source region uniformly on both axes
- [x] #3 The rect magnifier's SOURCE rect resizes via 8 box handles, drawn on a ring outset from the source frame, with free aspect (Shift on a corner locks the pre-drag aspect). During the drag zoom and the lens centre `at` are constant and the lens follows exactly as source x zoom; both axes stay within the lens size limits. The LENS has no box handles and is not directly resizable; it remains draggable by its body.
- [x] #4 The zoom grip sits on the LENS rect's SE corner and adjusts zoom with the SOURCE rect held fixed (the lens follows as source x zoom), clamped so zoom stays in [MIN, MAX] and the lens stays within [2*minLens, 2*MAGNIFIER_MAX_LENS_FRACTION*canvas] per axis; grabbing it without moving changes nothing. The source's legibility floor is enforced by the source box handles, and the source's drag target stays independently floored at a fingertip size -- a press at least as near the source centre as to any handle always starts a source-body drag.
- [x] #5 Lens-body drag moves the lens only; source-body drag moves the source only; undo restores prior state
- [x] #6 Existing circular magnifier behavior is unchanged (magnifier.spec.ts passes untouched)
- [x] #7 Export rasterizes the rect magnifier identically to on-canvas rendering
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete (2026-08-08), session-verified: pnpm check clean, unit 427/427, Playwright e2e 44/44 (magnifier.spec.ts untouched = circle regression gate). Design: docs/design/2026-08-08-magnifier-cube-mode.md (incl. Addenda D/E/F). Reviewer verdict: APPROVE (executed-code + browser-verified; NOT device-verified).

Remaining gate before Done — Windows device pass (pnpm tauri dev):
1. Diagonal auto-placement near a canvas edge/corner: connector reads as a beam meeting the lens's near rim, no ink over magnified content (Addendum E shape change).
2. Dragged-lens near-cardinal-but-off-axis + past a cardinal: no snap, connector never cuts across the lens (E1 continuity).
3. Connector present at creation for S/M/L on a large phone photo (Addendum F fix); also check the loupe FITS beside its source on mid-size PWA images rather than overlapping (reviewer note: D11 widening + clamp fallback can overlap on e.g. 1920x1080 at M/L under web cropScale — if routine, route back to architect re: widening cap).
4. Source partly/fully off-image (edge drag or crop): clamped overlap or empty lens, frame+connector still drawn, no color fill inside the lens (TASK-46 AC #6 analog).
5. Exercise ACs #1-#7 in the running app (desktop AND PWA for the toggle; export parity check).

Known cheap follow-ups (non-blocking): MAGNIFIER_LENS_STROKE_RATIO expression still duplicated twice in render.ts (same class F2 fixed for marker stroke); e2e fit precondition has 0.8px margin and will trip on the next gap/preset retune.

Addendum I (2026-08-09, user decision after live use of the cube-mode magnifier on device): the 8 box handles move from the LENS to the SOURCE rect; zoom stays FIXED for the whole box-handle drag; the LENS follows exactly as source x zoom. The src-zoom grip relocates to the LENS's own SE corner with an inverted mapping (source held fixed, lens follows) -- the exact inversion of the pre-Addendum-I gesture. AC#3/#4 above rewritten accordingly (superseding the D5-era wording); AC#1/#2/#5/#6/#7 and the rest of the design (creation, connector, hit-target split, rendering, the circle path) are untouched. Design: docs/design/2026-08-08-magnifier-cube-mode.md, Addendum I. Implemented and unit-tested (pnpm check clean; resize.test.ts 111/111, magnifier.test.ts 195/195, full suite 469/469 -- run via powershell.exe interop, WSL vitest blocked by a native-binding issue unrelated to this change).

Addendum I device-checklist additions (append to the 'Remaining gate before Done' Windows device pass above): (a) floor-size source on a phone screenshot -- the source's marker frame stays visible between the 8 ring handles, not swallowed by them; (b) the source is still finger-draggable from its centre at that floor size (magnifierSourceBodyWins's fall-through); (c) grabbing any of the 8 source handles produces no visible grab-jump (the outset deflation is exact); (d) the lens grip changes zoom without moving the source, and the zoom readout tracks live; (e) undo granularity is one step per gesture (a full box-handle or grip drag), not one step per pointermove frame.

Reviewer round 2 (2026-08-09) amendment to device-checklist item (b) above: must be run at the FLOOR source size specifically, on a TOUCH device (not just any size/pointer). The body core there is a disc of radius ~9 CSS px (~18x18 CSS px across) around the source centre -- confirmed numerically (see resize.test.ts's magnifierSourceBodyWins property-1 test). If that proves too small to reliably grab with a real fingertip, do NOT patch this locally (e.g. do not just bump MAGNIFIER_SRC_HANDLE_OUTSET_PX or BASE_TOL_PX in canvas.ts) -- route back to the architect. Candidate lever already recorded for that discussion: touch-multiply the HIT ring's outset only (i.e. widen the box handles' grab region on touch beyond MAGNIFIER_SRC_HANDLE_OUTSET_PX = 14), while keeping the DRAWN ring at 14 unconditionally -- mirrors the existing drawn-vs-grab-size split HANDLE_DRAW_PX/HANDLE_HIT_PX already uses elsewhere in canvas.ts.

2026-08-17: user ran the Windows device pass (pnpm tauri dev) covering the Addendum I checklist and checked AC #1-#7; task moved to Done. The 'Remaining gate before Done' block above is historical.
<!-- SECTION:NOTES:END -->
