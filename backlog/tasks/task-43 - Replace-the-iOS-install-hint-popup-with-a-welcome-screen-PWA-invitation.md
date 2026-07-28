---
id: TASK-43
title: Replace the iOS install-hint popup with a welcome-screen PWA invitation
status: In Progress
assignee: []
created_date: '2026-07-27 07:08'
updated_date: '2026-07-28 10:08'
labels:
  - web
dependencies: []
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retire the one-time floating install hint (#install-hint) from the web shell and instead invite the user to install the app from the welcome screen: an understated line under the Choose Photo button, shown in every browser and hidden only when already running standalone. Removes the localStorage dismissal state, the badge-bar suppression rule and the phone-landscape media query the fixed card needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No install popup exists in any shell or viewport (no #install-hint markup, CSS, JS or storage key)
- [ ] #2 The invitation disappears together with the welcome screen once an image is loaded
- [ ] #3 The web welcome screen shows a PWA install invitation in portrait, and hides it when the app runs standalone
- [ ] #4 The invitation never overlaps the share bar; the Choose Photo CTA is fully visible without scrolling at every supported viewport; the version line is never unreachable - it is either visible or reachable by scrolling the empty-state stage; below a 500px viewport height the invitation is suppressed instead
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-27. Removed #install-hint entirely (markup, CSS card/keyframes/media queries, badge-bar suppression rule, main-web.ts gate, localStorage key soegaki-install-hint-dismissed, install-hint.spec.ts) and replaced it with static prose #welcome-install inside #welcome, between the privacy and version lines. Visibility is split with one owner per property: main-web.ts owns the hidden attribute (revealed once when !isStandalone(); navigator.standalone is still needed because iOS < 16.4 never matches display-mode: standalone), CSS owns display (@media max-height: 500px suppresses it in phone landscape, where #welcome already overflows #stage - which is place-items:center + touch-action:none, so overflow is clipped at the bottom behind #share-bar, not scrollable). No UA sniffing, no dismissal, nothing persisted. docs/WEB.md updated incl. a new iOS smoke-test step. New e2e tests/e2e/welcome-install.spec.ts bounds geometry against #stage rather than the viewport - bounding against the viewport passes for an element sitting behind #share-bar, which review round 1 proved with an injected 387px offset.

Copy: 'Install for a full-screen, offline experience - on iPhone: Share -> Add to Home Screen.' Chosen by measurement, not taste: the failure mode is a discrete line wrap (20.4px at once), so the governing number is the wrap threshold, not vertical slack. This string wraps to three lines only below a 266px container (54px margin under the 320px narrowest supported viewport, ~3x the tolerance of the first draft, which mattered because CI measures under system-ui while iPhones render SF Pro). Vertical slack of .welcome-version against #stage's bottom: 7.4px at 320x568, 18.8px at 375x667 with the badge bar open, 195.4px at 390x844 - both tight cases guarded by dedicated e2e tests. Reviewed 4 rounds, final verdict APPROVE (browser-verified, rendered + measured at 390x844, 375x667 +/- badge bar, 320x568, 844x390); AC regression pass over Done tasks clean. pnpm check clean, 194/194 unit, 23/23 e2e, 35/35 for welcome-install.spec.ts at --repeat-each=5. Follow-up filed as TASK-44 (make #stage scrollable in the empty state so welcome-screen overflow stops being a per-viewport defence). Pending for Done: iPhone Safari pass per docs/WEB.md checklist item 13 - the one thing WebKit on CI cannot substitute for is SF Pro wrap behaviour, so check the line count and that the version line is visible, ideally once with Display Zoom 'Larger Text' on an SE.

2026-07-28: the wrap-threshold pixel budget above just failed for real - GitHub Actions CI (Linux WebKit) rendered system-ui wider than local Windows WebKit, wrapping #welcome-install to 3 lines and pushing .welcome-version to 474.56px against CI's own 448.5px ceiling. Routed to architect per project workflow (design-level problem, not a Sonnet re-tune): TASK-44 pulled forward and implemented now (see TASK-44's notes for the full fix) - #stage.empty is scrollable (touch-action: pan-y, align-content: safe center), so overflow is reachable rather than lost, and the wrap-threshold budget is retired along with its comment block. AC#4 amended (user-approved) from "never pushes the CTA or version line off the stage" to "the version line is never unreachable - it is either visible or reachable by scrolling the empty-state stage." All four per-viewport geometry tests converted to scroll-then-assert; reviewed 2 rounds, final verdict APPROVE (browser-verified); AC regression pass clean (TASK-35.10, TASK-38, TASK-39, TASK-24, TASK-36, TASK-35.13). Still pending for Done: the same iPhone Safari smoke-test pass noted above (now checking reachability, not a fixed line count) - docs/WEB.md checklist item 13 wording updated accordingly.
<!-- SECTION:NOTES:END -->
