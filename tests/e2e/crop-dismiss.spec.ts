import { test, expect } from "@playwright/test";

/**
 * Real-iPhone-viewport regression suite for TASK-40: the crop tool's ✗/✓
 * controls must always exit crop mode to the select tool, whether or not the
 * region was edited (amends TASK-4 AC#5, which kept crop mode active on an
 * untouched/cancelled region — see backlog task-40 for the recorded
 * decision). Mirrors badge-bar.spec.ts's style/config.
 *
 * A minimal 120x90 RGB PNG, generated once and inlined as base64 (no test
 * fixture file, no new dependency), stands in for a captured screenshot.
 */
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAAAuUlEQVR4nO3QAQkAIADAMMOayUzGsoXCHTzA2Zhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINutUB4qMst6zJ6R4AAAAASUVORK5CYII=";

/**
 * Load the inline PNG through the welcome screen's "Choose Photo" button
 * (`#welcome-pick`, which lazily opens the web platform's hidden file
 * input — see src/platform/web.ts's pickImage). `page.waitForEvent`
 * arms the listener before the tap so the file-chooser dialog is never
 * missed to a timing race.
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
  // #stage carries the "empty" class while no image is loaded (see
  // src/app.ts's syncEmptyState); it is removed once the picked image lands.
  await expect(page.locator("#stage")).not.toHaveClass(/empty/);
}

test.describe("crop confirm/cancel exits crop mode", () => {
  test("cancel (✗) discards the crop and returns to the select tool", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page);

    await page.locator('[data-tool="crop"]').tap();
    const controls = page.locator(".crop-controls");
    await expect(controls).toBeVisible();

    await page.locator(".crop-cancel").tap();
    await expect(controls).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="crop"]')).not.toHaveClass(/active/);
  });

  test("apply (✓) with an untouched region exits crop mode without changing the image", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page);

    const canvas = page.locator("#canvas");
    const widthBefore = await canvas.getAttribute("width");
    const heightBefore = await canvas.getAttribute("height");

    await page.locator('[data-tool="crop"]').tap();
    const controls = page.locator(".crop-controls");
    await expect(controls).toBeVisible();

    await page.locator(".crop-apply").tap();
    await expect(controls).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="crop"]')).not.toHaveClass(/active/);

    // No crop was applied: canvas bitmap dimensions are unchanged.
    await expect(canvas).toHaveAttribute("width", widthBefore ?? "");
    await expect(canvas).toHaveAttribute("height", heightBefore ?? "");
  });
});
