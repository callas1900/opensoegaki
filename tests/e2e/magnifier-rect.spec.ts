import { test, expect, type Page } from "@playwright/test";
import { SMALL_PNG_BASE64, loadTestImage } from "./fixtures";

/**
 * Real-iPhone-viewport regression suite for the rect ("cube mode") magnifier
 * variant (design note "magnifier-cube-mode", 2026-08-08, D7's toolbar
 * toggle + D4's slide-to-aim creation + D5's resize semantics). Mirrors
 * magnifier.spec.ts's structure/idioms exactly: same `canvasGeometry`/
 * `toScreen`/`pixelAt` helpers, same shared `SMALL_PNG_BASE64` fixture (white
 * 120x90 field, 10x10 black square at (20,20)-(29,29), center (25,25)), same
 * one-continuous-`test()`-with-numbered-steps shape (each step depends on the
 * previous one's committed/moved state). `magnifier.spec.ts` itself is left
 * completely untouched and is run alongside this file as the circle-mode
 * regression gate (see plan task 9) — nothing here imports it or changes it.
 *
 * Scenario: second-tap the magnifier toolbar button to switch circle -> rect
 * mode (asserting the icon swap), slide-create a rect magnifier over the
 * fixture's black square, assert a magnified pixel at the lens center,
 * lens-body-drag the lens (source pixel unchanged), then undo twice — first
 * reverting the drag (one-gesture-one-undo-step, same contract
 * magnifier.spec.ts pins for the circle), then reverting the creation itself
 * so the magnifier is gone entirely ("undo removes it", per plan task 9).
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

const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const WHITE: [number, number, number, number] = [255, 255, 255, 255];

/**
 * Expected lens geometry, mirroring `magnifier.ts`'s creation-time math as
 * plain arithmetic — deliberately NOT importing `src/editor/magnifier.ts`
 * into the Playwright bundle (see magnifier.spec.ts:57-75 for the exact same
 * discipline and its rationale: keeps this spec's module graph identical to
 * the rest of `tests/e2e/`, uncoupled from the app's own TS build). MUST be
 * updated if magnifier.ts's presets/coefficients are ever retuned. This file
 * additionally mirrors the rect ("cube mode") twins the 2026-08-08 design
 * note added: `MAGNIFIER_RECT_ASPECT`, `deriveRectLensSize`, `placeRectLens`
 * (E-candidate only, this spec's down point never needs the fallback path,
 * same precedent as magnifier.spec.ts's `placeLensE`), `clampRectLensCenter`,
 * and (Addendum F, 2026-08-08) `magnifierMarkerStroke` plus the
 * `markerStroke/2`-inflated rect creation gap.
 *
 * `size` is the editor's default ("M"), never changed by this spec.
 *
 * Addendum G (2026-08-08, user requests from live iPhone testing): the rect
 * source's operability floor split in two — `minSource` (fingertip-sized,
 * 20 CSS px) stays circle-only; the rect switched to `minRectSource`
 * (legibility-only, `MIN_RECT_SOURCE_CSS_PX` = 4 CSS px) in `clampRectZoom`
 * and `deriveRectLensSize`'s step 2. The connector's shape (corner-to-corner
 * lines, no fill) is NOT mirrored here — this spec never inspects connector
 * pixels, only lens-center/source-pixel colors and lens geometry.
 */
const LENS_FRACTION_M = 0.3;
const MIN_ZOOM = 1.2;
const MAX_ZOOM = 16;
const GAP_PX = 12; // MAGNIFIER_GAP_PX
const SOURCE_RADIUS_FRACTION = 0.06; // MAGNIFIER_SOURCE_RADIUS_FRACTION
const RECT_ASPECT = 8 / 3; // MAGNIFIER_RECT_ASPECT
const MIN_RECT_SOURCE_CSS_PX = 4; // MIN_MAGNIFIER_RECT_SOURCE_CSS_PX (Addendum G §G1) — the rect's own legibility floor, NOT a fingertip floor; see that constant's own doc comment in magnifier.ts

// Addendum F (2026-08-08): the rect creation path's auto-placement gap is
// MAGNIFIER_GAP_PX + magnifierMarkerStroke(strokeWidth)/2, not the bare
// GAP_PX above (which stays the circle's own, unchanged, gap constant) —
// see canvas.ts's magnifierRectGeometry. Mirrored here as plain arithmetic;
// MUST be updated again if MAGNIFIER_MARKER_STROKE_RATIO or the rect gap
// formula is ever retuned.
const MARKER_STROKE_RATIO = 0.9; // MAGNIFIER_MARKER_STROKE_RATIO
const STROKE_PRESET_M = 6; // STROKE_PRESETS.M — the editor's default size, never changed by this spec
const ANNOTATION_SCALE_BASELINE = 900; // model.ts's ANNOTATION_SCALE_BASELINE (web-only adaptive stroke/font sizing)

