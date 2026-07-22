/**
 * Import-size clamp (TASK-35.14, round 6: made web-only). iOS Safari's
 * canvas has hard pixel-count limits that blank out very large images (e.g.
 * 12 MP photos) rather than erroring — see docs/WEB.md risk #5. Desktop has
 * no such limit and is intentionally unbounded: every caller threads a
 * `max: number | null` through — `null` means "no clamp, exact pre-clamp
 * full-resolution behavior" (desktop), a number is the longest allowed side
 * in px (web's `MAX_IMPORT_DIMENSION`). Every bytes/Blob -> ImageBitmap
 * decode in the app (background loads and inserted-image annotations alike)
 * goes through `decodeClampedBitmap`, so the one code path serves both
 * platforms even though only one of them actually clamps.
 */

/** Longest side, in px, an imported image is allowed to keep on the web build. */
export const MAX_IMPORT_DIMENSION = 4096;

/**
 * Pure clamp math: with `max === null`, returns `{ width, height }`
 * unchanged unconditionally (no limit). Otherwise returns them unchanged if
 * already within `max`, or the same aspect ratio scaled down so the longest
 * side is exactly `max` (rounded to whole px).
 */
export function clampImportSize(
  width: number,
  height: number,
  max: number | null,
): { width: number; height: number } {
  if (max === null) return { width, height };
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Decode `source` to an `ImageBitmap`. With `max === null`, this is exactly
 * `createImageBitmap(source)` — no `OffscreenCanvas` redraw at any size, the
 * literal pre-clamp behavior. With a `max`, redraws through an
 * `OffscreenCanvas` to `clampImportSize`'s target dimensions if the decoded
 * bitmap exceeds it; returns the first decode's bitmap unchanged (no extra
 * redraw) when already within the limit.
 */
export async function decodeClampedBitmap(
  source: Blob | ImageBitmapSource,
  max: number | null,
): Promise<ImageBitmap> {
  const raw = await createImageBitmap(source as ImageBitmapSource);
  if (max === null) return raw;
  const { width, height } = clampImportSize(raw.width, raw.height, max);
  if (width === raw.width && height === raw.height) return raw;
  const off = new OffscreenCanvas(width, height);
  const ctx = off.getContext("2d");
  if (!ctx) {
    raw.close();
    throw new Error("2D context unavailable");
  }
  // Default smoothing quality aliases a large photo downscale noticeably;
  // ask for the best available resampling explicitly.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(raw, 0, 0, width, height);
  raw.close();
  return createImageBitmap(off);
}
