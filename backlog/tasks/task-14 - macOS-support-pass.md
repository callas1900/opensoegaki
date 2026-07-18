---
id: TASK-14
title: macOS support pass
status: Done
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-18 17:16'
labels:
  - platform
dependencies: []
priority: low
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per docs/ARCHITECTURE.md roadmap: Screen Recording permission UX, .icns icon, and new default hotkeys (Cmd+Shift+5 collides with the system screenshot tool). xcap and tauri-plugin-drag already support macOS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 App captures and annotates on macOS with a granted Screen Recording permission flow
- [x] #2 Non-colliding default hotkeys chosen and documented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-18 (pending macOS on-device verification before Done).

AC#2 interpretation (user-approved 2026-07-18): the app intentionally registers NO global hotkeys (tauri-plugin-global-shortcut not used); all shortcuts are in-app DOM handlers already using metaKey, so there is no possible collision with Cmd+Shift+5. AC#2 therefore reduces to verifying the in-app Cmd shortcuts on macOS and documenting the macOS hotkey table in README (done). A true global capture hotkey would be a separate feature task.

- src-tauri/src/permission.rs (new): cfg(macos) raw FFI to CGPreflightScreenCaptureAccess / CGRequestScreenCaptureAccess (no new crate); non-macOS stubs always granted. open_screen_recording_settings opens the Screen Recording pane via 'open x-apple.systempreferences:...Privacy_ScreenCapture'.
- lib.rs: capture_fullscreen preflights BEFORE hiding the window and returns sentinel Err("SCREEN_RECORDING_PERMISSION") when not granted (first denial also fires the one-time system prompt via CGRequestScreenCaptureAccess). New command open_screen_recording_settings registered.
- Frontend: permission modal (role=dialog, aria-modal, focus management, Escape/backdrop dismiss) with Open Settings / Dismiss; copy tells the user to grant and RESTART the app (macOS applies the permission only after restart).
- CI: new rust-macos-check job (macos-latest, cargo check) so the cfg(macos) FFI branch compiles on every push.
- No Info.plist NSScreenCaptureUsageDescription (not needed for xcap's CGDisplayCreateImage path).

Remaining for Done: on the Apple Silicon Mac — install the .dmg from the release, Gatekeeper right-click-Open, capture -> modal -> Open Settings -> grant -> restart -> capture+annotate works (AC1); verify Cmd shortcuts and check AC2.

Verified by the user on the Apple Silicon Mac (2026-07-19): installed from the v0.1.0 release .dmg. Note: Gatekeeper showed the 'damaged and can't be opened' dialog (unsigned app), which right-click->Open does NOT bypass; cleared with 'xattr -dr com.apple.quarantine'. Capture, annotation, and in-app Cmd shortcuts confirmed working (AC1/AC2). README's Gatekeeper section updated accordingly (xattr as the primary workaround). Follow-up candidates discussed with the user, not tasked yet: Developer ID signing + notarization (removes the dialog entirely), Homebrew tap distribution.
<!-- SECTION:NOTES:END -->
