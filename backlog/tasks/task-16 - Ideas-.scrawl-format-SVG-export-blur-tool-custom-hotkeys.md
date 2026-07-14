---
id: TASK-16
title: 'Ideas: .scrawl format, SVG export, blur tool, custom hotkeys'
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-14 09:33'
labels:
  - ideas
dependencies: []
priority: low
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parking lot enabled by the object model: re-editable .scrawl file format (serialize Doc), SVG export, highlighter/blur-pixelate tool (blur matters for the screenshots-are-sensitive stance), user-configurable hotkeys. Bound undo-history memory: since TASK-19, each background replacement pins the previous ImageBitmap in the history stacks with no close(); consider capping history depth or closing evicted bitmaps if users chain many pastes (reviewer note 2026-07-14). Split into real tasks when picked up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each idea is either split into its own designed task or explicitly dropped
<!-- AC:END -->
