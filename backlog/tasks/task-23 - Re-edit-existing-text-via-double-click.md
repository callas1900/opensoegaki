---
id: TASK-23
title: Re-edit existing text via double-click
status: To Do
assignee: []
created_date: '2026-07-17 01:48'
labels: []
dependencies: []
priority: medium
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Text annotations can currently be moved/deleted (TASK-8) but not edited after creation. With the select tool, double-clicking an existing text annotation should open the in-canvas text editor (reuse the TASK-7 overlay input in src/editor/canvas.ts) pre-filled with the current text at the annotation's position, keeping its color and font size. Commit on Enter/blur replaces the text; committing an empty string deletes the annotation; Escape cancels without changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Double-clicking a text annotation with the select tool opens in-canvas editing pre-filled with its current text, at its position, with its color and font size
- [ ] #2 Enter or blur commits the edited text; the annotation updates in place
- [ ] #3 Committing empty text deletes the annotation; Escape cancels leaving the original untouched
- [ ] #4 A text edit is a single undo step (undo restores the previous text)
- [ ] #5 TASK-7/TASK-8 ACs still hold: creating new text and moving text still work
<!-- AC:END -->
