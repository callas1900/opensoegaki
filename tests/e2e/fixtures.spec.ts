import { test, expect } from "@playwright/test";
import { SMALL_PNG_BASE64, TALL_PNG_BASE64, WIDE_PNG_BASE64, loadTestImage } from "./fixtures";

/**
 * Guards the suite's own inputs: every shared fixture must actually decode,
 * in every project's engine, into a canvas of the size the specs assume.
 *
 * This exists because three specs shipped truncated PNGs for months — WebKit
 * renders those anyway, so the WebKit-only suite stayed green while the same
 * bytes were undecodable in Chromium. A fixture that regresses now fails
 * here, naming itself, instead of surfacing as a timeout inside whichever
 * feature spec happened to use it.
 */
const FIXTURES = [
  { name: "SMALL_PNG_BASE64", base64: SMALL_PNG_BASE64, width: "120", height: "90" },
  { name: "TALL_PNG_BASE64", base64: TALL_PNG_BASE64, width: "120", height: "900" },
  { name: "WIDE_PNG_BASE64", base64: WIDE_PNG_BASE64, width: "800", height: "200" },
];

for (const fixture of FIXTURES) {
  test(`${fixture.name} decodes into a ${fixture.width}x${fixture.height} canvas`, async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, fixture.base64);
    // The canvas element's width/height ATTRIBUTES are the decoded bitmap's
    // own dimensions (Editor.setBackground copies them straight off the
    // ImageBitmap), independent of the on-screen CSS box.
    const canvas = page.locator("#canvas");
    await expect(canvas).toHaveAttribute("width", fixture.width);
    await expect(canvas).toHaveAttribute("height", fixture.height);
  });
}
