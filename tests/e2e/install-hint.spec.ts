import { test, expect } from "@playwright/test";

/**
 * Real-iPhone-viewport regression suite for the iOS "Add to Home Screen"
 * install hint (TASK-35.8, restyled per the accent-card redesign): the toast
 * must be readable (16px+ text), have a 44x44 dismiss target, sit clear of
 * #share-bar, and be dismissible either via its × button or by tapping
 * anywhere on the card — with the dismissal persisting across reloads via
 * the `soegaki-install-hint-dismissed` localStorage key. Mirrors
 * crop-dismiss.spec.ts's style/config.
 *
 * The show gate (main-web.ts's isIOSSafari) is a UA regex, so the iPhone
 * tests force an iPhone Safari UA via `test.use`. Each test gets a fresh
 * browser context (and therefore clean localStorage), and `page.reload()`
 * preserves that same context's localStorage for the persistence checks.
 */
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.describe("install hint on iOS Safari", () => {
  test.use({ userAgent: IPHONE_UA });

  test("appears, is readable, and clears the share bar", async ({ page }) => {
    await page.goto("/");

    const hint = page.locator("#install-hint");
    await expect(hint).toBeVisible();

    // Let the entrance animation finish before reading geometry, otherwise
    // the boundingBox/font-size reads could race the slide-up transform.
    await hint.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
    );

    const fontSize = await hint.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(17);

    const titleFontSize = await hint
      .locator(".install-hint-title")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(titleFontSize).toBeGreaterThanOrEqual(19);

    const dismissBox = await page.locator("#install-hint-dismiss").boundingBox();
    expect(dismissBox).not.toBeNull();
    expect(dismissBox!.width).toBeGreaterThanOrEqual(44);
    expect(dismissBox!.height).toBeGreaterThanOrEqual(44);

    const hintBox = await hint.boundingBox();
    const shareBarBox = await page.locator("#share-bar").boundingBox();
    expect(hintBox).not.toBeNull();
    expect(shareBarBox).not.toBeNull();
    // The hint floats above the share bar; its bottom edge must not overlap
    // the share bar's top edge.
    expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(shareBarBox!.y + 0.5);

    // The geometric no-overlap contract also applies to #welcome-pick, the
    // welcome screen's only CTA, where the hint actually renders (portrait).
    const pickBox = await page.locator("#welcome-pick").boundingBox();
    expect(pickBox).not.toBeNull();
    const noOverlapWithPick =
      hintBox!.y + hintBox!.height <= pickBox!.y ||
      pickBox!.y + pickBox!.height <= hintBox!.y ||
      hintBox!.x + hintBox!.width <= pickBox!.x ||
      pickBox!.x + pickBox!.width <= hintBox!.x;
    expect(noOverlapWithPick).toBe(true);
  });

  test("stays hidden in phone landscape and returns on rotation to portrait", async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");
    const hint = page.locator("#install-hint");
    await expect(hint).toHaveCount(1);
    await expect(hint).toBeHidden();
    await expect(page.locator("#welcome-pick")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(hint).toBeVisible();
  });

  test("the dismiss button hides the hint and the dismissal persists across reload", async ({ page }) => {
    await page.goto("/");

    const hint = page.locator("#install-hint");
    await expect(hint).toBeVisible();

    await page.locator("#install-hint-dismiss").tap();
    await expect(hint).toBeHidden();

    await page.reload();
    await expect(hint).toBeHidden();
  });

  test("tapping anywhere on the card dismisses it and the dismissal persists across reload", async ({ page }) => {
    await page.goto("/");

    const hint = page.locator("#install-hint");
    await expect(hint).toBeVisible();

    await hint.locator("span:not(#install-hint-icon)").tap();
    await expect(hint).toBeHidden();

    await page.reload();
    await expect(hint).toBeHidden();
  });
});

test.describe("install hint off iOS", () => {
  test("stays hidden on a non-iOS user agent", async ({ page }) => {
    await page.goto("/");
    // toBeHidden also passes for an element that isn't in the DOM at all;
    // assert presence first so this actually checks the [hidden] gate.
    await expect(page.locator("#install-hint")).toHaveCount(1);
    await expect(page.locator("#install-hint")).toBeHidden();
  });
});
