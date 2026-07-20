---
id: TASK-27
title: 'README refresh: bring content up to date with the shipped app'
status: Done
assignee: []
created_date: '2026-07-19 09:30'
updated_date: '2026-07-19 17:30'
labels: []
dependencies: []
priority: medium
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The README still describes the three-tool MVP. Bring it in line with what is actually shipped before any promotional polish (follow-up task depends on this one).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Features section covers all shipped capabilities: paste/capture, arrow/rect/text, crop, selection (move/delete), color palette + S/M/L presets, highlighter, numbered step badges, save PNG / copy / drag-out share
- [x] #2 Hotkey table matches the code: adds Delete/Backspace (delete selected annotation), Esc (cancel crop / clear selection / close popover), Enter (apply crop)
- [x] #3 Project layout section reflects reality: no 'capture overlay' wording; src/ui/ (popover module) accounted for; toolbar description matches the redesigned color-chip/size popover UI
- [x] #4 Intro paragraph and feature wording no longer imply arrows/boxes/text are the only annotations
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
README rewritten 2026-07-20. All four ACs verified by reviewer agent against the code (src/main.ts hotkey handler, index.html toolbar, src/editor/, src/ui/popover.ts). Unimplemented single-letter tool shortcuts (tooltips A/R/T/H/N/V/C) deliberately excluded from the hotkey table.
<!-- SECTION:NOTES:END -->
