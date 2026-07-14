---
id: TASK-17
title: Paste image from clipboard (Ctrl+V)
status: Done
assignee: []
created_date: '2026-07-14 03:12'
updated_date: '2026-07-14 03:42'
labels:
  - feature
dependencies: []
priority: high
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Core workflow: user captures with the OS screenshot tool (Win+Shift+S etc.) and pastes into OpenScrawl to annotate. Pasting an image replaces the current capture in the editor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pressing Ctrl+V (or Cmd+V) in the editor loads a clipboard image into the editor
- [x] #2 Works with images produced by Windows Snipping Tool (Win+Shift+S)
- [x] #3 Pasting with no image on the clipboard does nothing (no error dialog)
- [x] #4 Empty-state hint mentions paste as the primary way to start
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented via DOM paste event (architect design; no new deps, no clipboard-read permission). E2E on Windows 11 release build 2026-07-14: 800x600 test bitmap set via Clipboard.SetImage, Ctrl+V loaded it into the editor (evidence %TEMP%\os-e2e-02-after-paste.png); text-only clipboard paste left the document untouched (os-e2e-05). Snipping-Tool AC verified with a simulated CF_BITMAP clipboard image — same clipboardData path. Reviewer approved. NOT yet committed.
<!-- SECTION:NOTES:END -->
