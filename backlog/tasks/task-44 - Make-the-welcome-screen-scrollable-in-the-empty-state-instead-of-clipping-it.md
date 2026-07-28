---
id: TASK-44
title: Make the welcome screen scrollable in the empty state instead of clipping it
status: Done
assignee: []
created_date: '2026-07-27 07:56'
updated_date: '2026-07-28 10:07'
labels:
  - web
dependencies: []
priority: low
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review finding (TASK-43, round 3): #stage carries touch-action: none and clips overflow with place-items: center, which is right while drawing but wrong on the welcome screen, where there is nothing to protect. The consequence is that welcome content that does not fit is silently clipped behind #share-bar rather than scrolled, so every addition to the welcome screen has to be defended with per-viewport geometry tests (currently 320x568 and 375x667-with-badge-bar). Making #stage.empty scrollable would retire that whole class of bug permanently. Architect ruling needed on where the empty-state exception lives and whether it can coexist with the drawing-time gesture guards.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Welcome content that exceeds the stage height is reachable by scrolling instead of being clipped behind the share bar
- [x] #2 Drawing-time gesture behaviour (no page scroll, zoom or rubber-band while annotating) is unchanged
- [x] #3 The per-viewport geometry guards in welcome-install.spec.ts still pass, or are replaced by the scroll behaviour
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-28 as part of TASK-43's AC#4 fix (CI failure on welcome-install.spec.ts's badge-bar-open landscape case: Linux WebKit's system-ui font metrics wrapped #welcome-install to 3 lines, pushing .welcome-version off #stage — 474.56px vs 448.5px ceiling; passed on Windows WebKit locally, failed on ubuntu-latest CI).

Architect ruling: stop treating overflow as unrecoverable data loss. #stage.empty gets touch-action: pan-y + align-content: safe center (src/styles.css). Empty state has no canvas and no drawing gesture to protect, so TASK-35.10's touch-action: none stays untouched in the annotating state — confirmed by a new dedicated regression test. WebKit includes padding-bottom in scrollHeight, so "scroll to bottom, then assert containment" is font-metric-independent: the last element always lands exactly padding-bottom (24px) above #stage's bottom edge regardless of how tall the content grew. This is what makes the fix structural rather than a wider pixel budget.

tests/e2e/welcome-install.spec.ts: all four per-viewport geometry tests (390x844, 320x568, 375x667-with-badge-bar, 844x390-landscape) converted to scroll-then-assert. Added "empty-state stage scrolls, annotating-state stage does not" (TASK-35.10 guard) and "oversized welcome content stays reachable via scroll" (direct CI-failure regression, forces overflow via a CSSOM font-size write — page.addStyleTag was tried first per the original task list but is rejected by this app's CSP (style-src 'self', no unsafe-inline); confirmed empirically, not just reasoned).

Reviewed 2 rounds (round 1 found the 844x390 landscape test still enforcing the old unscrolled pixel budget — same failure mode this fix retires, left in one spot; fixed and re-reviewed). Final verdict APPROVE (browser-verified): pnpm check clean, 194/194 unit, 25/25 e2e, 45/45 welcome-install.spec.ts at --repeat-each=5. AC regression pass clean against TASK-35.10, TASK-38, TASK-39, TASK-24, TASK-36, TASK-35.13 — no Done AC broken. src/main-web.ts and pwa/index.html deliberately untouched (JS keeps sole ownership of the hidden attribute, CSS keeps sole ownership of display).

TASK-43's AC#4 amended accordingly (user-approved) to describe reachability instead of unscrolled visibility for the version line.
<!-- SECTION:NOTES:END -->
