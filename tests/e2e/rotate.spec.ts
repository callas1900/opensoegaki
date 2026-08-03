import { test, expect, type Page } from "@playwright/test";
import { SMALL_PNG_BASE64, loadTestImage } from "./fixtures";

/**
 * Real-iPhone-viewport regression suite for TASK-41 (rotate a selected
 * annotation with the select tool): draw a rect, select it, drag its rotate
 * knob roughly 45° clockwise, and assert both the floating delete button
 * (TASK-35.11) and the rasterized pixels moved with it. The fixture image and
 * its loader are shared — see ./fixtures.ts.
 */

interface CanvasGeometry {
  /** Canvas element's on-screen (viewport) box, in CSS px. */
  box: { x: number; y: number; width: number; height: number };
  /** CSS px per bitmap px (`canvasRect.width / canvas.width`) — matches Editor's own `cropScale()`⁻¹. */
  scale: number;
}

/** Read the canvas's current screen box + bitmap->CSS scale, the same mapping `canvas.ts`'s `positionSelectionControls`/`toCanvas` use. */
async function canvasGeometry(page: Page): Promise<CanvasGeometry> {
  const canvas = page.locator("#canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("#canvas has no box");
  const attrs = await canvas.evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
  return { box, scale: box.width / attrs.width };
}

/** Map a bitmap-px point to a page (viewport) point, for `page.mouse` calls. */
function toScreen(geo: CanvasGeometry, bx: number, by: number): { x: number; y: number } {
  return { x: geo.box.x + bx * geo.scale, y: geo.box.y + by * geo.scale };
}

/** RGBA of the single pixel at bitmap coordinates `(bx, by)`, read straight off the live canvas. */
async function pixelAt(page: Page, bx: number, by: number): Promise<[number, number, number, number]> {
  return page.locator("#canvas").evaluate((el: HTMLCanvasElement, [x, y]: [number, number]) => {
    const ctx = el.getContext("2d")!;
    const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
  }, [bx, by]);
}

function colorDelta(a: [number, number, number, number], b: [number, number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

test.describe("rotate a selected annotation", () => {
  test("dragging the rotate knob ~45° moves the delete button and the top-edge pixel", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    // 1. Draw a rect (bitmap px: 20,45 to 100,85 — 80x40, centered in the
    // 120x90 fixture with room above for the knob).
    await page.locator('[data-tool="rect"]').tap();
    let geo = await canvasGeometry(page);
    const a = toScreen(geo, 20, 45);
    const b = toScreen(geo, 100, 85);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.up();

    // Sample the top-edge midpoint right after drawing, before any rotation —
    // this is the rect's stroke color at that pixel.
    const strokeAtTopMid = await pixelAt(page, 60, 45);

    // 2. Switch to select and tap the rect's top edge (rects hit-test on
    // their outline band, not the filled interior — see hittest.ts).
    await page.locator('[data-tool="select"]').tap();
    geo = await canvasGeometry(page); // re-read: switching tools can re-layout the toolbar/stage
    const edgePoint = toScreen(geo, 60, 45);
    await page.mouse.move(edgePoint.x, edgePoint.y);
    await page.mouse.down();
    await page.mouse.up();

    const deleteBtn = page.locator(".selection-delete");
    await expect(deleteBtn).toBeVisible();
    const deleteBoxBefore = await deleteBtn.boundingBox();
    expect(deleteBoxBefore).not.toBeNull();

    // 3. Drag the rotate knob ~45° clockwise. At angle 0 the knob sits
    // ROTATE_HANDLE_OFFSET_PX (24 CSS px) above the padded (SELECTION_PAD_PX
    // = 6 bitmap px) marquee's north-edge midpoint — see canvas.ts's
    // drawSelectionOverlay/rotateHandleFor wiring. cropScale() cancels out
    // when expressed in CSS px (bitmap px * scale), so the offset is exactly
    // 24 CSS px regardless of the canvas's on-screen scale.
    geo = await canvasGeometry(page);
    const paddedTop = 45 - 6;
    const midX = (20 + 100) / 2;
    const knobStart = toScreen(geo, midX, paddedTop);
    knobStart.y -= 24;

    const pivot = toScreen(geo, midX, (45 + 85) / 2);
    const radius = Math.hypot(knobStart.x - pivot.x, knobStart.y - pivot.y);
    // Rotate the knob's angle (currently pointing straight up, -90°) by +45°
    // clockwise to -45°, tracing a short arc so the drag reads as a rotate
    // gesture rather than a single jump.
    const startAngle = Math.atan2(knobStart.y - pivot.y, knobStart.x - pivot.x);
    const endAngle = startAngle + Math.PI / 4;

    await page.mouse.move(knobStart.x, knobStart.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const angle = startAngle + (endAngle - startAngle) * t;
      await page.mouse.move(pivot.x + radius * Math.cos(angle), pivot.y + radius * Math.sin(angle));
    }
    await page.mouse.up();

    // 4. The delete button follows the rotated NE corner (positionSelectionControls).
    const deleteBoxAfter = await deleteBtn.boundingBox();
    expect(deleteBoxAfter).not.toBeNull();
    const moved =
      Math.abs(deleteBoxAfter!.x - deleteBoxBefore!.x) + Math.abs(deleteBoxAfter!.y - deleteBoxBefore!.y);
    expect(moved).toBeGreaterThan(3);

    // 5. The rasterized top-edge-midpoint pixel is no longer stroke color —
    // the rect's top edge rotated away from that world position.
    const afterRotate = await pixelAt(page, 60, 45);
    expect(colorDelta(strokeAtTopMid, afterRotate)).toBeGreaterThan(40);

    // 6. Undo (AC#4): the whole rotate gesture is one undo step. Note undo
    // also clears the selection (Editor.restore()), so the delete button is
    // torn down rather than "moving back" — the rasterized pixel is the
    // reliable signal that the angle itself reverted.
    await page.locator("#undo").tap();
    const afterUndo = await pixelAt(page, 60, 45);
    expect(colorDelta(strokeAtTopMid, afterUndo)).toBeLessThan(20);
  });
});
