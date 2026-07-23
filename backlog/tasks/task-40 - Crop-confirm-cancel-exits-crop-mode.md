---
id: TASK-40
title: Crop confirm/cancel exits crop mode
status: In Progress
assignee: []
created_date: '2026-07-23 10:28'
updated_date: '2026-07-23 10:36'
labels:
  - ui
dependencies: []
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On iPhone (and desktop), pressing the crop ✗ or ✓ control with an unedited region did nothing visible: TASK-4 AC#5 deliberately kept crop mode active (cancel = reset region, exit only via tool switch). User decision 2026-07-23: ✓/✗ always exit crop mode — ✗ discards the region and returns to the select tool; ✓ applies the crop (or, when the region is untouched/degenerate, applies nothing) and returns to the select tool. Re-cropping is done by re-activating the crop tool, which re-initializes a full-image region. TASK-4 AC#5 is amended accordingly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pressing ✗ (or Esc) while crop is active exits crop mode: overlay and controls disappear, document unchanged, select tool becomes active in the editor and in the toolbar
- [ ] #2 Pressing ✓ (or Enter) with an edited region applies the crop as one undoable step and exits crop mode to the select tool
- [x] #3 Pressing ✓ (or Enter) with an untouched full-image region exits crop mode without pushing an undo step
- [x] #4 Toolbar active-button highlight follows the editor-initiated tool change
- [x] #5 Playwright iPhone-viewport e2e covers: load image, activate crop, ✗ dismisses; reopen crop, ✓ (no edits) dismisses
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-23: Implemented (canvas.ts cancelCrop/applyCrop route through setTool('select'); new Editor.onToolChanged callback syncs toolbar highlight; app.ts click handler simplified). Reviewer verdict: APPROVE (browser-verified) — pnpm check clean, unit 139/139, Playwright iPhone-webkit e2e 5/5 incl. 2 new crop-dismiss specs. AC#2 (edited-region apply + single undo) is code-trace-verified only — no e2e drags a handle yet; left unchecked pending device/desktop verification. Reviewer follow-up ideas: e2e for edited-region apply+undo, Ctrl+Z assertion for the no-op case. dist-web rebuilt after the change.
<!-- SECTION:NOTES:END -->
