---
id: TASK-46
title: Magnifier (loupe) annotation tool
status: Done
assignee: []
created_date: '2026-08-01 05:50'
updated_date: '2026-08-06 05:00'
labels:
  - editor
  - ui
dependencies: []
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
New circular-lens annotation: magnify a region of the image and show it enlarged elsewhere on the same image, so one photo carries both the wide context and a readable close-up detail. Design note: docs/design/2026-08-01-magnifier-loupe.md (circular lens per user decision; smooth interpolation; S/M/L = lens target size). Pure src/ feature — no IPC, no Rust, no new dependency. Key structural change: renderAnnotations gains a required 4th param 'background: ImageBitmap | null' so the lens samples doc.imageBitmap live at draw time (no pixel caches, crop/undo tracked for free, full-resolution export).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The committed annotation renders as: a single connector fanning out from the source toward the lens along the center-to-center line - a flat end edge of the source ring's marker weight centered on the source rim, widening to MAGNIFIER_CONNECTOR_FAN_RATIO x lens radius (floored by the marker and lens-border stroke weights, capped at the lens radius) at the lens end, whose edge is an arc lying on the lens rim; painted white-outline-then-fill under both rings - plus a source ring at the marker weight; smoothly interpolated magnified content clipped to the lens circle; and a two-pass (white outline + color) lens border at MAGNIFIER_LENS_STROKE_RATIO x strokeWidth, with the marker weight staying exactly 0.6 x the lens border weight. The connector is suppressed when the lens and source circles overlap or nearly touch. (Amended 2026-08-06, TASK-49: both weight ratios raised 1.5x for legibility - their ROLES and the 0.6 hierarchy are unchanged, but pre-existing annotations do render and export with thicker frames, which is the intent. Earlier amendments 2026-08-02, see TASK-48 / Addenda B and C. NOTE: this AC and TASK-48 #2 describe the same rendering - amend both together.)
- [x] #2 The magnified content, source ring, and connector appear identically in the exported PNG at full bitmap resolution (exportPng renders through the same code path)
- [x] #3 Dragging the lens body moves ONLY the lens (the source region stays put); dragging ANYWHERE inside the source circle moves the source region, including when the magnifier is not selected - such a press selects the magnifier and starts the source drag in the same gesture. Where the lens disc and the source disc overlap, the lens wins (paint order); annotations drawn ABOVE the magnifier still win over its source disc (topmost-first), while annotations drawn BELOW it are no longer clickable through the source disc (accepted tradeoff). Dragging the src-zoom grip on the source rim changes zoom at fixed lens radius; dragging a lens corner handle resizes the lens at fixed zoom, center pinned. The src-move centre handle is REMOVED, with no fallback. (Amended 2026-08-06 per user decision - see TASK-49.)
- [x] #4 A zoom readout (e.g. 2.4x) is shown as selection chrome while a magnifier is selected, and never appears in the exported image
- [x] #5 The magnifier does not rotate (no rotate handle; canRotate excludes it) and stores no pixel data (no Doc.images entry); undo/redo of create/move/resize/zoom works through the standard history
- [x] #6 After a crop, the loupe is translated with the image; a source region partly or fully outside the new background renders the clamped overlap (or an empty lens) with rings and connector still drawn - never deleted or clamped
- [x] #7 Unit tests cover the magnifier geometry module (connector geometry, sample clamping, placement, zoom clamps) and the new model/bounds/hittest/resize cases; pnpm check and pnpm test pass
- [x] #8 Creation gesture (revised per Addendum A, real-iPhone feedback): selecting the magnifier tool and pressing on the canvas plants a default-size source region at the touch point; sliding MOVES the source region while the lens rides alongside at a frozen offset showing live magnified content; release commits. Lens radius and zoom never change during the gesture.
- [x] #9 A tap with no movement is the zero-length case of the same gesture and produces the same default loupe - one code path, no tap-vs-drag slop threshold
- [x] #10 Playwright iPhone-viewport e2e (tests/e2e/magnifier.spec.ts) verifies slide-to-place shows the slid-to source content at the lens center, auto-select + auto-switch to select on commit, body-drag moves the lens without moving the source, and undo restores; pnpm test:e2e passes
- [x] #11 On commit the new loupe is auto-selected and the active tool becomes select (toolbar highlight follows), so handles/body-drag/delete are usable with no manual tool switch; re-tapping the magnifier button returns to placing loupes
- [x] #12 The default creation zoom is aspect-independent (S ~1.8x / M ~2.5x / L ~3.3x) for any image up to 2.5:1 displayed at a long side of >= 333 CSS px; below that the operability floor on the source radius (>= 20 CSS px, TASK-48 / TASK-49) takes precedence and the creation zoom is correspondingly lower. (Amended 2026-08-06, TASK-49: floor raised 16 -> 20 CSS px, threshold 267 -> 333.)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-01 per docs/design/2026-08-01-magnifier-loupe.md; revised 2026-08-02 per Addendum A (docs/design/2026-08-01a-magnifier-creation-revision.md, slide-to-aim creation, auto-select + auto-switch on commit), Addendum B (docs/design/2026-08-02-magnifier-connector-and-size-limits.md, single connector + operability size limits) and Addendum C incl. §8 (docs/design/2026-08-02a-magnifier-tapered-connector.md, lens-radius-anchored tapered fan with arc end) — each revision driven by real-iPhone feedback; connector/size-limit work tracked as TASK-48.

Final verification (2026-08-02): pnpm check clean; pnpm test 281/281; pnpm build:web + pnpm test:e2e 27/27 (iPhone WebKit viewport). Reviews: Addendum A round APPROVE; Addendum B APPROVE (browser-verified); Addendum C and §8 rounds each REQUEST CHANGES (bookkeeping/comment accuracy only, code verified correct) -> fixed -> APPROVE (browser-verified); final pre-commit refactoring sweep applied (dead p2 computation, comment sediment, ccw field, unused _handle param, 2 redundant tests). Device verification by user on real iPhone 2026-08-02: gesture feel, min-size operability, export PNG, crop out-of-bounds source, tap creation, tapered beam appearance — all confirmed OK.

Deviations from the design notes (documented in code + ARCHITECTURE.md): MAGNIFIER_MARKER_STROKE_RATIO exported from render.ts as single owner of the marker weight (ring + connector narrow end); deriveLensSizeForSource returns {radius, zoom} only (placement is canvas.ts magnifierGeometry via placeLens); creation clamps from to the bitmap while src-move editing deliberately does not. Follow-up filed: TASK-47 (pointercancel hygiene, editor-wide, pre-existing).

Historical note (2026-08-06, TASK-49): the deviations paragraph above predates TASK-49 - 'src-move editing' is now the source-body drag (the src-move handle was removed; the unclamped-from-during-editing policy carried over to the source-disc drag).
<!-- SECTION:NOTES:END -->
