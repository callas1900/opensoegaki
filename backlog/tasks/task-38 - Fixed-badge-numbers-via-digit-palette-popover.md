---
id: TASK-38
title: Fixed badge numbers via digit-palette bottom bar
status: Done
assignee: []
created_date: '2026-07-23 02:05'
updated_date: '2026-07-23 18:00'
labels:
  - feature
dependencies: []
priority: medium
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the TASK-22 step-number tool so users can stamp an arbitrary fixed number repeatedly (e.g. place '1' five times) to categorize items on a diagram, coexisting with the auto-increment sequence.

Decisions (user-approved 2026-07-23 after 3 mock iterations, see plan step-number-nested-ripple):
- Model: BadgeAnnotation gains manual?: boolean. nextBadgeNumber counts only auto badges; renumberBadges compacts only auto badges — manual badges keep their number forever (amends TASK-22 AC #2).
- UI: a badge-options popover (same pattern as color/size popovers): an 'Auto sequence' button, a 0-9 digit palette (one tap = fix that number, popover closes), and a numeric input for 10+. No mode indicators outside the popover (no status text, no cursor pill) — keep the first version minimal.
- Rendering: manual badges draw as rounded squares that widen with digit count; auto badges stay circles and get measureText shrink-to-fit for multi-digit. Shape alone distinguishes manual from auto.
- Rejected during mocks: digit-key type-ahead (confusing), post-placement number editing (dropped for simplicity; delete and re-place instead).
- Interaction with TASK-33 (per-color sequences): any future per-color numbering must also skip manual badges.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 In fixed mode every click/tap places a badge with the chosen number; placing manual badges does not advance the auto sequence
- [x] #2 Manual badges render as rounded squares that widen with digit count; auto badges remain circles with font shrink-to-fit so multi-digit numbers stay inside the shape (including exported PNG)
- [x] #3 Deleting badges recompacts only auto badges to 1..N; manual badge numbers never change
- [x] #4 Manual badges are selectable, movable, deletable and undo/redo works; hit-testing and selection bounds account for the widened shape
- [x] #5 TASK-22 auto-sequence behavior is unchanged when no manual badges exist
- [x] #6 Digit chips and Auto/OK buttons are gray-family; only the currently active choice uses the accent color, and chips do not follow the drawing palette color
- [x] #7 A bottom bar (replacing the popover; no Auto-sequence button) offers a 0-9 digit grid and a 10+ numeric input; tapping a digit switches the pinned number and KEEPS the bar open for repeated stamping; bar closed = auto sequence
- [x] #8 The badge tool button icon reflects the mode: circled 1 in auto, rounded square showing the currently pinned number in fixed mode
- [x] #9 Canvas taps while the bar is open stamp badges and never dismiss the bar; the bar does not participate in popover dismissal (outside tap, Escape priority stays popover-first, iOS keyboard resize)
- [x] #10 Works in the iPhone PWA: bar digit taps pin fixed numbers, the 10+ input summons the numeric keypad, and tapping the ✕ close button does not place a stray badge
- [x] #11 All bar content fits on an iPhone-width viewport (no digit overflow, no clipped controls)
- [x] #12 Tapping the 10+ input keeps the bar open on iOS (soft-keyboard resize/scroll must not dismiss it) and OK commits reliably without closing the bar
- [x] #13 The bar opens by tapping the badge tool button a second time, REPLACES #share-bar while open (share bar hidden, stage shrinks so the whole image stays visible and tappable), and closes via its own-row ✕ button (never overlapping the digit grid), a further badge-button tap, or switching tools — closing returns to auto sequence and restores the share bar
- [x] #14 Opening the bar pre-selects the last-used pinned number (default 1); the 10+ input's commit button IS the typed number (live label, sized identically to the digit chips); tapping it pins that number like a digit chip (active highlight, input cleared, keyboard dismissed) and it retains the last custom value for one-tap re-selection
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-23 (mock-first: 3 Artifact mock iterations, then implementer + reviewer APPROVE). manual?: boolean on BadgeAnnotation; nextBadgeNumber/renumberBadges skip manual badges; badgeHalfWidth shared between drawBadge, boundsOf and hit-test so the widened rounded-rect and its selection box cannot disagree; badge popover follows the color/size popover pattern (outside-tap swallow verified). pnpm check clean; 139 vitest tests green (run via powershell.exe - WSL cannot run this repo's toolchain). Reviewer MINOR notes: (1) resize grab-jump on 10+ manual badges (radius snaps to half-width on grab; cosmetic), (2) a pinned 10+ value is not echoed when reopening the popover (consistent with approved minimal design). NOT verified in the running app yet - ACs must be exercised in pnpm tauri dev on Windows and in the iPhone PWA before Done.

2026-07-23: UX superseded per user mock iterations rev4-rev5.1 (bottom bar replaces popover). Old AC#1 removed; AC#8 (second-tap) now covered by the new bar ACs; #9/#10/#11 apply to the bar. Architect design note produced (badge bar = mode outside popover registry; new src/ui/badgebar.ts; dual SVG icon swap). User-required: close button in its own row, never overlapping digits.

2026-07-23 (bottom-bar round): Implemented per architect note — new src/ui/badgebar.ts (mode controller outside the popover registry), #badge-popover deleted from both shells, #badge-bar fixed bottom section, dual-SVG badge tool icon (auto circle / fixed rounded square with pinned number), popover.ts manualTrigger removed. Reviewer verdict: APPROVE (browser-verified) — pnpm check clean, unit 139/139, Playwright iphone-webkit e2e 10/10 (8 badge-bar + 2 crop-dismiss); width arithmetic re-done (366px inner vs 244px grid min); no Done-AC regressions (TASK-26/30/31/22 traced). ACs #7-#10, #13 checked via e2e. Outstanding for Done: real-iPhone pass (esp. AC#14 OK-commit under the real soft keyboard — the old pointerdown pre-blur hack was removed by design), AC#11 stamping-under-bar (e2e has no image loaded), Windows pnpm tauri dev pass. Reviewer non-blocking notes: Escape calls close() unconditionally (idempotent today), commitInput shows raw value if clamp ever diverges (unreachable via maxlength=4), desktop ✕ right-aligned vs 420px-centered grid asymmetry (cosmetic).

2026-07-23 iPhone feedback: the fixed-overlay bar hides the bottom of the photo, making it impossible to stamp there. Fix: make #badge-bar in-flow (flex child of #app) and hide #share-bar while open — #stage shrinks, canvas rescales via its existing max-width/max-height CSS, whole image stays visible and tappable. AC#8 wording 'slides over #share-bar' now means 'replaces #share-bar while open'.

2026-07-23 (layout fix round): bar made in-flow, body.badge-bar-open hides #share-bar, stage shrinks and canvas rescales via existing CSS. Reviewer: APPROVE (browser-verified) — check clean, e2e 11/11 (new stage/bar non-overlap regression test); coordinate mapping verified rect-fresh per event; AC#8 reworded to the replace-share-bar contract (this entry). Reviewer non-blocking: e2e overlap test runs on welcome screen (an image-loaded variant would pin the symptom tighter); real-device keyboard-over-input check folds into the outstanding AC#13 device pass.

2026-07-23 (iOS viewport hardening): real-device symptom — stage stays shrunk after the soft keyboard closes, unaffected by bar close/document reset. dist-web was verified to contain the in-flow bar (symptom pattern matches a stale SW-served build for the no-shrink-on-open part). Hardening added for the genuine iOS standalone-PWA quirk: restoreViewport() = window.scrollTo(0,0) on bar close, on #badge-num-input blur, and after 10+ commit (badgebar.ts; trivial change, tests 139/139 unit + 11/11 e2e, no review round). If a FRESH build still shows no shrink on bar open, next suspect is iOS Safari failing to re-resolve the canvas max-width/height percentages in the grid stage — fallback plan: JS-driven canvas display sizing via ResizeObserver.

2026-07-23 (JS canvas sizing round): Editor now sizes the canvas display box explicitly — ResizeObserver on #stage + fitCanvasToStage() (content-box math, shrink-only scale, changed-value loop guard), called at all canvas-attribute write sites (setBackground/restore/applyCrop/clearDocument). Reviewer: APPROVE (browser-verified) — check clean, e2e 12/12; write-site coverage, overlay coexistence, and no-oscillation traced. IMPORTANT reviewer caveat: Playwright's WebKit re-resolves the CSS percentages correctly, so the new e2e guards the JS path but does NOT reproduce the iOS percentage-re-resolution bug — only a real iPhone pass can confirm the fix for the reported symptom. dist-web rebuilt.

2026-07-24 (aspect-ratio fix): real-device symptom — bar open/close now resizes correctly but the image aspect ratio distorted. Cause: the leftover #canvas max-width/max-height:100% CSS resolved against stale #stage dimensions on iOS and clamped ONE axis of the JS-set px size. Fix: removed the CSS entirely; Editor.fitCanvasToStage() is the sole display-sizing authority (comments in styles.css/canvas.ts warn against reintroducing a CSS max-% backstop). Trivial diff, no review round; check clean, unit 139/139, e2e 12/12, dist-web rebuilt. Awaiting device re-test.

2026-07-24: user feedback — OK felt like a 10+ ON/OFF toggle (stayed accent-highlighted, input kept its value). User-proposed redesign adopted: the commit button becomes a custom-number chip labeled with the typed value, fully symmetric with the 0-9 chips (same size via shared grid geometry), keeping the last custom value for re-selection. Old AC#8 replaced by this entry.

2026-07-24 (custom chip round): OK button replaced by the custom-number chip per user proposal — live label from input, one-tap re-selection via lastCustom, chip sized structurally identical to digit chips (shared 5-col grid + shared selector group). Reviewer: APPROVE (browser-verified) — check clean, unit 139/139, e2e 12/12; full state-machine trace incl. n<=9 non-double-highlight, clamp coherence, cascade check; no AC regressions. Follow-up: e2e assertions for the n<=9 branch + fresh-open disabled state being added (test-only). dist-web rebuilt; device re-test pending.

2026-07-24: user device-verified the custom-chip behavior OK; requested the initial 'OK' fallback label be empty — done (both shells + refreshChipLabel + e2e assertion; check clean, unit 139/139, e2e 14/14, dist-web rebuilt; trivial diff, no review round).

2026-07-24: user completed the real-iPhone verification pass across all rounds (bar open/close with stage resize, bottom-of-photo stamping, aspect ratio, 10+ keyboard flow incl. commit and viewport restore, custom-number chip behavior, empty initial label). Model/renumbering/hit-testing ACs additionally covered by unit tests (139) and the iphone-webkit e2e suite (14). Verification basis: iPhone PWA device pass + automated tests; the desktop Tauri shell shares bootstrapEditor and was exercised only via automated tests, not a manual pnpm tauri dev pass.

2026-07-24: REGRESSION reopened — aspect ratio breaks when switching from the 10+ input directly to the select tool. Root cause: a second sizing authority survived in main-web.ts (legacy 'round 9' fitCanvasToStage stamping pixel max-width/max-height on window/visualViewport resize); the keyboard resize baked a stale tiny max-height that one-axis-clamped Editor.fitCanvasToStage's values after the bar closed (stage grows with no window resize). Fix in progress: delete the legacy routine (Editor's ResizeObserver covers all its trigger cases), add an e2e asserting canvas aspect === bitmap aspect across stage resizes that occur without window resizes. Prevention recorded in CLAUDE.md rule 5: sweep all of src/ incl. entry points for resize/visualViewport handlers; 'one property, one owner' grep rule. Back to Done only after user re-verifies on device.

Correction to the 2026-07-23 layout-fix entry: 'canvas rescales via its existing max-width/max-height CSS' is no longer accurate — that CSS was later removed (aspect-ratio bug) and display sizing is done solely by Editor.fitCanvasToStage() (JS, ResizeObserver).

2026-07-24 (regression fix round complete): legacy main-web.ts fit routine deleted (Editor sole sizing authority), regression e2e reordered per reviewer to the stamp-while-small → grow-without-resize sequence that genuinely catches a reintroduced max-writer. Reviewer verdict after fix: APPROVE (browser-verified), 15/15 e2e. CLAUDE.md rule 5 gained the src/-wide handler sweep + one-property-one-owner rules. Awaiting user device re-verification to restore Done.

2026-07-24: user re-verified on the real iPhone — aspect ratio holds through the keyboard→select-tool path, bar open/close, and rotation. Regression resolved; task restored to Done.
<!-- SECTION:NOTES:END -->
