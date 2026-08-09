---
id: TASK-48
title: 'Magnifier: single-line connector and operability-based size limits'
status: Done
assignee: []
created_date: '2026-08-02 03:14'
updated_date: '2026-08-09 13:15'
labels: []
dependencies: []
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Real-iPhone feedback (2026-08-02): replace the two tangent connector segments with a single rim-to-rim line, and clamp lens/source circle sizes to a finger-operable range. Design: docs/design/2026-08-02-magnifier-connector-and-size-limits.md (Addendum B).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The connector is exactly one tapered fan along the center-to-center line - a flat end edge centered on the source rim, an arc end lying on the lens rim - and is suppressed when the circles overlap or nearly touch (unchanged guard d < r1 + r2 + MAGNIFIER_CONNECTOR_MIN_GAP_PX). (Amended per Addendum C, 2026-08-02 - was a stroked segment, then a flat-ended quad; see also §8.)
- [x] #2 The connector widens toward the lens: its width is the source ring's marker weight (MAGNIFIER_MARKER_STROKE_RATIO x strokeWidth) at the source end and MAGNIFIER_CONNECTOR_FAN_RATIO x lens radius (floored by the marker and lens-border stroke weights, capped at the lens radius) at the lens end, whose edge is an arc along the lens rim so it is flush with the border at any size. It is painted in the house two-pass style (white OUTLINE stroke at lineWidth 4 on the closed path, then an a.color fill), under both rings. connectorTangents and the exported connectorSegment are both deleted, with no fallback. (Amended per Addendum C §8; weight values retuned 2026-08-06 per TASK-49 - see TASK-46 #1.)
- [x] #3 The source circle and lens circle cannot be resized/created below finger-sized minima on the current display (source radius >= 20 CSS px - raised from 16 in TASK-49, because the source disc is now the drag surface and must stay grabbable beside the src-zoom grip's touch hit radius; lens radius >= 28 CSS px), converted via cropScale, capped canvas-relative; verified on a real iPhone with a large photo.
- [x] #4 The lens radius cannot exceed 45% of the canvas short side in both creation and corner-resize editing (MAX_MAGNIFIER_RADIUS 4096 deleted).
- [x] #5 No gesture sequence (corner resize, src-zoom, creation) can produce a magnifier violating minLens <= radius <= maxLens or radius/zoom >= minSource, except on a degenerate canvas (short side below ~5 bitmap px) where the documented hi-wins clamp semantics let maxLens win over the floors; corner resize stays fixed-zoom.
- [x] #6 Pre-existing out-of-range annotations render and export unchanged, and snap into range on their first size-affecting edit (stored data never mutated at render/load time).
- [x] #7 Unit tests cover connector geometry (connectorShape), magnifierSizeLimits (scaling, caps, backstop), and the non-emptiness invariant minLens >= MIN_ZOOM * minSource; pnpm check, pnpm test, pnpm test:e2e all pass.
- [x] #8 On a real iPhone the connector reads as a beam/cone fanning out from the source to the lens, with no gap, seam or unpainted lune where it meets either circle, on both a phone-sized and a large desktop capture. (Amended per Addendum C §8.)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-02 per Addendum B (docs/design/2026-08-02-magnifier-connector-and-size-limits.md) and Addendum C incl. §8 (docs/design/2026-08-02a-magnifier-tapered-connector.md). Three connector generations in one day, each after real-iPhone review by the user: single stroked rim-to-rim segment -> flat tapered quad (marker weight -> strokeWidth) -> lens-radius-anchored fan (w2 = 0.6 x lens radius floored by stroke weights, capped at r2 inside connectorShape; arc end flush with the lens rim; constant 17.46 deg half-angle at every scale). Size limits: magnifierSizeLimits(canvasSize, scale) — minima are CSS px x cropScale (source >= 16, lens >= 28 CSS px radius), maxima canvas-relative (lens <= 0.45 x short side); enforced at creation, corner resize and src-zoom; stored data never mutated at render/load.

Verification: pnpm check clean; pnpm test 281/281; pnpm build:web + pnpm test:e2e 27/27. Reviewer rounds: Addendum B APPROVE (browser-verified); Addendum C REQUEST CHANGES (bookkeeping) -> APPROVE; §8 REQUEST CHANGES (bookkeeping/comment accuracy) -> APPROVE; pre-commit refactoring sweep (R1-R4, O1-O3) applied and verified. Device verification by user on real iPhone 2026-08-02 (phone + desktop capture): beam appearance, no seam/gap, min-size operability with a large photo — confirmed OK.

TASK-49 (2026-08-06) raises both magnifier stroke ratios (MAGNIFIER_LENS_STROKE_RATIO 1.5 introduced, MAGNIFIER_MARKER_STROKE_RATIO 0.6 -> 0.9), changing the rendered/exported APPEARANCE of pre-existing annotations. AC#6's subject is stored data and geometry (never mutated at render/load), not pixel-identical output across releases, so it is not violated. TASK-49 also raises MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX 16 -> 20 (AC#3 amended accordingly); the amended AC#3 20 CSS px floor and AC#8 short-connector legibility under the thicker rims still need re-verification on a real iPhone as part of TASK-49.

Historical note (2026-08-06, TASK-49): 'source >= 16' in the notes above predates TASK-49, which raised the floor to 20 CSS px (AC#3 amended).

Addendum G (2026-08-08, TASK-50): the rect magnifier variant delivers AC#3's *intent* (a finger-operable source) through an independently-floored hit target (hittest.ts, MAGNIFIER_SOURCE_MIN_HIT_HALF_PX) rather than through the drawn source size — the rect source's drawn/legibility floor (minRectSource) is deliberately smaller than this task's circle-only minSource. No amendment to this task's own ACs (all circle-scoped); recorded here per the user's ruling on the TASK-50 AC#4 conflict.

Addendum I (2026-08-09, TASK-50): AC#6 gains a rect-specific carve-out for the SOURCE-authoritative box-handle gesture. The zoom grip (src-zoom, now on the LENS's SE corner per Addendum I §I5) holds the SOURCE fixed by construction and therefore does NOT snap a below-floor source back into range on its own -- only the source's 8 box handles enforce minRectSource (Addendum I §I4). This is not a regression of AC#6's own circle-scoped guarantee (unchanged) nor of the rect's AC#6 intent overall (a size-affecting edit via the box handles still snaps into range); it only narrows WHICH rect gesture does the snapping, recorded here since AC#6's wording ('their first size-affecting edit') did not originally distinguish between a rect magnifier's two different resize gestures.
<!-- SECTION:NOTES:END -->
