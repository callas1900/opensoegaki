//! Screen capture via `xcap`. Returns raw PNG bytes; the frontend decides
//! how to display or crop them.

use xcap::image::RgbaImage;
use xcap::Monitor;

/// Encode an RGBA image to PNG bytes. Extracted from `capture_primary_monitor`
/// so the real capture path and the synthetic bench test
/// (`tests::bench_synthetic_4k_encode`) exercise the exact same encoding
/// routine.
fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut png),
            xcap::image::ImageFormat::Png,
        )
        .map_err(|e| e.to_string())?;
    Ok(png)
}

/// Capture the primary monitor (fallback: first monitor) as PNG bytes.
pub fn capture_primary_monitor() -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| "no monitor found".to_string())?;

    #[cfg(debug_assertions)]
    let xcap_start = std::time::Instant::now();
    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    #[cfg(debug_assertions)]
    let xcap_elapsed = xcap_start.elapsed();

    #[cfg(debug_assertions)]
    let png_start = std::time::Instant::now();
    let png = encode_png(&image)?;
    #[cfg(debug_assertions)]
    let png_elapsed = png_start.elapsed();

    // Perf instrumentation only: debug builds print one line to stderr per
    // capture (never pixel data) so the IPC path's cost can be profiled
    // without a debugger. The payload's IPC transfer size is logged
    // separately by the caller in lib.rs.
    #[cfg(debug_assertions)]
    eprintln!(
        "[perf] capture {}x{} xcap={}ms png={}ms png_bytes={}",
        image.width(),
        image.height(),
        xcap_elapsed.as_millis(),
        png_elapsed.as_millis(),
        png.len()
    );

    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 3840x2160 RGBA image with per-pixel variation (not a flat color).
    /// A flat image compresses unrealistically fast under PNG and would
    /// understate the real-world encode cost this bench measures.
    /// Note: this XOR/gradient pattern is noise-like and barely compresses
    /// (~9.7MB PNG), a conservative worst case that overstates payload size
    /// and encode cost versus a real 4K UI screenshot with flat regions
    /// (typically ~1-4MB) — treat these numbers as an upper bound, not representative.
    fn synthetic_4k_image() -> RgbaImage {
        RgbaImage::from_fn(3840, 2160, |x, y| {
            xcap::image::Rgba([(x % 256) as u8, (y % 256) as u8, ((x ^ y) % 256) as u8, 255])
        })
    }

    /// Measures PNG-encode cost on a synthetic 4K frame via the same
    /// `encode_png` routine the real capture path uses, without needing an
    /// actual display (so it runs in CI). This is a measurement probe, not a
    /// perf gate: no timing assertions, since CI runners vary. Run with
    /// `cargo test -- --nocapture` to see the `[bench]` line.
    #[test]
    fn bench_synthetic_4k_encode() {
        let image = synthetic_4k_image();

        let png_start = std::time::Instant::now();
        let png = encode_png(&image).expect("PNG encode should succeed");
        let png_elapsed = png_start.elapsed();

        eprintln!(
            "[bench] 4k encode png={}ms png_bytes={}",
            png_elapsed.as_millis(),
            png.len()
        );

        assert!(!png.is_empty());
    }
}
