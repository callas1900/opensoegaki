---
id: TASK-47
title: >-
  Pointer-cancel hygiene: clear in-flight gesture state on
  pointercancel/lostpointercapture
status: To Do
assignee: []
created_date: '2026-08-01 16:51'
labels:
  - editor
  - bug
dependencies: []
priority: low
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
canvas.ts has no pointercancel/lostpointercapture handlers (pre-existing, all tools): an iOS gesture takeover (system edge swipe, notification pull, incoming call) mid-drag leaves draft/move/resize/rotateDrag/magnifierPlace armed and a ghost draft rendered until the next pointerdown. Found during TASK-46 Addendum A review (reviewer nit, out of scope for that delta). Fix: register pointercancel + lostpointercapture on #canvas and route both through the same gesture-teardown path onUp uses (without committing drafts - a cancelled gesture must discard, not commit).
<!-- SECTION:DESCRIPTION:END -->
