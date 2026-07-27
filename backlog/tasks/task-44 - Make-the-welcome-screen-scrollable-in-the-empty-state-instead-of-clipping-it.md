---
id: TASK-44
title: Make the welcome screen scrollable in the empty state instead of clipping it
status: To Do
assignee: []
created_date: '2026-07-27 07:56'
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
- [ ] #1 Welcome content that exceeds the stage height is reachable by scrolling instead of being clipped behind the share bar
- [ ] #2 Drawing-time gesture behaviour (no page scroll, zoom or rubber-band while annotating) is unchanged
- [ ] #3 The per-viewport geometry guards in welcome-install.spec.ts still pass, or are replaced by the scroll behaviour
<!-- AC:END -->
