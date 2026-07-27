import { test, expect } from "@playwright/test";

/**
 * Real-iPhone-viewport regression suite for TASK-43: the floating one-time
 * iOS "Add to Home Screen" popup was replaced by a static install
 * invitation baked into the welcome screen (`#welcome-install`), gated only
 * on whether the app is already running standalone — no user-agent sniffing,
 * no dismiss state, nothing persisted. Mirrors badge-bar.spec.ts and
 * crop-dismiss.spec.ts's style/config.
 */

/**
 * A minimal 120x90 RGB PNG, generated once and inlined as base64 — the same
 * fixture crop-dismiss.spec.ts uses.
 */
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAAAuUlEQVR4nO3QAQkAIADAMMOayUzGsoXCHTzA2Zhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINutUB4qMst6zJ6R4AAAAASUVORK5CYII=";

/**
 * Load the inline PNG through the welcome screen's "Choose Photo" button —
 * same helper pattern as crop-dismiss.spec.ts's `loadTestImage`.
 */
async function loadTestImage(page: import("@playwright/test").Page): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#welcome-pick").tap();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "img.png",
    mimeType: "image/png",
    buffer: Buffer.from(TEST_PNG_BASE64, "base64"),
  });
  await expect(page.locator("#stage")).not.toHaveClass(/empty/);
}

test.describe("welcome-screen install invitation", () => {
  test("shows on the welcome screen and the old floating popup is gone", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#welcome-install")).toBeVisible();
    // The floating popup this replaces must not exist in the DOM at all.
    await expect(page.locator("#install-hint")).toHaveCount(0);
  });

  test("portrait geometry: clears the share bar, and the pick button and version line stay fully on-screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const tip = page.locator("#welcome-install");
    await expect(tip).toBeVisible();

    const tipBox = await tip.boundingBox();
    const shareBarBox = await page.locator("#share-bar").boundingBox();
    expect(tipBox).not.toBeNull();
    expect(shareBarBox).not.toBeNull();
    expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(shareBarBox!.y + 0.5);

    // toBeVisible() alone is not enough here — it also passes for an element
    // that is pushed outside its clipping ancestor's box. The element that
    // actually clips is #stage (`place-items: center` + `touch-action: none`
    // clips overflow rather than scrolling it), NOT the viewport: #stage's
    // own box ends above #share-bar, which then opaquely covers the strip
    // between #stage's bottom and the viewport's bottom. Bounding a check
    // against the viewport instead of #stage would let an element sitting
    // fully behind #share-bar pass every assertion, so every box here is
    // compared against #stage's box, not against the raw viewport size.
    const stageBox = await page.locator("#stage").boundingBox();
    expect(stageBox).not.toBeNull();
    const pickBox = await page.locator("#welcome-pick").boundingBox();
    const versionBox = await page.locator(".welcome-version").boundingBox();
    expect(pickBox).not.toBeNull();
    expect(versionBox).not.toBeNull();
    expect(pickBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(pickBox!.y + pickBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
    expect(versionBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(versionBox!.y + versionBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);

    // Visual-hierarchy guard for TASK-17 AC#4: the install invitation must
    // read as quieter/secondary than the welcome hint, not compete with it.
    const tipFontSize = parseFloat(await tip.evaluate((el) => getComputedStyle(el).fontSize));
    const hintFontSize = parseFloat(
      await page.locator(".welcome-hint").evaluate((el) => getComputedStyle(el).fontSize),
    );
    expect(tipFontSize).toBeLessThan(hintFontSize);
  });

  test("landscape: the invitation is suppressed and the pick button and version line stay fully on-screen", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/");

    const tip = page.locator("#welcome-install");
    await expect(tip).toBeHidden();

    // Same #stage-bounded geometry guard as the portrait test above — see
    // that test's comment for why bounding against the raw viewport would
    // not actually guard against a clipped/covered element.
    const stageBox = await page.locator("#stage").boundingBox();
    expect(stageBox).not.toBeNull();
    const pickBox = await page.locator("#welcome-pick").boundingBox();
    const versionBox = await page.locator(".welcome-version").boundingBox();
    expect(pickBox).not.toBeNull();
    expect(versionBox).not.toBeNull();
    expect(pickBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(pickBox!.y + pickBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
    expect(versionBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(versionBox!.y + versionBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
  });

  test("tightest supported portrait geometry (iPhone SE with Display Zoom): invitation stays two lines, version line clears #stage", async ({
    page,
  }) => {
    // 320x568 is the tightest supported portrait viewport (iPhone SE with
    // Display Zoom's "Larger Text" accessibility setting engaged, a
    // supported configuration) — this is the real budget guard for the
    // invitation copy's length: a round-3 review found a 7-character copy
    // change was enough to wrap the invitation to a third line here, which
    // pushed .welcome-version behind #share-bar with every other geometry
    // check still green. See styles.css's #welcome-install comment for the
    // measured slack this test pins.
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");

    const tip = page.locator("#welcome-install");
    // 320x568 is portrait (unlike the 844x390 landscape case above), so the
    // invitation must still show here.
    await expect(tip).toBeVisible();

    const stageBox = await page.locator("#stage").boundingBox();
    expect(stageBox).not.toBeNull();
    const pickBox = await page.locator("#welcome-pick").boundingBox();
    const versionBox = await page.locator(".welcome-version").boundingBox();
    expect(pickBox).not.toBeNull();
    expect(versionBox).not.toBeNull();
    expect(pickBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(pickBox!.y + pickBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
    expect(versionBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(versionBox!.y + versionBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
  });

  test("badge bar open at 375x667: still the tightest portrait configuration overall, version line clears #stage", async ({
    page,
  }) => {
    // Opening the badge fixed-number bar shrinks #stage's height (see
    // badge-bar.spec.ts) without touching the welcome screen's own layout,
    // so this combination is a tighter squeeze than either 320x568 alone or
    // 375x667 alone.
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");

    const badgeTool = page.locator('[data-tool="badge"]');
    await badgeTool.tap();
    await badgeTool.tap();
    await expect(page.locator("#badge-bar")).toBeVisible();

    const stageBox = await page.locator("#stage").boundingBox();
    expect(stageBox).not.toBeNull();
    const versionBox = await page.locator(".welcome-version").boundingBox();
    expect(versionBox).not.toBeNull();
    expect(versionBox!.y).toBeGreaterThanOrEqual(stageBox!.y - 0.5);
    expect(versionBox!.y + versionBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 0.5);
  });

  test("hidden once an image is loaded", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#welcome-install")).toBeVisible();

    await loadTestImage(page);

    // #welcome (and everything inside it, including the invitation) is
    // hidden entirely once #stage loses .empty — see styles.css's
    // `#stage:not(.empty) #welcome`.
    await expect(page.locator("#welcome-install")).toBeHidden();
  });

  test("hidden when already running standalone", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
    });
    await page.goto("/");

    const tip = page.locator("#welcome-install");
    // Assert presence first so this actually checks the standalone gate,
    // not just "the element doesn't exist".
    await expect(tip).toHaveCount(1);
    await expect(tip).toBeHidden();
  });
});
