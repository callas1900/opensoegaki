import { test, expect } from "@playwright/test";

/**
 * Real-iPhone-viewport regression suite for the inline text editor's effect
 * on the stage's scroll position (reported on-device: "the canvas is shifted
 * when I try to type text").
 *
 * The editor is a real, absolutely-positioned <input> appended to #stage,
 * which is `overflow: auto`. Anything that scrolls #stage moves the canvas
 * on-screen — and while an image is loaded #stage has `touch-action: none`,
 * so the user cannot scroll it back by hand.
 */

/** Tall (120x900) portrait PNG — same fixture idea as badge-bar.spec.ts: height-constrained on a 390x844 viewport. */
const TALL_TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAOECAIAAADlvmJ6AAAEdklEQVR42u3QQQ0AAAgEoAtrCCMayxZ+ZCMBqR4ORIFo0YgWLdqCaNGIFi3agmjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiRSsQLRrRokVbEC0a0aJFWxAtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNatGgFokUjWrRoC6JFI1q0aAuiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEixatQLRoRIsWbUG0aESLFm1BtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRor9YQ1BMDakl4j0AAAAASUVORK5CYII=";

async function loadTallTestImage(page: import("@playwright/test").Page): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#welcome-pick").tap();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "tall.png",
    mimeType: "image/png",
    buffer: Buffer.from(TALL_TEST_PNG_BASE64, "base64"),
  });
  await expect(page.locator("#stage")).not.toHaveClass(/empty/);
}

test.describe("inline text editor does not move the canvas", () => {
  test("opening the editor near the bottom of the canvas leaves #stage unscrolled and the canvas in place", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTallTestImage(page);

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
  });

  test("a visualViewport resize while the editor is open (soft keyboard) does not move the canvas", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTallTestImage(page);

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
    await loadTallTestImage(page);

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
