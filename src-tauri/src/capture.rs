//! Screen capture via `xcap`. Returns raw PNG bytes; the frontend decides
//! how to display or crop them.

use xcap::Monitor;

/// Capture the primary monitor (fallback: first monitor) as PNG bytes.
pub fn capture_primary_monitor() -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitor found".to_string())?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    let mut png = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png),
            xcap::image::ImageFormat::Png,
        )
        .map_err(|e| e.to_string())?;
    Ok(png)
}
