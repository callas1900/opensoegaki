---
id: TASK-20
title: Insert arbitrary images as annotation objects
status: In Progress
assignee: []
created_date: '2026-07-14 08:36'
updated_date: '2026-07-19 14:40'
labels:
  - feature
dependencies:
  - TASK-8
priority: low
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Overlay arbitrary images on top of the captured screenshot as first-class annotation objects (new 'image' kind in src/editor/model.ts alongside arrow/rect/text), rendered on canvas and rasterized only at export. Intake paths: (1) toolbar insert-image button via native file dialog, (2) drag & drop of an image file onto the editor, (3) clipboard paste. Paste is split by modifier: Ctrl+V keeps background-replace semantics (TASK-17); Ctrl+Shift+V inserts as annotation. Scope is insertion + rendering + export only — move/resize/delete of placed images is TASK-8 (selection tool) territory. Design must go through architect before implementation (image data storage in the Doc, memory footprint, .soegaki serialization impact per TASK-16).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new 'image' annotation kind exists in the object model and renders on the canvas over the background
- [x] #2 Toolbar button opens a native file dialog and inserts the chosen image as an annotation
- [ ] #3 Dropping an image file onto the editor inserts it as an annotation
- [x] #4 Ctrl+Shift+V inserts a clipboard image as an annotation; Ctrl+V still replaces the background
- [x] #5 Inserted images are included in PNG export (rasterized at export only)
- [x] #6 Inserted images are selectable, movable and deletable with the select tool (user decision 2026-07-19 overriding the earlier out-of-scope stance); resize remains out of scope (follow-up task)
- [ ] #7 Dropping an image file onto an empty editor (no background) loads it as the background instead of silently doing nothing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-19 feedback round: (a) images are now selectable/movable/deletable via select tool (AC6 rewritten per user decision; resize split off to TASK-29); (b) drop on empty editor now loads the file as background (AC7). E2E-verified on the running Windows app via automated probes (clipboard image + SendKeys + pixel sampling of Ctrl+C export): AC1/4/5/6 all pass, incl. undo-after-delete restoring the bitmap and Ctrl+V background-replace regression. Ctrl+Shift+V works on-machine — earlier 'paste didn't work' report was likely a no-image-on-clipboard case (e.g. copying a FILE in Explorer puts CF_HDROP, not image data; readImage then no-ops with only a console error). AC3/AC7 (real drag & drop) could not be automated (needs a human OLE drag) — pending user verification; if D&D still fails, suspect elevation mismatch (drag from non-admin Explorer into admin app is blocked by Windows) or check the terminal/devtools console. Reviewer approved both rounds; nit noted: loadImage hard-types blob as image/png (cosmetic, createImageBitmap sniffs bytes).
<!-- SECTION:NOTES:END -->
