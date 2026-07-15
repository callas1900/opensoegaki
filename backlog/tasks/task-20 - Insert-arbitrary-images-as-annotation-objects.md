---
id: TASK-20
title: Insert arbitrary images as annotation objects
status: To Do
assignee: []
created_date: '2026-07-14 08:36'
updated_date: '2026-07-15 03:31'
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
- [ ] #1 A new 'image' annotation kind exists in the object model and renders on the canvas over the background
- [ ] #2 Toolbar button opens a native file dialog and inserts the chosen image as an annotation
- [ ] #3 Dropping an image file onto the editor inserts it as an annotation
- [ ] #4 Ctrl+Shift+V inserts a clipboard image as an annotation; Ctrl+V still replaces the background
- [ ] #5 Inserted images are included in PNG export (rasterized at export only)
- [ ] #6 Move/resize/delete is explicitly out of scope (depends on TASK-8)
<!-- AC:END -->
