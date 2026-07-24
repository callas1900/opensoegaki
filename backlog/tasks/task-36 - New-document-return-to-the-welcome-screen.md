---
id: TASK-36
title: 'New document: return to the welcome screen'
status: Done
assignee: []
created_date: '2026-07-22 16:51'
updated_date: '2026-07-24 09:57'
labels: []
dependencies: []
priority: high
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User request from iPhone testing, but explicitly a WHOLE-APP feature (desktop + web): on the phone the only entry is photo selection, and there is no way back to the welcome screen to start editing a new photo. Add a general 'new document / start over' action that clears the current document and returns to the empty state. Design (architect) to decide: toolbar placement in both shells, data-loss protection (undoable clear vs confirm), Editor reset semantics. Architect ruling pending.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A visible control on both desktop and web returns the app to the welcome screen from a loaded document
- [x] #2 Accidental data loss is guarded (undoable or confirmed)
- [x] #3 After returning, loading a new image (capture/paste/pick) works exactly like a fresh start
- [x] #4 No regression to existing Done-task ACs (welcome screen, undoable background replace)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented + reviewed (approved, nits only). clearDocument undoable via history.push; syncEmptyState wraps undo/redo; New button both shells (leftmost, file-plus icon, Ctrl+N); docScale recompute centralized (fixes latent stale-scale-on-undo web bug); restore render gap fixed per review. 135/135 tests. Pending: device/desktop verification.

2026-07-24 device verification by user (iPhone/web): new-document control returns to welcome, action is undoable (data-loss guard verified), and picking a new photo afterwards works like a fresh start. Remaining: desktop halves of AC#1/AC#3 (visible control + capture/paste re-entry) and AC#4 regression pass in the Windows session.

2026-07-24 Windows verification by user: new-document control present on desktop, returns to welcome; capture/paste/insert work like a fresh start afterwards; no regression to welcome-screen or undoable-background ACs (regression checklist pass same session). Combined with 2026-07-24 iPhone confirmation of the undo guard -> all ACs exercised -> Done.
<!-- SECTION:NOTES:END -->
