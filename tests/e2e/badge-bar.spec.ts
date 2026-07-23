import { test, expect } from "@playwright/test";

/**
 * Real-iPhone-viewport regression suite for the badge fixed-number bottom
 * bar (TASK-38 round 3 / TASK-39). The bar is purely toolbar-driven
 * (setTool/setBadgeFixedNumber neither require nor touch the loaded image —
 * see canvas.ts's onDown, which only gates *placing* a badge on hasImage()),
 * so these tests exercise the toolbar directly against the welcome/empty-
 * editor screen; no fixture image needs to be loaded.
 */

/**
 * A tall (120x900) portrait PNG, generated once and inlined as base64 (same
 * pattern as crop-dismiss.spec.ts's fixture, which is landscape and
 * therefore unsuitable here): its aspect ratio makes it height-constrained
 * on the 390x844 iPhone viewport, so shrinking #stage's height when the
 * badge bar opens is the binding constraint the JS-driven canvas sizing
 * (TASK-38 follow-up) must react to.
 */
const TALL_TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAOECAIAAADlvmJ6AAAEdklEQVR42u3QQQ0AAAgEoAtrCCMayxZ+ZCMBqR4ORIFo0YgWLdqCaNGIFi3agmjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiRSsQLRrRokVbEC0a0aJFWxAtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNatGgFokUjWrRoC6JFI1q0aAuiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEixatQLRoRIsWbUG0aESLFm1BtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRor9YQ1BMDakl4j0AAAAASUVORK5CYII=";

/** Mirrors crop-dismiss.spec.ts's `loadTestImage` helper, taking the PNG bytes as a parameter. */
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

