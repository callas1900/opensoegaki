//! macOS Screen Recording permission handling.
//!
//! macOS requires the user to grant Screen Recording access (Privacy &
//! Security → Screen Recording) before `xcap` can capture the screen. This
//! module wraps the two relevant CoreGraphics calls via raw FFI (no extra
//! crate needed) and a helper to jump straight to the relevant Settings pane.
//! On non-macOS platforms every function is a no-op that reports success, so
//! `capture_fullscreen` needs no `#[cfg]` branching of its own.

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Returns `true` if OpenSoegaki already has (or, on non-macOS, never needs)
/// Screen Recording access.
///
/// On macOS: preflights the current TCC state; if not yet granted, calls
/// `CGRequestScreenCaptureAccess()`, which seeds the TCC entry and shows the
/// one-time system permission prompt. Per Apple's documented behavior, this
/// call's return value — and the permission itself — only takes effect after
/// the app is restarted, so this will still return `false` immediately after
/// the user grants access in Settings.
#[cfg(target_os = "macos")]
pub fn ensure_screen_capture_access() -> bool {
    if unsafe { CGPreflightScreenCaptureAccess() } {
        return true;
    }
    unsafe { CGRequestScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
pub fn ensure_screen_capture_access() -> bool {
    true
}

/// Open System Settings directly to the Screen Recording pane, so the user
/// doesn't have to navigate Privacy & Security manually.
#[cfg(target_os = "macos")]
pub fn open_screen_recording_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn open_screen_recording_settings() -> Result<(), String> {
    Ok(())
}
