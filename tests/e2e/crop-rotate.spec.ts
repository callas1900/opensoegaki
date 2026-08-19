import { test, expect, type Page } from "@playwright/test";
import {
  SMALL_PNG_BASE64,
  WIDE_PNG_BASE64,
  TALL_PNG_BASE64,
  loadTestImage,
  canvasGeometry,
  toScreen,
  pixelAt,
  colorDelta,
} from "./fixtures";

/**
 * Real-iPhone-viewport regression suite for TASK-52 (canvas rotation in crop
 * mode): quarter turns and free rotation ("tilt"), landed as a single
 * undoable step with the result auto-cropped to a fully opaque rectangle.
 * Design note: docs/design/2026-08-19-crop-canvas-rotation.md.
 *
 * IMPORTANT coordinate note: while crop mode is active, `#canvas`'s
 * width/height ATTRIBUTES are "frame space" (D0) -- a temporarily enlarged
 * backing store that is base document dims (swapped on an odd quarter turn)
 * plus a rotate band grown outward on every side. Frame-space pixel
 * coordinates are therefore NOT document coordinates, and the frame's exact
 * size depends on the live on-screen scale (`band = ROTATE_BAND_CSS_PX *
 * cropScale()`, frozen per frame-size change). Every test below that needs a
 * frame-space point (only the tilt-drag test, #4) reads the frame's actual
 * `width`/`height` attributes AFTER entering/turning in crop mode rather than
 * assuming any fixed number -- see `canvasSize()` and its call sites.
 *
 * Fixture: SMALL_PNG_BASE64 (fixtures.ts) is a 120x90 white image with a
 * 10x10 black square at document px (20,20)-(29,29), center (25,25).
 */

/** `#canvas`'s current width/height ATTRIBUTES (the live backing-store size -- frame space while crop is active, document space otherwise). */
async function canvasSize(page: Page): Promise<{ w: number; h: number }> {
  const canvas = page.locator("#canvas");
  const attrs = await canvas.evaluate((el: HTMLCanvasElement) => ({ w: el.width, h: el.height }));
  return attrs;
}