/** `magnifierMarkerStroke`, mirrored (Addendum F, 2026-08-08). */
function markerStroke(strokeWidth: number): number {
  return Math.max(1, strokeWidth * MARKER_STROKE_RATIO);
}

// Operability size limits (Addendum B, 2026-08-02) — mirrors magnifierSizeLimits.
const MIN_SOURCE_RADIUS_PX = 2; // MIN_MAGNIFIER_SOURCE_RADIUS_PX (absolute backstop)
const MIN_SOURCE_RADIUS_CSS_PX = 20; // MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX
const MIN_LENS_RADIUS_CSS_PX = 28; // MIN_MAGNIFIER_LENS_RADIUS_CSS_PX
const SOURCE_SHORT_SIDE_CAP = 0.15; // MAGNIFIER_SOURCE_SHORT_SIDE_CAP
const MAX_LENS_FRACTION = 0.45; // MAGNIFIER_MAX_LENS_FRACTION

interface SizeLimits {
  minSource: number;
  minRectSource: number;
  minLens: number;
  maxLens: number;
}

/** `magnifierSizeLimits`, mirrored: `scale` is BITMAP px per CSS px (`canvas.ts`'s `cropScale()`) — the caller passes `1 / geo.scale`. */
function sizeLimits(canvasW: number, canvasH: number, scale: number): SizeLimits {
  const shortSide = Math.min(canvasW, canvasH);
  const maxLens = MAX_LENS_FRACTION * shortSide;
  const minSource = Math.max(MIN_SOURCE_RADIUS_PX, Math.min(MIN_SOURCE_RADIUS_CSS_PX * scale, SOURCE_SHORT_SIDE_CAP * shortSide));
  const minRectSource = Math.max(MIN_SOURCE_RADIUS_PX, Math.min(MIN_RECT_SOURCE_CSS_PX * scale, SOURCE_SHORT_SIDE_CAP * shortSide));
  const minLens = Math.min(MIN_LENS_RADIUS_CSS_PX * scale, maxLens);
  return { minSource, minRectSource, minLens, maxLens };
}

/** `defaultSourceRadius`, mirrored: also the rect path's `sourceHalfW` (D4 — the circle's "source radius" becomes the rect source's HALF WIDTH). */
function defaultSourceRadius(canvasW: number, canvasH: number, limits: SizeLimits): number {
  const longSide = Math.max(canvasW, canvasH);
  const shortSide = Math.min(canvasW, canvasH);
  return Math.max(Math.min(SOURCE_RADIUS_FRACTION * longSide, SOURCE_SHORT_SIDE_CAP * shortSide), limits.minSource);
}

/** `deriveLensSizeForSource`, mirrored (single axis: `{radius, zoom}`) — `deriveRectLensSize` below reuses this on the WIDTH axis, same as magnifier.ts's own composition. */
function deriveLensSizeForSource(sourceRadius: number, canvasW: number, canvasH: number, limits: SizeLimits): { radius: number; zoom: number } {
  const longSide = Math.max(canvasW, canvasH);
  const targetRadius = Math.min((LENS_FRACTION_M * longSide) / 2, limits.maxLens);
  let zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetRadius / sourceRadius));
  let radius = sourceRadius * zoom;
  const clampedRadius = Math.min(limits.maxLens, Math.max(limits.minLens, radius));
  if (clampedRadius !== radius) {
    radius = clampedRadius;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, radius / sourceRadius));
  }
  return { radius, zoom };
}

/** `clampRectZoom`, mirrored (Addendum G §G1: reads `limits.minRectSource`, not `limits.minSource`). */
function clampRectZoom(z: number, width: number, height: number, limits: SizeLimits): number {
  const hi = Math.min(MAX_ZOOM, Math.min(width, height) / (2 * limits.minRectSource));
  return Math.min(hi, Math.max(MIN_ZOOM, z));
}

interface RectLensSize {
  sourceHalfW: number;
  sourceHalfH: number;
  width: number;
  height: number;
  zoom: number;
}

