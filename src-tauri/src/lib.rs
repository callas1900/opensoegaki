//! OpenScrawl core: tray residency, capture commands, drag-out.

mod capture;

use base64::Engine;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

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
        .join("openscrawl");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = dir.join(format!("scrawl-{ts}.png"));
    std::fs::write(&path, png).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            prepare_drag_file,
            capture_fullscreen
        ])
        .setup(|app| {
            // Tray icon with a minimal menu; closing the window hides to tray.
            let open = MenuItem::with_id(app, "open", "Open OpenScrawl", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .menu(&menu)
                .tooltip("OpenScrawl — paste a screenshot to annotate")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        cleanup_temp(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide instead of quitting: OpenScrawl is a tray-resident utility.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running OpenScrawl");
}

fn cleanup_temp(app: &AppHandle) {
    if let Ok(dir) = app.path().temp_dir() {
        let _ = std::fs::remove_dir_all(dir.join("openscrawl"));
    }
}
