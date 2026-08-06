---
id: TASK-49
title: 'Magnifier UX brush-up: source-disc drag, zoom-grip redesign, thicker frames'
status: In Progress
assignee: []
created_date: '2026-08-06 04:52'
updated_date: '2026-08-06 05:00'
labels:
  - editor
  - ui
dependencies: []
priority: medium
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-use feedback (2026-08-06): the source-side grips are confusable with the lens-side handles; the source region is expected to be draggable anywhere (not just a center grip); the zoom grip lacks grab affordance; the frame strokes are too thin. User decisions: the whole source disc becomes the drag surface, live even when the magnifier is unselected (accepted tradeoff: annotations below the magnifier are no longer clickable through the source disc), and the src-move center grip is removed. Design: docs/design/2026-08-06-magnifier-ux-brushup.md. Amends TASK-46 AC #1/#3/#12 and TASK-48 AC #2/#3 (recorded in those tasks). Pure src/ change - no Rust, no IPC, no new dependency.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pressing anywhere inside the source circle drags the source region, selected or not; an unselected press selects and drags in the same gesture, and the lens does not move.
- [x] #2 The src-move centre handle is gone from resizeHandlesFor, applyResize, the chrome and the tests, with no fallback path.
- [x] #3 The src-zoom grip is a 16 CSS px accent knob with white casing and three white ridges, anchored on the source rim at 45 degrees, screen-constant via cropScale, not confusable with the white lens-bbox squares; grabbing it does not change zoom until the pointer moves.
- [x] #4 While a magnifier is selected, the source disc carries a chrome-only accent tint punched by the lens disc; it never appears in the exported PNG.
- [ ] #5 The lens border strokes at 1.5x strokeWidth and the source ring at 0.9x, in the unchanged two-pass white-outline style, with no seam or gap where the connector meets either rim (device-checked on a phone-sized and a desktop-sized capture).
- [x] #6 Hover cursors: move over lens and source discs (selected or not), nwse-resize on the grip, corner cursors on the lens bbox.
- [x] #7 pnpm check, pnpm test, pnpm test:e2e pass; a new e2e test covers the source drag from both the selected and the unselected state.
- [ ] #8 Device-verified on a real iPhone: at minimum source size the source can still be dragged with a finger without hitting the grip, and the grip itself is comfortably grabbable.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Implemented per the design note; implementer + reviewer rounds done (round 1 REQUEST CHANGES on the tint punch, fix in flight). Remaining: re-review, Windows tauri dev check, real-iPhone device verification (AC #5, #8).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-06 per docs/design/2026-08-06-magnifier-ux-brushup.md. Reviewer round 1: REQUEST CHANGES (browser-verified) - the tint punch used clip + destination-out, which failed to remove the tint in the overlap (alpha-only erase) AND holed out the live rendered screenshot (minAlpha 224, 358 translucent px when the lens covered its source); fixed to clip-to-source-disc + evenodd fill of both discs, tint color unified to PALETTE[0] via globalAlpha (MAGNIFIER_SOURCE_TINT_ALPHA). Round 2: APPROVE (browser-verified) - pixel probes confirm untinted lens body, tint vanishing under full containment, minAlpha 255 / 0 translucent px; globalAlpha containment verified; docs (ARCHITECTURE.md, design note §5 correction) match code. Verification: pnpm check clean; pnpm test 287/287; pnpm build:web + pnpm test:e2e 42/42 (Windows), no flake. AC #1/#7 exercised by the new e2e source-drag test (selected + unselected); #2 by unit tests + grep; #3/#4/#6 by the reviewer's rendered probes on the built bundle. REMAINING for Done: AC #5 and #8 on a real iPhone (plus TASK-48 AC#8 short-connector legibility under the thicker rims), and a pnpm tauri dev pass on Windows. Reviewer device-watch items: at min source size the grip covers the SE quadrant of the tint (confirm the body-drag lune is finger-grabbable); a press up to ~8 CSS px off the rim on the enlarged knob snaps zoom on the first move frame (pre-existing absolute zoom=radius/dist mechanics, more reachable now).
<!-- SECTION:NOTES:END -->