/**
 * `deriveRectLensSize`, mirrored — UPDATED for Addendum D §D11 (2026-08-08,
 * reviewer nit N3): the original 5-step version squared the source/lens up
 * whenever the operability floor lifted the source's half-height; §D11
 * instead WIDENS the source's half-width to preserve `MAGNIFIER_RECT_ASPECT`,
 * capped by the same panorama guard `defaultSourceRadius` itself uses, and
 * takes the preset's ZOOM from the UNWIDENED source (so cube mode never
 * magnifies less than the circle path at the same S/M/L). Mirrors
 * magnifier.ts's own 9-step doc comment step for step — MUST be updated
 * again if that algorithm is ever retuned further.
 */
function deriveRectLensSize(canvasW: number, canvasH: number, limits: SizeLimits): RectLensSize {
  const shortSide = Math.min(canvasW, canvasH);

  // 1: unchanged — the circle's own default source radius as the rect's half
  // WIDTH before widening (still floored at limits.minSource — see
  // defaultSourceRadius above; that floor is circle-only in NAME but this
  // rect step 1 legitimately reuses it, unaffected by Addendum G).
  const baseHalfW = defaultSourceRadius(canvasW, canvasH, limits);

  // 2: the aspect-derived half HEIGHT, floored at the rect's own LEGIBILITY
  // minimum (Addendum G §G1: limits.minRectSource, not limits.minSource).
  const sourceHalfH = Math.max(baseHalfW / RECT_ASPECT, limits.minRectSource);

  // 3 (N3): when the floor lifted sourceHalfH, widen sourceHalfW back out to
  // restore the ASPECT ratio, capped by the panorama guard.
  const sourceHalfW = Math.max(baseHalfW, Math.min(RECT_ASPECT * sourceHalfH, SOURCE_SHORT_SIDE_CAP * shortSide));

  // 4: the preset's zoom comes from the UNWIDENED source.
  const { radius: baseLensHalfW, zoom: zoom0 } = deriveLensSizeForSource(baseHalfW, canvasW, canvasH, limits);

  // 5: lens half-extents at that zoom; width axis carries the widening factor.
  let lensHalfW = baseLensHalfW * (sourceHalfW / baseHalfW);
  let lensHalfH = sourceHalfH * zoom0;

  // 6: caps shrink BOTH axes by one shared factor, so a cap can't skew the aspect.
  const s = Math.min(1, limits.maxLens / lensHalfW, (MAX_LENS_FRACTION * canvasH) / lensHalfH);
  if (s < 1) {
    lensHalfW *= s;
    lensHalfH *= s;
  }

  // 7: floors last, per axis, never above that axis's own cap.
  lensHalfW = Math.max(lensHalfW, Math.min(limits.minLens, limits.maxLens));
  lensHalfH = Math.max(lensHalfH, Math.min(limits.minLens, MAX_LENS_FRACTION * canvasH));

  // 8: one re-clamp of zoom against the final width/height pair.
  const zoom = clampRectZoom(zoom0, 2 * lensHalfW, 2 * lensHalfH, limits);

  // 9: source half-extents the annotation will ACTUALLY have.
  return { sourceHalfW: lensHalfW / zoom, sourceHalfH: lensHalfH / zoom, width: 2 * lensHalfW, height: 2 * lensHalfH, zoom };
}

/**
 * `placeRectLens`'s FIRST candidate, direction E (dir = (1,0)): center +
 * (sourceHalfW + gap + lensHalfW, 0). For the down point this spec uses, E
 * always fits fully on-canvas and wins outright — same precedent as
 * magnifier.spec.ts's `placeLensE` (the 8-candidate fallback path is not
 * replicated here, since it never triggers for this fixture/down-point pair).
 * `gap` is the caller's (already `markerStroke/2`-inflated, Addendum F)
 * value, not the bare `GAP_PX` constant — see the `markerStroke` comment above.
 */
function placeRectLensE(from: { x: number; y: number }, sourceHalfW: number, lensHalfW: number, gap: number): { x: number; y: number } {
  const distX = sourceHalfW + gap + lensHalfW;
  return { x: from.x + distX, y: from.y };
}

/** `clampRectLensCenter`, mirrored: component-wise clamp of a candidate center into `[halfW, W-halfW] x [halfH, H-halfH]`, per-axis fallback to the canvas-center coordinate on an axis too narrow to hold the lens. */
function clampRectLensCenter(
  center: { x: number; y: number },
  halfW: number,
  halfH: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  const clampAxis = (v: number, half: number, size: number): number => {
    const hi = size - half;
    if (hi < half) return size / 2;
    return Math.min(hi, Math.max(half, v));
  };
  return { x: clampAxis(center.x, halfW, canvasW), y: clampAxis(center.y, halfH, canvasH) };
}

