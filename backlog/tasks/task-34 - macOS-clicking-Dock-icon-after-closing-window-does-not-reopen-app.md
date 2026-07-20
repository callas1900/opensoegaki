---
id: TASK-34
title: 'macOS: clicking Dock icon after closing window does not reopen app'
status: In Progress
assignee: []
created_date: '2026-07-20 07:01'
updated_date: '2026-07-20 17:38'
labels:
  - platform
  - macos
  - bug
dependencies: []
priority: high
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On macOS, after the user closes the app window with the standard red close button, the app remains active in the Dock (this is expected macOS behavior — closing a window should not quit the app). However, clicking the Dock icon again does nothing: no window reopens, so the app appears unresponsive and the user has no way to get back to it short of quitting from the Dock and relaunching.

Likely cause: the Tauri app has no macOS "reopen" / activation handler (the `NSApplicationDelegate applicationShouldHandleReopen:hasVisibleWindows:` equivalent) to show/recreate the main window when the Dock icon is clicked with no visible windows.

macOS only — does not affect Windows.

---
Implementation note (2026-07-21): Fixed by handling `tauri::RunEvent::Reopen` in the `.run()` closure in `src-tauri/src/lib.rs`, calling the existing `show_main_window()` helper (already used by the tray "Open" menu item). The match arm carries `#[cfg(target_os = "macos")]`: the `Reopen` variant is cfg-gated to macOS in the tauri crate itself, so without the attribute the code does not compile on Windows (E0599 — caught by CI clippy on windows-latest after the first attempt landed without the guard; docs.rs "Available on macOS only" means the variant does not exist on other targets, not merely that it never fires). With the guard, the arm is compiled out on Windows and behavior there is unchanged (AC #2).

AC #1 wording clarified with user: `win.hide()`/`win.show()` never reload the webview, so the frontend's last state (e.g. an in-progress annotation) is preserved across the hide/show cycle rather than reset to the welcome screen. Forcing a reset would discard unsaved user work, which conflicts with the app's non-destructive design. User confirmed (2026-07-21): preserve current state on reopen; do not force a welcome-screen reset. AC #1 should be read as "the window reopens" — no frontend change was made for this task.

Reviewed by `reviewer` agent: no blocking findings, no regression against Done tasks TASK-6/TASK-3/TASK-14. `cargo fmt` clean; `cargo clippy`/build could not run in this WSL environment (pre-existing wayland-sys/pkg-config gap, unrelated to this change) — Windows compile is verified by CI's clippy job, macOS compile by CI's rust-macos-check job.

Remains In Progress pending manual macOS (and Windows smoke-test) verification via `pnpm tauri dev`, per this repo's Done-means-verified policy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Given the app is running with the window closed via the standard close button (still active in the Dock), when the user clicks the Dock icon, then the app window reopens showing the initial/welcome screen
- [ ] #2 Windows behavior is unaffected by the fix
<!-- AC:END -->
