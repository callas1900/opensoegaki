---
id: TASK-18
title: Replace global capture hotkeys with a toolbar capture button
status: Done
assignee: []
created_date: '2026-07-14 03:12'
updated_date: '2026-07-14 03:42'
labels:
  - feature
dependencies: []
priority: high
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Product decision 2026-07-14: global hotkeys Ctrl+Shift+5/6 are removed; full-screen capture moves to a toolbar button. Region capture is delegated to the OS screenshot tool + paste.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Global shortcuts Ctrl+Shift+5/6 are no longer registered and the plugin dependency is removed
- [x] #2 A toolbar button triggers full-screen capture
- [x] #3 The OpenScrawl window is not visible in the captured image
- [x] #4 Tray tooltip and README no longer mention capture hotkeys
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
tauri-plugin-global-shortcut fully removed (Cargo.toml, capabilities, package.json). New async command capture_fullscreen: spawn_blocking hide->150ms->capture->show->base64 (architect ruling). Window now visible on launch (visible:false removed — architect ruling after E2E found dead first-run). E2E on Windows 11 release build 2026-07-14: Ctrl+Shift+5/6 do nothing (os-e2e-03), toolbar button captured the desktop without the app window in it and the window auto-restored (os-e2e-04). Reviewer approved. NOT yet committed.
<!-- SECTION:NOTES:END -->
