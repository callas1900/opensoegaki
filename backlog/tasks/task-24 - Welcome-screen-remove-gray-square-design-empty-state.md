---
id: TASK-24
title: 'Welcome screen: remove gray square, design empty state'
status: To Do
assignee: []
created_date: '2026-07-17 01:48'
labels: []
dependencies: []
priority: medium
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On first launch (no image yet) a gray rectangle shows in the center of the stage: the empty default-size <canvas> casts its box-shadow (src/styles.css:38 #canvas) even though it has no content. Fix by not rendering the canvas/shadow until an image exists, and replace the bare one-line hint (index.html #empty-hint) with a small welcome layout: app icon/logo plus the key actions (Ctrl+V paste, Capture button) presented cleanly. Welcome content must disappear entirely once an image is loaded (capture or paste), matching current hideEmptyHint() behavior in src/main.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On launch with no image, no gray rectangle or stray shadow is visible anywhere on the stage
- [ ] #2 The empty state shows a welcome layout (icon/logo + paste and capture guidance) instead of the bare text line
- [ ] #3 After capturing or pasting an image, the welcome content is fully hidden and the editor looks unchanged from today
- [ ] #4 Returning to an empty state is not required (app currently never clears the image)
<!-- AC:END -->
