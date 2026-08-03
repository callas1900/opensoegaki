import { test, expect } from "@playwright/test";
import { TALL_PNG_BASE64, WIDE_PNG_BASE64, loadTestImage } from "./fixtures";

/**
 * Regression suite for the inline text editor's effect on the stage's scroll
 * position — two device reports with one root cause: "the canvas is shifted
 * when I try to type text" (iPhone) and "clicking the text tool at the right
 * edge slides the canvas left" (Windows).
 *
 * The editor is a real, absolutely positioned <input> appended to #stage, so
 * it can give #stage scrollable overflow, and any scroll of #stage moves the
 * canvas on screen — with `touch-action: none` while an image is loaded, the
 * user cannot even scroll it back. Runs in BOTH projects on purpose: Chromium
 * and WebKit disagree about scrolling a clipped ancestor to reveal a focused
 * field, so a single-engine version of this suite passed while the other
 * engine's users watched the canvas jump.
 */

test.describe("inline text editor does not move the canvas", () => {
  test("opening the editor near the bottom of the canvas leaves #stage unscrolled and the canvas in place", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTestImage(page, TALL_PNG_BASE64);

    const stage = page.locator("#stage");
    const canvas = page.locator("#canvas");
    const before = (await canvas.boundingBox())!;

    await page.locator('[data-tool="text"]').tap();
    // Near the bottom-right of the canvas: the <input> that opens here
    // extends past the canvas (default input width ~170px) and past the
    // stage's bottom padding.
    await canvas.tap({ position: { x: before.width - 8, y: before.height - 8 } });
    await expect(page.locator(".text-editor")).toBeVisible();

    const scroll = await stage.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
    const after = (await canvas.boundingBox())!;

    expect(scroll).toEqual({ top: 0, left: 0 });
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
    // The canvas holds still because the focus scroll was suppressed, NOT
    // because focus failed to land — without focus the editor could not be
    // typed into at all.
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("text-editor");
  });

  /**
   * The Windows/WebView2 report: clicking the text tool at the RIGHT EDGE of
   * a canvas that fills the stage's width slid the whole canvas left, because
   * focusing the input made the browser scroll #stage to reveal the part of
   * the input hanging past the stage's edge. Chromium does this to an
   * `overflow: hidden` ancestor; WebKit does not — hence the desktop-chromium
   * project.
   */
  test("opening the editor at the canvas's right edge never moves the canvas", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, WIDE_PNG_BASE64);

    const stage = page.locator("#stage");
    const canvas = page.locator("#canvas");
    const before = (await canvas.boundingBox())!;

    await page.locator('[data-tool="text"]').tap();
    await canvas.tap({ position: { x: before.width - 4, y: before.height / 2 } });
    await expect(page.locator(".text-editor")).toBeVisible();
    // Typing is its own scroll trigger — the caret moves further past the
    // stage's edge with every character, and "scroll the caret into view"
    // walks the same ancestor chain the focus reveal does.
    await page.keyboard.type("Hello");

    const after = (await canvas.boundingBox())!;
    expect(await stage.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }))).toEqual({
      top: 0,
      left: 0,
    });
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    // Held still by suppressing the focus scroll, not by failing to focus.
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("text-editor");
  });

  test("a visualViewport resize while the editor is open (soft keyboard) does not move the canvas", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTestImage(page, TALL_PNG_BASE64);

    const stage = page.locator("#stage");
    const canvas = page.locator("#canvas");
    const before = (await canvas.boundingBox())!;

    await page.locator('[data-tool="text"]').tap();
    await canvas.tap({ position: { x: before.width / 2, y: before.height - 8 } });
    await expect(page.locator(".text-editor")).toBeVisible();

    // Playwright cannot open a real soft keyboard; synthesize the events iOS
    // fires when it opens (visualViewport resize + scroll).
    await page.evaluate(() => {
      window.visualViewport?.dispatchEvent(new Event("resize"));
      window.visualViewport?.dispatchEvent(new Event("scroll"));
    });

    const scroll = await stage.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }));
    const after = (await canvas.boundingBox())!;

    expect(scroll).toEqual({ top: 0, left: 0 });
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
  });

  /**
   * TASK-35.10 AC#3 regression: "inline text input is never hidden by the iOS
   * keyboard". WebKit under Playwright never opens a real keyboard, so the
   * visual viewport is stubbed to the size iOS reports while one is up — the
   * only signal `applyKeyboardInset` reads.
   */
  test("a shrunk visual viewport (keyboard up) lifts the input above the keyboard by shrinking the stage, not scrolling it", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTestImage(page, TALL_PNG_BASE64);

    const stage = page.locator("#stage");
    const canvas = page.locator("#canvas");
    const editor = page.locator(".text-editor");
    const before = (await canvas.boundingBox())!;

    await page.locator('[data-tool="text"]').tap();
    // Bottom of the image: without an inset this input sits deep under the
    // simulated keyboard.
    await canvas.tap({ position: { x: before.width / 2, y: before.height - 6 } });
    await expect(editor).toBeVisible();

    // 844px viewport, ~424px of keyboard -> a 420px visual viewport.
    const KEYBOARD_TOP = 420;
    await page.evaluate((height) => {
      const vv = window.visualViewport;
      if (!vv) throw new Error("visualViewport unavailable");
      Object.defineProperty(vv, "height", { configurable: true, value: height });
      Object.defineProperty(vv, "offsetTop", { configurable: true, value: 0 });
      vv.dispatchEvent(new Event("resize"));
    }, KEYBOARD_TOP);

    // The stage shrink runs through a ResizeObserver -> canvas refit ->
    // input reposition, so poll rather than reading one frame too early.
    await expect
      .poll(async () => (await editor.boundingBox())!.y + (await editor.boundingBox())!.height)
      .toBeLessThanOrEqual(KEYBOARD_TOP);

    const shrunk = (await canvas.boundingBox())!;
    expect(shrunk.y + shrunk.height).toBeLessThanOrEqual(KEYBOARD_TOP);
    expect(await stage.evaluate((el) => ({ top: el.scrollTop, left: el.scrollLeft }))).toEqual({
      top: 0,
      left: 0,
    });

    // Closing the editor releases the inset and restores the canvas exactly.
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    expect(await stage.evaluate((el) => el.style.maxHeight)).toBe("");
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeCloseTo(before.height, 0);
  });
});