test.describe("badge fixed-number bottom bar", () => {
  test("second tap on the badge tool opens the bar and replaces the share bar; one tap alone does not", async ({
    page,
  }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    const bar = page.locator("#badge-bar");
    const shareBar = page.locator("#share-bar");

    await badgeTool.tap();
    await expect(bar).toBeHidden();
    await expect(shareBar).toBeVisible();

    await badgeTool.tap();
    await expect(bar).toBeVisible();
    // The bar is an in-flow #app flex child that REPLACES #share-bar while
    // open (see body.badge-bar-open in styles.css) rather than overlaying
    // it, so the stage beneath stays fully visible/tappable.
    await expect(shareBar).toBeHidden();

    await page.locator("#badge-bar-close").tap();
    await expect(bar).toBeHidden();
    await expect(shareBar).toBeVisible();
  });

  test("the open bar does not cover the stage", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    const bar = page.locator("#badge-bar");
    const stage = page.locator("#stage");

    await badgeTool.tap();
    await badgeTool.tap();
    await expect(bar).toBeVisible();

    const barBox = await bar.boundingBox();
    const stageBox = await stage.boundingBox();
    expect(barBox).not.toBeNull();
    expect(stageBox).not.toBeNull();
    // In-flow layout: the stage shrinks to make room for the bar, so their
    // boxes must not intersect vertically — the whole photo stays visible
    // and tappable, unlike the old fixed-overlay bar that covered it.
    expect(stageBox!.y + stageBox!.height).toBeLessThanOrEqual(barBox!.y + 0.5);
  });

  test("badge tool icon swaps between auto and fixed glyphs with the bar", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    const iconAuto = badgeTool.locator('[data-badge-icon="auto"]');
    const iconFixed = badgeTool.locator('[data-badge-icon="fixed"]');

    await expect(iconAuto).toBeVisible();
    await expect(iconFixed).toBeHidden();

    await badgeTool.tap();
    await badgeTool.tap();
    await expect(page.locator("#badge-bar")).toBeVisible();
    await expect(iconFixed).toBeVisible();
    await expect(iconAuto).toBeHidden();

    await page.locator("#badge-bar-close").tap();
    await expect(page.locator("#badge-bar")).toBeHidden();
    await expect(iconAuto).toBeVisible();
    await expect(iconFixed).toBeHidden();
  });

  test("digit tap keeps the bar open and moves the accent", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    const bar = page.locator("#badge-bar");
    await expect(bar).toBeVisible();

    await page.locator('#badge-digits button[data-num="3"]').tap();
    await expect(bar).toBeVisible();
    await expect(page.locator('#badge-digits button[data-num="3"]')).toHaveClass(/active/);

    await page.locator('#badge-digits button[data-num="5"]').tap();
    await expect(bar).toBeVisible();
    await expect(page.locator('#badge-digits button[data-num="5"]')).toHaveClass(/active/);
    await expect(page.locator('#badge-digits button[data-num="3"]')).not.toHaveClass(/active/);
  });

  test("the close button returns to auto sequence", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    const bar = page.locator("#badge-bar");
    await expect(bar).toBeVisible();

    await page.locator("#badge-bar-close").tap();
    await expect(bar).toBeHidden();
  });

  test("switching tools closes the bar", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    const bar = page.locator("#badge-bar");
    await expect(bar).toBeVisible();

    await page.locator('[data-tool="select"]').tap();
    await expect(bar).toBeHidden();
  });

  test("a soft-keyboard-style resize while the number input is focused does not dismiss the bar; the custom chip commits without closing it", async ({
    page,
  }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    const bar = page.locator("#badge-bar");
    await expect(bar).toBeVisible();

    const input = page.locator("#badge-num-input");
    await input.focus();
    // Simulates the resize iOS fires when the soft keyboard opens/closes.
    // The bar is not registered with the popover manager at all, so this
    // must never dismiss it, focused or not.
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await expect(bar).toBeVisible();

    const chip = page.locator("#badge-num-chip");
    await input.fill("12");
    // Live label: the chip mirrors the typed value while the input has text.
    await expect(chip).toHaveText("12");
    await expect(chip).toBeEnabled();

    await chip.tap();
    await expect(bar).toBeVisible();
    await expect(input).toHaveValue("");
    await expect(chip).toHaveClass(/active/);
    await expect(chip).toHaveText("12");
    await expect(badgeTool.locator('[data-badge-icon="fixed"] [data-badge-glyph]')).toHaveText("12");

    // Tapping a digit chip moves the accent there, but the custom chip keeps
    // its own label ("12") for a one-tap return — it just loses .active.
    await page.locator('#badge-digits button[data-num="3"]').tap();
    await expect(page.locator('#badge-digits button[data-num="3"]')).toHaveClass(/active/);
    await expect(chip).not.toHaveClass(/active/);
    await expect(chip).toHaveText("12");

    // Tapping the custom chip again re-pins its remembered value.
    await chip.tap();
    await expect(chip).toHaveClass(/active/);
    await expect(chip).toHaveText("12");
    await expect(page.locator('#badge-digits button[data-num="3"]')).not.toHaveClass(/active/);
    await expect(badgeTool.locator('[data-badge-icon="fixed"] [data-badge-glyph]')).toHaveText("12");

    // Same-size requirement (TASK-38 round 5): the custom chip must render
    // at exactly the same size as a digit chip.
    const chipBox = await chip.boundingBox();
    const digitBox = await page.locator('#badge-digits button[data-num="3"]').boundingBox();
    expect(chipBox).not.toBeNull();
    expect(digitBox).not.toBeNull();
    expect(Math.abs(chipBox!.width - digitBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(chipBox!.height - digitBox!.height)).toBeLessThanOrEqual(1);
  });

  test("typing a single digit and committing via the custom chip lights the matching digit chip, not the custom chip", async ({
    page,
  }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    const bar = page.locator("#badge-bar");
    await expect(bar).toBeVisible();

    const input = page.locator("#badge-num-input");
    const chip = page.locator("#badge-num-chip");
    const digitFive = page.locator('#badge-digits button[data-num="5"]');

    await input.fill("5");
    await chip.tap();

    // n<=9 branch (syncActiveState's `n > 9` guard in badgebar.ts): a typed
    // 0-9 value lights the matching digit chip, never the custom chip.
    await expect(digitFive).toHaveClass(/active/);
    await expect(chip).not.toHaveClass(/active/);
    // refreshChipLabel falls back to the now-remembered lastCustom (5) once
    // commit() clears the input.
    await expect(chip).toHaveText("5");
  });

  test("a fresh bar open with no prior custom commit shows the custom chip disabled with an empty label", async ({
    page,
  }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    await expect(page.locator("#badge-bar")).toBeVisible();

    // First open in a fresh page: lastCustom is still null, so
    // refreshChipLabel() disables the chip and falls back to an empty label.
    const chip = page.locator("#badge-num-chip");
    await expect(chip).toBeDisabled();
    await expect(chip).toHaveText("");
  });

  test("the close button never overlaps the digit grid", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    await expect(page.locator("#badge-bar")).toBeVisible();

    const closeBox = await page.locator("#badge-bar-close").boundingBox();
    const digitsBox = await page.locator("#badge-digits").boundingBox();
    expect(closeBox).not.toBeNull();
    expect(digitsBox).not.toBeNull();
    expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(digitsBox!.y + 0.5);
  });

  test("no digit overflows the bar", async ({ page }) => {
    await page.goto("/");
    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();

    const bar = page.locator("#badge-bar");
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    expect(barBox).not.toBeNull();

    const digitButtons = page.locator("#badge-digits button");
    const count = await digitButtons.count();
    expect(count).toBe(10);
    for (let i = 0; i < count; i++) {
      const box = await digitButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(barBox!.x);
      expect(box!.y).toBeGreaterThanOrEqual(barBox!.y);
      expect(box!.x + box!.width).toBeLessThanOrEqual(barBox!.x + barBox!.width + 0.5);
      expect(box!.y + box!.height).toBeLessThanOrEqual(barBox!.y + barBox!.height + 0.5);
    }
  });

  test("open bar rescales a loaded image and closing restores it", async ({ page }) => {
    await page.goto("/");
    await loadTallTestImage(page);

    const badgeTool = page.locator('[data-tool="badge"]');
    const bar = page.locator("#badge-bar");
    const stage = page.locator("#stage");
    const canvas = page.locator("#canvas");

    await badgeTool.tap();
    await badgeTool.tap();
    await expect(bar).toBeVisible();

    const canvasBoxOpen = await canvas.boundingBox();
    const stageBoxOpen = await stage.boundingBox();
    const barBoxOpen = await bar.boundingBox();
    expect(canvasBoxOpen).not.toBeNull();
    expect(stageBoxOpen).not.toBeNull();
    expect(barBoxOpen).not.toBeNull();

    // The canvas must fit entirely inside the (now-shrunken) stage — in
    // particular its bottom edge must not spill past the stage's bottom,
    // which is the real-iPhone bug this test guards against (JS-driven
    // sizing keeps the canvas display box in sync with the stage even when
    // iOS Safari fails to re-resolve max-width/max-height percentages).
    expect(canvasBoxOpen!.y).toBeGreaterThanOrEqual(stageBoxOpen!.y - 0.5);
    expect(canvasBoxOpen!.x).toBeGreaterThanOrEqual(stageBoxOpen!.x - 0.5);
    expect(canvasBoxOpen!.y + canvasBoxOpen!.height).toBeLessThanOrEqual(stageBoxOpen!.y + stageBoxOpen!.height + 0.5);
    expect(canvasBoxOpen!.x + canvasBoxOpen!.width).toBeLessThanOrEqual(stageBoxOpen!.x + stageBoxOpen!.width + 0.5);

    // And it must not overlap the open bar.
    const canvasBottom = canvasBoxOpen!.y + canvasBoxOpen!.height;
    expect(canvasBottom).toBeLessThanOrEqual(barBoxOpen!.y + 0.5);

    await page.locator("#badge-bar-close").tap();
    await expect(bar).toBeHidden();

    const canvasBoxClosed = await canvas.boundingBox();
    const stageBoxClosed = await stage.boundingBox();
    expect(canvasBoxClosed).not.toBeNull();
    expect(stageBoxClosed).not.toBeNull();

    // Closing the bar gives the stage its height back; the canvas must grow
    // back to fill it rather than staying stuck at the smaller, open-bar size.
    expect(canvasBoxClosed!.height).toBeGreaterThan(canvasBoxOpen!.height);
    expect(canvasBoxClosed!.y).toBeGreaterThanOrEqual(stageBoxClosed!.y - 0.5);
    expect(canvasBoxClosed!.x).toBeGreaterThanOrEqual(stageBoxClosed!.x - 0.5);
    expect(canvasBoxClosed!.y + canvasBoxClosed!.height).toBeLessThanOrEqual(
      stageBoxClosed!.y + stageBoxClosed!.height + 0.5,
    );
    expect(canvasBoxClosed!.x + canvasBoxClosed!.width).toBeLessThanOrEqual(
      stageBoxClosed!.x + stageBoxClosed!.width + 0.5,
    );
  });

  /**
   * Asserts the canvas's on-screen box (a) preserves the aspect ratio of the
   * canvas element's width/height *attributes* (the true bitmap ratio) and
   * (b) sits fully inside the stage box. Used by the regression test below
   * after every step that resizes #stage.
   */
  async function assertCanvasFitsStagePreservingAspectRatio(page: import("@playwright/test").Page): Promise<void> {
    const canvas = page.locator("#canvas");
    const stage = page.locator("#stage");

    const attrs = await canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
    const canvasBox = await canvas.boundingBox();
    const stageBox = await stage.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(stageBox).not.toBeNull();

    const attrRatio = attrs.width / attrs.height;
    const boxRatio = canvasBox!.width / canvasBox!.height;
    expect(Math.abs(boxRatio - attrRatio) / attrRatio).toBeLessThanOrEqual(0.01);

    expect(canvasBox!.x).toBeGreaterThanOrEqual(stageBox!.x - 0.5);
    expect(canvasBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width + 0.5);
    expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
  }

  test("canvas aspect ratio survives stage resizes that happen without a window resize", async ({ page }) => {
    await page.goto("/");
    await loadTallTestImage(page);

    const badgeTool = page.locator('[data-tool="badge"]');
    const bar = page.locator("#badge-bar");

    // Order matters here, and it is deliberately NOT "resize the window,
    // then open the bar": a legacy main-web.ts fitCanvasToStage routine
    // (deleted; see TASK-38 follow-up) stamped a pixel max-height onto
    // #canvas from whatever #stage size was current at the time of the last
    // window resize. If that stamp happens while the bar is closed (stage
    // tall), the max is large and never actually clamps anything — the test
    // would pass whether or not the bug was reintroduced. To actually catch
    // a reintroduced max-writer, the max must be stamped while #stage is
    // SMALL, and then #stage must grow past it with NO window resize in
    // between (the only way a stale small max gets a chance to wrongly
    // clamp one axis).

    // 1. Open the badge bar first — shrinks #stage in-flow, no window
    //    resize fires. Stage is SHORT.
    await badgeTool.tap();
    await badgeTool.tap();
    await expect(bar).toBeVisible();
    await assertCanvasFitsStagePreservingAspectRatio(page);

    // 2. Now do the genuine window resize (as an iOS soft keyboard opening
    //    would fire) while the stage is still short from the open bar. This
    //    is the moment a legacy fitCanvasToStage would stamp a SMALL,
    //    bar-open pixel max-height onto #canvas.
    await page.setViewportSize({ width: 390, height: 600 });
    await assertCanvasFitsStagePreservingAspectRatio(page);

    // 3. Close the bar — #stage grows back, again with no window resize.
    //    A stale small max stamped in step 2 would clamp #canvas on one
    //    axis here even though #stage has room to grow.
    await page.locator("#badge-bar-close").tap();
    await expect(bar).toBeHidden();
    await assertCanvasFitsStagePreservingAspectRatio(page);
  });
});
