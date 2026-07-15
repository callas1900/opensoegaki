//! OpenSoegaki core: tray residency, capture commands, drag-out.

mod capture;

use base64::Engine;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

/// Subdirectory name (under the OS temp dir) used for drag-out files.
/// Shared by `prepare_drag_file` (write path) and `cleanup_temp` (cleanup
/// path) so the two cannot drift apart.
const TEMP_SUBDIR: &str = "opensoegaki";

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Hide the main window, let the compositor repaint without it, capture the
/// primary monitor, then restore the window. Returns a base64 PNG.
///
/// The window is always restored, even on capture failure, so the app never
/// gets stuck hidden. The hide/sleep/capture/show sequence runs on a blocking
/// task (window methods are thread-safe to call from there) so the sleep
/// never occupies an async worker thread.
#[tauri::command]
async fn capture_fullscreen(app: AppHandle) -> Result<String, String> {
    let png = tauri::async_runtime::spawn_blocking(move || {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide();
        }

        // Give the compositor time to repaint the desktop without our window.
        // ~150ms is a starting point; may need tuning per platform/hardware.
        std::thread::sleep(std::time::Duration::from_millis(150));

        let result = capture::capture_primary_monitor();
        show_main_window(&app);
        result
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

/// Write the exported PNG to a temp file so the OS drag can reference a path.
/// The file is intentionally short-lived; a cleanup pass runs on app exit.
#[tauri::command]
fn prepare_drag_file(app: AppHandle, png: Vec<u8>) -> Result<String, String> {
    let dir = app
        .path()
        .temp_dir()
        .map_err(|e| e.to_string())?
        .join(TEMP_SUBDIR);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = write_drag_file(&dir, ts, &png).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Create `dir` if needed and write `png` to `dir/soegaki-<ts>.png`.
/// Pure file-logic helper, extracted from `prepare_drag_file` so it is
/// testable without an `AppHandle`.
fn write_drag_file(
    dir: &std::path::Path,
    ts: u128,
    png: &[u8],
) -> std::io::Result<std::path::PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("soegaki-{ts}.png"));
    std::fs::write(&path, png)?;
    Ok(path)
}

/// Show a native save dialog pre-filled with `default_name`, then write the
/// PNG bytes to the chosen path. Returns the saved path, or `None` if the
/// user cancelled the dialog. Runs the dialog on Tauri's async runtime
/// (never a blocking dialog on the main thread), which is required for
/// correctness on macOS and harmless on Windows.
#[tauri::command]
async fn save_png(png: Vec<u8>, default_name: String) -> Result<Option<String>, String> {
    let file = rfd::AsyncFileDialog::new()
        .set_file_name(&default_name)
        .add_filter("PNG image", &["png"])
        .save_file()
        .await;
    match file {
        Some(file) => {
            std::fs::write(file.path(), &png).map_err(|e| e.to_string())?;
            Ok(Some(file.path().to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            prepare_drag_file,
            capture_fullscreen,
            save_png
        ])
        .setup(|app| {
            // Tray icon with a minimal menu; closing the window hides to tray.
            let open = MenuItem::with_id(app, "open", "Open OpenSoegaki", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .menu(&menu)
                .tooltip("OpenSoegaki — paste a screenshot to annotate")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    // Cleanup happens in the RunEvent::Exit handler below, which
                    // app.exit(0) reliably triggers.
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide instead of quitting: OpenSoegaki is a tray-resident utility.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenSoegaki")
        .run(|app, event| {
            // Remove the temp drag-file directory however the process ends
            // (tray quit, OS shutdown, etc.), not just on the tray Quit path.
            if let tauri::RunEvent::Exit = event {
                cleanup_temp(app);
            }
        });
}

fn cleanup_temp(app: &AppHandle) {
    if let Ok(dir) = app.path().temp_dir() {
        let _ = std::fs::remove_dir_all(dir.join(TEMP_SUBDIR));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Unique temp subdir for a single test, cleaned up by the caller.
    fn unique_test_dir(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("opensoegaki-test-{label}-{nanos}"))
    }

    #[test]
    fn write_drag_file_names_file_with_timestamp() {
        let dir = unique_test_dir("name");
        let ts: u128 = 1234567890;
        let path = write_drag_file(&dir, ts, b"data").unwrap();
        assert_eq!(path.file_name().unwrap(), "soegaki-1234567890.png");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_drag_file_roundtrips_bytes() {
        let dir = unique_test_dir("roundtrip");
        let bytes = b"not really a png but bytes are bytes";
        let path = write_drag_file(&dir, 42, bytes).unwrap();
        let read_back = std::fs::read(&path).unwrap();
        assert_eq!(read_back, bytes);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_drag_file_creates_missing_parent_dir() {
        let dir = unique_test_dir("nested").join("a").join("b");
        assert!(!dir.exists());
        let path = write_drag_file(&dir, 1, b"x").unwrap();
        assert!(path.exists());
        // remove_dir_all from the top-level unique root, three levels up.
        std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap()).unwrap();
    }

    #[test]
    fn write_drag_file_distinct_timestamps_do_not_overwrite() {
        let dir = unique_test_dir("distinct");
        let path1 = write_drag_file(&dir, 1, b"one").unwrap();
        let path2 = write_drag_file(&dir, 2, b"two").unwrap();
        assert_ne!(path1, path2);
        assert!(path1.exists());
        assert!(path2.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cleanup_removes_the_written_file() {
        // Exercises the same TEMP_SUBDIR contract that cleanup_temp() uses,
        // without needing an AppHandle: write into <root>/TEMP_SUBDIR, then
        // remove_dir_all(<root>/TEMP_SUBDIR) as cleanup_temp does.
        let root = unique_test_dir("cleanup");
        let dir = root.join(TEMP_SUBDIR);
        let path = write_drag_file(&dir, 7, b"bye").unwrap();
        assert!(path.exists());
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