test.describe("crop-mode canvas rotation", () => {
  test("clockwise quarter turn + apply swaps canvas dimensions and rotates content", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    const before = await canvasSize(page);
    expect(before).toEqual({ w: 120, h: 90 });

    await page.locator('[data-tool="crop"]').tap();
    const controls = page.locator(".crop-controls");
    await expect(controls).toBeVisible();

    await page.locator(".crop-rotate-cw").tap();
    await page.locator(".crop-apply").tap();

    // Crop mode exits to the select tool.
    await expect(controls).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="crop"]')).not.toHaveClass(/active/);

    // An untouched region still carries a nonzero total angle (quarter*90°),
    // so `applyCrop`'s rotated branch (D5) runs: canvas dims are the
    // ORIGINAL document dims with width/height swapped (90x120), not the
    // in-between band-grown frame size.
    const after = await canvasSize(page);
    expect(after).toEqual({ w: before.h, h: before.w });

    // The fixture's 10x10 black square (doc-space center (25,25)) rotated 90°
    // clockwise about the document center (60,45) into the new 90x120
    // document lands with its center near (65,25) -- per rotate.ts's
    // documentRotation.map: dx=25-60=-35, dy=25-45=-20,
    // x'=-dy+offsetX(45)=65, y'=dx+offsetY(60)=25. The square is 10px wide,
    // so sampling well inside that margin is robust to sub-pixel rounding.
    const squareCenter = await pixelAt(page, 65, 25);
    expect(squareCenter[0] + squareCenter[1] + squareCenter[2]).toBeLessThan(30);
    expect(squareCenter[3]).toBe(255);

    // A point far from the rotated square's new position stays background white.
    const farCorner = await pixelAt(page, 5, 5);
    expect(farCorner[0] + farCorner[1] + farCorner[2]).toBeGreaterThan(700);
  });

  test("quarter turn then cancel restores the original canvas dimensions (B1 regression guard)", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    const canvas = page.locator("#canvas");
    const widthBefore = await canvas.getAttribute("width");
    const heightBefore = await canvas.getAttribute("height");
    const squareBefore = await pixelAt(page, 25, 25);

    await page.locator('[data-tool="crop"]').tap();
    await page.locator(".crop-rotate-cw").tap();

    // Sanity: the canvas really is the swapped, band-grown FRAME right now
    // (not the document) -- otherwise the "restored" assertion below would
    // be trivially true rather than actually exercising B1.
    const framed = await canvasSize(page);
    expect(framed.w).not.toBe(Number(widthBefore));
    expect(framed.h).not.toBe(Number(heightBefore));

    await page.locator(".crop-cancel").tap();

    await expect(page.locator(".crop-controls")).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="crop"]')).not.toHaveClass(/active/);

    // B1: `teardownCrop` is the SOLE owner of restoring the canvas's
    // dimensions on the way out of crop mode -- cancel must land back on the
    // ORIGINAL document size, not the frame size the preview was just at.
    await expect(canvas).toHaveAttribute("width", widthBefore ?? "");
    await expect(canvas).toHaveAttribute("height", heightBefore ?? "");

    // The document itself was never touched by a cancelled rotation.
    const squareAfter = await pixelAt(page, 25, 25);
    expect(colorDelta(squareBefore, squareAfter)).toBeLessThan(10);
  });

  test("quarter turn + apply, then one undo fully restores dimensions and content", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    const canvas = page.locator("#canvas");
    const widthBefore = await canvas.getAttribute("width");
    const heightBefore = await canvas.getAttribute("height");
    const squareBefore = await pixelAt(page, 25, 25);
    const bgBefore = await pixelAt(page, 5, 5);

    await page.locator('[data-tool="crop"]').tap();
    await page.locator(".crop-rotate-cw").tap();
    await page.locator(".crop-apply").tap();

    // Confirm the apply actually rotated (dims swapped, one history entry
    // pushed) before undoing -- otherwise "restored" below would be a no-op check.
    const rotated = await canvasSize(page);
    expect(rotated).toEqual({ w: Number(heightBefore), h: Number(widthBefore) });

    await page.locator("#undo").tap();

    // ONE undo step must fully restore both the canvas dimensions...
    await expect(canvas).toHaveAttribute("width", widthBefore ?? "");
    await expect(canvas).toHaveAttribute("height", heightBefore ?? "");

    // ...and the content (rotation + crop landed as a single undoable step, D5).
    const squareAfter = await pixelAt(page, 25, 25);
    const bgAfter = await pixelAt(page, 5, 5);
    expect(colorDelta(squareBefore, squareAfter)).toBeLessThan(10);
    expect(colorDelta(bgBefore, bgAfter)).toBeLessThan(10);
  });

  test("a free-rotation (tilt) drag then apply leaves no transparent margin at the output corners", async ({
    page,
  }) => {
    await page.goto("/");
    // WIDE_PNG_BASE64 (800x200), not SMALL_PNG_BASE64: the controls group is
    // now an in-flow bottom bar (TASK-52 regression fix, superseding the
    // design note's UI-1 addendum) rather than an overlay on top of the
    // canvas, so it can no longer swallow a grab point on the band at all --
    // this fixture choice is kept anyway to give the test a real, generous
    // patch of live rotate band regardless of viewport, and to keep this
    // test's geometry directly comparable to the arming-slop test below it.
    await loadTestImage(page, WIDE_PNG_BASE64);

    const docSize = await canvasSize(page);

    // Confirm the fixture itself is fully opaque BEFORE trusting the
    // post-rotation alpha===255 assertion below -- otherwise that assertion
    // would not actually mean "no transparent margin was introduced".
    for (const [x, y] of [
      [0, 0],
      [docSize.w - 1, 0],
      [0, docSize.h - 1],
      [docSize.w - 1, docSize.h - 1],
    ]) {
      const p = await pixelAt(page, x, y);
      expect(p[3]).toBe(255);
    }

    await page.locator('[data-tool="crop"]').tap();

    // Entering crop mode resizes the live canvas into FRAME space (see the
    // file-level coordinate note) -- read the frame's actual size and
    // on-screen geometry rather than assuming any fixed numbers.
    const frame = await canvasSize(page);
    const geo = await canvasGeometry(page);

    // At quarter 0 / tilt 0 / untouched, the crop rect exactly equals the
    // inscribed bounds, which for an unrotated image is the image itself,
    // centered in the frame with exactly `band` margin on every side
    // (cropFrameSize grows the frame by 2*band over the base image dims).
    const bandFromW = (frame.w - docSize.w) / 2;
    const bandFromH = (frame.h - docSize.h) / 2;
    expect(Math.abs(bandFromW - bandFromH)).toBeLessThanOrEqual(1);
    const band = bandFromW;
    expect(band).toBeGreaterThan(4); // enough room to grab a point well inside the band strip

    const pivot = { x: frame.w / 2, y: frame.h / 2 };
    // A point in the TOP band strip, offset toward the LEFT (25% across the
    // frame width) -- well outside the crop rect, whose top edge sits at
    // frame-y = band. (The controls group is now an in-flow bottom bar
    // rather than an overlay on the canvas -- see the fixture-choice comment
    // above -- so no band point is ever at risk of landing on it.)
    const start = { x: frame.w * 0.25, y: band / 2 };
    const startAngle = Math.atan2(start.y - pivot.y, start.x - pivot.x); // ~-90°, roughly straight up from the pivot
    const radius = Math.hypot(start.x - pivot.x, start.y - pivot.y);
    const TILT_DEG = 20; // well under the +/-45° clamp, far above the 0.1° apply deadband
    const endAngle = startAngle + (TILT_DEG * Math.PI) / 180;

    const startScreen = toScreen(geo, start.x, start.y);
    await page.mouse.move(startScreen.x, startScreen.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const angle = startAngle + (endAngle - startAngle) * t;
      const p = toScreen(geo, pivot.x + radius * Math.cos(angle), pivot.y + radius * Math.sin(angle));
      await page.mouse.move(p.x, p.y);
    }
    await page.mouse.up();

    // Non-vacuity guard (reviewer, 2026-08-19 polish round): without this,
    // a tilt drag that failed to arm (D4's TILT_SLOP_PX, or any other
    // regression that silently drops the drag) would make `applyCrop` take
    // the no-op pure-crop path, and every corner of an untouched, already-
    // opaque fixture would trivially pass the alpha===255 check below --
    // the test would look green while testing nothing. Reading the live
    // readout BEFORE tapping apply confirms the drag actually produced a
    // real, non-deadbanded angle.
    const angleBeforeApply = await page.locator(".crop-angle").textContent();
    expect(angleBeforeApply).not.toBe("0°");

    await page.locator(".crop-apply").tap();

    // Confirm the apply actually completed (exited crop mode) before trusting
    // the corner-alpha check below -- otherwise a silently-failed apply would
    // leave the still-in-progress FRAME on screen, whose band is already an
    // opaque void fill (CROP_VOID_FILL) and would make the alpha assertion
    // pass vacuously without ever exercising the rotated output.
    await expect(page.locator(".crop-controls")).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);

    // Apply resamples the background into a fresh output document (D5); read
    // its actual size rather than assuming one, then sample all four corners.
    const out = await canvasSize(page);

    // Second non-vacuity guard: a real 20° tilt auto-crops to the inscribed
    // rectangle, which is strictly smaller than the original document on
    // both axes -- confirms the rotated branch actually ran (and actually
    // shrank the image) rather than just exiting crop mode some other way.
    expect(out.w).toBeLessThan(docSize.w);
    expect(out.h).toBeLessThan(docSize.h);

    const corners: [number, number][] = [
      [0, 0],
      [out.w - 1, 0],
      [0, out.h - 1],
      [out.w - 1, out.h - 1],
    ];
    for (const [x, y] of corners) {
      const p = await pixelAt(page, x, y);
      expect(p[3]).toBe(255);
    }
  });

  test("a tap-scale drag on the band (2 CSS px) never arms the tilt gesture (arming-slop regression guard)", async ({
    page,
  }) => {
    // Reviewer, 2026-08-19 polish round: D4/B2.2's arming-slop fix
    // (TILT_SLOP_PX = 4 CSS px) is what stops a bare tap/jiggle on the
    // rotate band from writing `crop.tilt` at all -- this has regressed
    // twice already (see the design note's addendum) and had no direct e2e
    // guard. WIDE_PNG_BASE64, not SMALL_PNG_BASE64: same reasoning as the
    // tilt test above -- kept for this test's geometry to stay directly
    // comparable to the tilt test it guards against regressing (the
    // controls group is now an in-flow bottom bar, not an overlay, so every
    // band point is reachable on any fixture -- see the tilt test's own
    // fixture-choice comment).
    await page.goto("/");
    await loadTestImage(page, WIDE_PNG_BASE64);

    // N6 (reviewer, non-blocking round): TASK-52 AC#8 ("confirming with zero
    // rotation and an untouched region pushes no history step") was not
    // actually asserted anywhere -- this test's own dims-only check below
    // cannot prove it, because an untouched, unrotated crop is a geometric
    // no-op even if `applyCrop`'s guard regressed and pushed a spurious
    // history entry anyway: the "crop" would still resample the FULL image
    // at the SAME size, so both the canvas dimensions AND every pixel would
    // look byte-identical whether or not a step was actually pushed -- a
    // pure dims/pixel comparison would pass this AC vacuously. Seeding one
    // real, prior, undoable action (placing a badge) before entering crop
    // mode turns LIFO undo semantics into a real discriminator: if
    // `applyCrop` pushed a spurious entry, it sits ON TOP of the badge-add
    // entry in `history.past`, so a SINGLE `#undo` click pops that spurious
    // entry first and leaves the badge fully intact -- this test would then
    // (correctly) fail the "badge is gone" assertion below. Only the correct
    // "no crop step recorded" behavior makes that one undo click pop the
    // badge-add step itself.
    const badgePoint = { x: 400, y: 100 }; // clear of both fixture edges and the band geometry below
    const preBadgeGeo = await canvasGeometry(page);
    const bgBefore = await pixelAt(page, badgePoint.x, badgePoint.y);
    await page.locator('[data-tool="badge"]').tap();
    const badgeScreen = toScreen(preBadgeGeo, badgePoint.x, badgePoint.y);
    await page.mouse.click(badgeScreen.x, badgeScreen.y);
    const badgeDrawn = await pixelAt(page, badgePoint.x, badgePoint.y);
    // Sanity: the badge really was placed (a filled disc, never the same
    // color as this fixture's background band) -- otherwise the "badge is
    // gone" assertion below could pass vacuously because there was never a
    // badge to remove in the first place.
    expect(colorDelta(badgeDrawn, bgBefore)).toBeGreaterThan(30);

    const docSize = await canvasSize(page);

    await page.locator('[data-tool="crop"]').tap();

    const frame = await canvasSize(page);
    const geo = await canvasGeometry(page);
    const band = Math.min((frame.w - docSize.w) / 2, (frame.h - docSize.h) / 2);
    expect(band).toBeGreaterThan(4); // enough room for a point well inside the band strip

    // A point in the TOP band strip, clear of the image -- see the tilt
    // test above for why this fixture's frame geometry guarantees that.
    const point = { x: frame.w * 0.25, y: band / 2 };
    const screen = toScreen(geo, point.x, point.y);

    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    // Strictly under TILT_SLOP_PX (4 CSS px): onMove's tilt branch must
    // return WITHOUT ever writing `crop.tilt` or rendering.
    await page.mouse.move(screen.x + 2, screen.y);
    await page.mouse.up();

    // The readout was never touched by the (unarmed) drag -- still the
    // idle "0°" from initCrop's initial render.
    await expect(page.locator(".crop-angle")).toHaveText("0°");

    await page.locator(".crop-apply").tap();
    await expect(page.locator(".crop-controls")).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);

    // No rotation, no crop: canvas returns to the ORIGINAL document
    // dimensions (not the band-grown frame) -- applyCrop took the no-op
    // path (angle === 0, computeCrop returned null) with no history push.
    const after = await canvasSize(page);
    expect(after).toEqual(docSize);

    // The actual N6 assertion: one undo must remove the badge (proving it,
    // not a phantom crop step, was the top of `history.past`) -- see the
    // long comment above for why dims/pixel checks alone cannot prove this.
    await page.locator("#undo").tap();
    const afterUndo = await pixelAt(page, badgePoint.x, badgePoint.y);
    expect(colorDelta(afterUndo, bgBefore)).toBeLessThan(10);
  });

  test("a drag past the arming slop (8 CSS px) DOES arm the tilt gesture (positive control for the guard above)", async ({
    page,
  }) => {
    // Positive control for the arming-slop guard above: "the readout stays
    // 0° and dims are unchanged" is ALSO exactly what a pointerdown that
    // never reached the canvas would produce -- the same bug class as
    // TASK-52's handle-occlusion regression (see the design note's addendum
    // superseding UI-1). Repeating the identical gesture with a move
    // comfortably past `TILT_SLOP_PX` (4 CSS px) and asserting the readout
    // actually leaves "0°" proves the negative test above isn't passing
    // vacuously.
    await page.goto("/");
    await loadTestImage(page, WIDE_PNG_BASE64);

    const docSize = await canvasSize(page);
    await page.locator('[data-tool="crop"]').tap();

    const frame = await canvasSize(page);
    const geo = await canvasGeometry(page);
    const band = Math.min((frame.w - docSize.w) / 2, (frame.h - docSize.h) / 2);
    expect(band).toBeGreaterThan(4); // enough room for a point well inside the band strip

    // Same band point as the negative test above.
    const point = { x: frame.w * 0.25, y: band / 2 };
    const screen = toScreen(geo, point.x, point.y);

    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    // Well past TILT_SLOP_PX (4 CSS px): onMove's tilt branch must arm and
    // write a nonzero `crop.tilt`.
    await page.mouse.move(screen.x + 8, screen.y);
    await page.mouse.up();

    await expect(page.locator(".crop-angle")).not.toHaveText("0°");

    await page.locator(".crop-cancel").tap();
    await expect(page.locator(".crop-controls")).toBeHidden();
  });

  test("dragging a BOTTOM corner handle on a portrait image shrinks the region from the bottom (TASK-4 AC#2 regression guard)", async ({
    page,
  }) => {
    // TASK-52 regression (reviewer, browser-verified): the crop controls bar
    // used to be an overlay parked at #stage's bottom-centre and covered the
    // two BOTTOM crop corner handles on a portrait fixture across several
    // real viewport/browser combinations -- a press meant for the
    // bottom-left handle never reached the canvas at all, so the region
    // could never be shrunk from the bottom, directly failing TASK-4's own
    // AC#2 ("dragging a corner shrinks/expands it"). No prior spec in this
    // file ever dragged a corner handle at all -- every existing crop-drag
    // test here exercises rotation only -- which is how the regression
    // shipped past two review rounds undetected. See the design note's
    // addendum superseding UI-1 for the full writeup and the fix (an in-flow
    // bottom bar instead of an overlay).
    await page.goto("/");
    await loadTestImage(page, TALL_PNG_BASE64);

    const docSize = await canvasSize(page);
    expect(docSize).toEqual({ w: 120, h: 900 });

    await page.locator('[data-tool="crop"]').tap();
    const frame = await canvasSize(page);
    const geo = await canvasGeometry(page);

    // At quarter 0 / tilt 0 / untouched, the crop rect exactly equals the
    // inscribed bounds -- for an unrotated image that is the image itself,
    // centered in the frame with exactly `band` margin on every side (same
    // derivation the tilt test above uses; computed per-axis here rather
    // than assuming the two agree, though they should be within 1px).
    const bandX = (frame.w - docSize.w) / 2;
    const bandY = (frame.h - docSize.h) / 2;
    expect(bandX).toBeGreaterThan(0);
    expect(bandY).toBeGreaterThan(0);

    // A point well inside the image and close to its bottom edge
    // (frame-space) -- still INSIDE the untouched (full-image) region right
    // now, so undimmed.
    const probe = { x: Math.round(bandX + docSize.w / 2), y: Math.round(bandY + 800) };
    const before = await pixelAt(page, probe.x, probe.y);

    // The sw handle sits at the bottom-left corner of the (untouched) crop
    // rect: frame-space (bandX, bandY + docSize.h) -- see crop.ts's corners().
    const sw = { x: bandX, y: bandY + docSize.h };
    const swScreen = toScreen(geo, sw.x, sw.y);

    // Drag it upward -- shrinking the region's bottom edge -- by a
    // comfortable 200 frame px: well past MIN_CROP_PX and any hit-test
    // tolerance, and past `probe`'s y so `probe` ends up excluded from the
    // shrunk region.
    const target = { x: sw.x, y: sw.y - 200 };
    const targetScreen = toScreen(geo, target.x, target.y);

    await page.mouse.move(swScreen.x, swScreen.y);
    await page.mouse.down();
    await page.mouse.move(targetScreen.x, targetScreen.y);
    await page.mouse.up();

    // Non-vacuity guard (same discipline as the tilt test's readout check
    // above): confirm the drag actually reached the canvas and moved the
    // region's bottom edge BEFORE trusting the post-apply size check below
    // -- a drag swallowed by an occluding control group would leave `probe`
    // exactly as bright as `before`, which is precisely this bug class.
    // `drawCropOverlay` dims everything outside the region by 45% black
    // (`rgba(0,0,0,0.45)`, source-over compositing halves brightness, give
    // or take) -- `probe` was inside the untouched region and must now be
    // outside the shrunk one.
    const after = await pixelAt(page, probe.x, probe.y);
    expect(after[0]).toBeLessThan(before[0] * 0.8);
    expect(after[1]).toBeLessThan(before[1] * 0.8);
    expect(after[2]).toBeLessThan(before[2] * 0.8);

    await page.locator(".crop-apply").tap();
    await expect(page.locator(".crop-controls")).toBeHidden();
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);

    // The applied output is strictly shorter than the source (the region
    // shrank from the bottom); width is unaffected since only the sw
    // handle's y moved, not its x.
    const out = await canvasSize(page);
    expect(out.h).toBeLessThan(docSize.h);
    expect(out.w).toBeLessThanOrEqual(docSize.w);
  });
});
