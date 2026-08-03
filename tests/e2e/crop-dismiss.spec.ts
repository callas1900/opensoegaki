import { test, expect } from "@playwright/test";
import { SMALL_PNG_BASE64, loadTestImage } from "./fixtures";

/**
 * Real-iPhone-viewport regression suite for TASK-40: the crop tool's ✗/✓
 * controls must always exit crop mode to the select tool, whether or not the
 * region was edited (amends TASK-4 AC#5, which kept crop mode active on an
 * untouched/cancelled region — see backlog task-40 for the recorded
 * decision). Mirrors badge-bar.spec.ts's style/config. The fixture image and
 * its loader are shared — see ./fixtures.ts.
 */

test.describe("crop confirm/cancel exits crop mode", () => {
  test("cancel (✗) discards the crop and returns to the select tool", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

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
    await loadTestImage(page, SMALL_PNG_BASE64);

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