test.describe("magnifier rect ('cube mode'): second-tap toggle, slide-create, lens-body drag, undo", () => {
  test("second tap swaps the toolbar icon to rect; slide-to-aim creates a RECT magnifier over the black square; lens-body drag moves only the lens; undo first reverts the drag, then removes the magnifier entirely", async ({
    page,
  }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    // 1. Pick the magnifier tool — defaults to circle mode (same active-tool
    // UI every other tool button participates in, crop-dismiss.spec.ts's
    // precedent).
    const magnifierBtn = page.locator('[data-tool="magnifier"]');
    await magnifierBtn.tap();
    await expect(magnifierBtn).toHaveClass(/active/);
    await expect(page.locator('[data-tool="arrow"]')).not.toHaveClass(/active/); // arrow is the default-active tool
    await expect(magnifierBtn.locator('[data-magnifier-icon="circle"]')).toBeVisible();
    await expect(magnifierBtn.locator('[data-magnifier-icon="rect"]')).toBeHidden();

    // 2. A SECOND tap, while the magnifier tool is already active, toggles
    // circle -> rect (D7) and swaps the toolbar icon instead of re-selecting
    // the already-active tool — verbatim badge-tool second-tap precedent
    // (app.ts). The tool stays active/selected throughout.
    await magnifierBtn.tap();
    await expect(magnifierBtn).toHaveClass(/active/);
    await expect(magnifierBtn.locator('[data-magnifier-icon="circle"]')).toBeHidden();
    await expect(magnifierBtn.locator('[data-magnifier-icon="rect"]')).toBeVisible();

    // 3. Slide-to-aim creation (Addendum A, 2026-08-01a, reused verbatim for
    // rect per D4): press on plain white background, slide onto the black
    // square's center, release. Same gesture magnifier.spec.ts's circle
    // scenario uses — see that file's step 2 comment for the full geometry
    // derivation this mirrors.
    let geo = await canvasGeometry(page);
    const canvasAttrs = await page.locator("#canvas").evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
    const down = { x: 35, y: 45 }; // plain white background, far from the black square
    const release = { x: 25, y: 25 }; // the black square's center

    // Same native-scale precondition magnifier.spec.ts documents for this
    // fixture (small enough that the browser never upscales it to fill the
    // iPhone-14 viewport).
    expect(geo.scale).toBe(1);
    const limits = sizeLimits(canvasAttrs.width, canvasAttrs.height, 1 / geo.scale);
    const { sourceHalfW, sourceHalfH, width, height } = deriveRectLensSize(canvasAttrs.width, canvasAttrs.height, limits);
    const lensHalfW = width / 2;
    const lensHalfH = height / 2;

    // Addendum F (2026-08-08): the rect creation gap is inflated by
    // markerStroke/2 (canvas.ts's magnifierRectGeometry passes
    // base.strokeWidth = this.strokeWidth * this.docScale). docScale for
    // this fixture is always 1 — asserted, not assumed, since
    // computeAnnotationScale floors at 1 below ANNOTATION_SCALE_BASELINE and
    // this fixture's canvas is far smaller than that baseline.
    expect(canvasAttrs.width).toBeLessThan(ANNOTATION_SCALE_BASELINE);
    const strokeWidth = STROKE_PRESET_M * 1; // docScale=1
    const rectGap = GAP_PX + markerStroke(strokeWidth) / 2;

    // placeRectLens's E candidate (dir=(1,0), so only the x axis reaches
    // out): fits fully on-canvas iff BOTH axes stay in range — asserted, not
    // assumed, so a future retune of any of these constants fails loudly
    // here instead of silently producing a wrong expected geometry
    // downstream (same discipline magnifier.spec.ts's own precondition
    // comment documents).
    expect(down.x).toBeLessThanOrEqual(canvasAttrs.width - sourceHalfW - rectGap - 2 * lensHalfW);
    expect(down.y - lensHalfH).toBeGreaterThanOrEqual(0);
    expect(down.y + lensHalfH).toBeLessThanOrEqual(canvasAttrs.height);

    const atDown = placeRectLensE(down, sourceHalfW, lensHalfW, rectGap);
    const offset = { x: atDown.x - down.x, y: atDown.y - down.y };
    const atFinal = clampRectLensCenter(
      { x: release.x + offset.x, y: release.y + offset.y },
      lensHalfW,
      lensHalfH,
      canvasAttrs.width,
      canvasAttrs.height,
    );

    const downScreen = toScreen(geo, down.x, down.y);
    const releaseScreen = toScreen(geo, release.x, release.y);
    await page.mouse.move(downScreen.x, downScreen.y);
    await page.mouse.down();
    await page.mouse.move((downScreen.x + releaseScreen.x) / 2, (downScreen.y + releaseScreen.y) / 2, { steps: 4 });
    await page.mouse.move(releaseScreen.x, releaseScreen.y, { steps: 4 });
    await page.mouse.up();

    // 4. The lens center always maps exactly to `from` under the loupe's
    // uniform sampling (magnifier.ts's clampSampleRect doc comment) —
    // zoom/placement-independent, and unaffected by the lens being a rect
    // rather than a circle. `from` is the release point (25,25), inside the
    // black square, so the lens center reads black — proof the source
    // followed the slide instead of staying at the (white) down point, and
    // proof the rect creation path committed a usable magnifier at all.
    const lensCenterPixel = await pixelAt(page, atFinal.x, atFinal.y);
    expect(colorDelta(lensCenterPixel, BLACK)).toBeLessThan(20);

    // Release auto-selects the new loupe and switches to the select tool
    // (Addendum A) — unchanged by the rect variant.
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="magnifier"]')).not.toHaveClass(/active/);
    await expect(page.locator(".selection-delete")).toBeVisible();

    // 5. WITHOUT any tool tap (already selected, already on the select
    // tool), drag the lens BODY, PERPENDICULAR to the from->at line (i.e.
    // vertically, since `offset.y` is 0 here) — same rationale as
    // magnifier.spec.ts's circle scenario: dragging along the connector's
    // own line would put the old center back on top of the (moved)
    // connector, confusing a later "reverted to white" check. The drag
    // distance is derived from the lens's own half-height (+ a safety
    // margin) so the old and new lens rects are guaranteed disjoint.
    geo = await canvasGeometry(page); // re-read: the tool switch can re-layout the toolbar/stage
    const atOldScreen = toScreen(geo, atFinal.x, atFinal.y);
    const dragBitmap = lensHalfH + 8;
    const dragScreen = dragBitmap * geo.scale;
    const dragTarget = { x: atOldScreen.x, y: atOldScreen.y + dragScreen };
    await page.mouse.move(atOldScreen.x, atOldScreen.y);
    await page.mouse.down();
    await page.mouse.move(dragTarget.x, (atOldScreen.y + dragTarget.y) / 2, { steps: 3 });
    await page.mouse.move(dragTarget.x, dragTarget.y, { steps: 3 });
    await page.mouse.up();

    const atNew = { x: atFinal.x, y: atFinal.y + dragBitmap };

    // The NEW lens center still shows `from`'s pixel (the source didn't
    // move) — proof the source stayed put while only the lens moved.
    const newCenterPixel = await pixelAt(page, atNew.x, atNew.y);
    expect(colorDelta(newCenterPixel, BLACK)).toBeLessThan(20);

    // 6. First undo reverts the single most-recent history step — the
    // lens-body move (creation and move are two separate, independently
    // undoable steps, same one-gesture-one-undo-step contract every other
    // tool in this app follows, pinned for the circle by magnifier.spec.ts):
    // the lens returns to its pre-drag position, so the OLD center shows the
    // source pixel again and the NEW center goes back to plain background.
    await page.locator("#undo").tap();
    const oldCenterAfterUndo = await pixelAt(page, atFinal.x, atFinal.y);
    expect(colorDelta(oldCenterAfterUndo, BLACK)).toBeLessThan(20);
    const newCenterAfterUndo = await pixelAt(page, atNew.x, atNew.y);
    expect(colorDelta(newCenterAfterUndo, WHITE)).toBeLessThan(20);

    // 7. A second undo reverts the CREATION step itself: the rect magnifier
    // disappears entirely — selection chrome gone, and the bitmap-px lens
    // center now shows the plain background pixel that was always there
    // underneath (white, since `atFinal` — derived above, not hardcoded —
    // sits far from the fixture's black square), not any magnified content.
    await page.locator("#undo").tap();
    await expect(page.locator(".selection-delete")).not.toBeVisible();
    const afterFullUndo = await pixelAt(page, atFinal.x, atFinal.y);
    expect(colorDelta(afterFullUndo, WHITE)).toBeLessThan(20);
  });
});
