import { test, expect, type Page } from "@playwright/test";
import { SMALL_PNG_BASE64, loadTestImage } from "./fixtures";

/**
 * Real-iPhone-viewport regression suite for TASK-46 (magnifier/loupe
 * annotation), covering the slide-to-aim creation gesture (Addendum A,
 * 2026-08-01a, revised after real-iPhone feedback): press on a white area,
 * slide onto the detail, release to commit — the loupe is auto-selected on
 * the select tool. Then a body-drag moves only the lens, and undo reverts
 * it. Mirrors rotate.spec.ts's `canvasGeometry`/`pixelAt` idiom — one
 * continuous scenario as a single `test()` with numbered steps, not separate
 * `test()` blocks, since each step depends on the previous one's
 * committed/moved state.
 *
 * The steps below sample MAGNIFIED pixels, so they depend on the shared
 * SMALL_PNG_BASE64 fixture's content — a white 120x90 field with a 10x10
 * black square at (20,20)-(29,29), center (25,25). See ./fixtures.ts.
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
 * Expected lens geometry, mirroring `magnifier.ts`'s `deriveLensSizeForSource`
 * (S/M/L target sizing, two-pass clamp), `placeLens` (auto-placement),
 * `clampLensCenter` (on-canvas clamp, Addendum A 2026-08-01a) and
 * `magnifierSizeLimits`/`defaultSourceRadius` (operability size limits,
 * Addendum B 2026-08-02) as plain arithmetic — deliberately NOT importing
 * `src/editor/magnifier.ts` into the Playwright bundle, so this spec's module
 * graph stays identical to the rest of `tests/e2e/` (no source imports
 * anywhere else in the suite) and isn't coupled to the app's own TS build. If
 * magnifier.ts's presets/coefficients are ever retuned, these mirrored
 * constants must be updated to match.
 *
 * `size` is the editor's default ("M"), never changed by this spec.
 */
const LENS_FRACTION_M = 0.3;
const MIN_ZOOM = 1.2;
const MAX_ZOOM = 16;
const GAP_PX = 12;
const SOURCE_RADIUS_FRACTION = 0.06; // MAGNIFIER_SOURCE_RADIUS_FRACTION

// Operability size limits (Addendum B, 2026-08-02) — mirrors magnifierSizeLimits.
const MIN_SOURCE_RADIUS_PX = 2; // MIN_MAGNIFIER_SOURCE_RADIUS_PX (absolute backstop)
const MIN_SOURCE_RADIUS_CSS_PX = 20; // MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX (16 -> 20, magnifier UX brush-up)
const MIN_LENS_RADIUS_CSS_PX = 28; // MIN_MAGNIFIER_LENS_RADIUS_CSS_PX
const SOURCE_SHORT_SIDE_CAP = 0.15; // MAGNIFIER_SOURCE_SHORT_SIDE_CAP
const MAX_LENS_FRACTION = 0.45; // MAGNIFIER_MAX_LENS_FRACTION

interface SizeLimits {
  minSource: number;
  minLens: number;
  maxLens: number;
}

/**
 * `magnifierSizeLimits`, mirrored: `scale` here is BITMAP px per CSS px
 * (`bitmapPerCss`, i.e. `canvas.ts`'s `cropScale()`) — the caller passes
 * `1 / geo.scale`, since this spec's `geo.scale` (see `canvasGeometry`) is
 * the inverse, CSS px per bitmap px.
 */
function sizeLimits(canvasW: number, canvasH: number, scale: number): SizeLimits {
  const shortSide = Math.min(canvasW, canvasH);
  const maxLens = MAX_LENS_FRACTION * shortSide;
  const minSource = Math.max(MIN_SOURCE_RADIUS_PX, Math.min(MIN_SOURCE_RADIUS_CSS_PX * scale, SOURCE_SHORT_SIDE_CAP * shortSide));
  const minLens = Math.min(MIN_LENS_RADIUS_CSS_PX * scale, maxLens);
  return { minSource, minLens, maxLens };
}

function deriveLensRadius(sourceRadius: number, canvasW: number, canvasH: number, limits: SizeLimits): number {
  const longSide = Math.max(canvasW, canvasH);
  const targetRadius = Math.min((LENS_FRACTION_M * longSide) / 2, limits.maxLens);
  let zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, targetRadius / sourceRadius));
  let radius = sourceRadius * zoom;
  const clampedRadius = Math.min(limits.maxLens, Math.max(limits.minLens, radius));
  if (clampedRadius !== radius) {
    radius = clampedRadius;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, radius / sourceRadius));
  }
  return radius;
}

/** `defaultSourceRadius` (Addendum A, floored by Addendum B's `limits.minSource`): max(min(FRACTION * longSide, SOURCE_SHORT_SIDE_CAP * shortSide), limits.minSource) — the sole creation-time source radius now that the drag no longer sets it. */
function defaultSourceRadius(canvasW: number, canvasH: number, limits: SizeLimits): number {
  const longSide = Math.max(canvasW, canvasH);
  const shortSide = Math.min(canvasW, canvasH);
  return Math.max(Math.min(SOURCE_RADIUS_FRACTION * longSide, SOURCE_SHORT_SIDE_CAP * shortSide), limits.minSource);
}

/** `clampLensCenter` (Addendum A), mirrored: component-wise clamp of a candidate lens center into `[R, W-R] x [R, H-R]`, falling back to the canvas-center coordinate on an axis too narrow to hold the lens. */
function clampLensCenter(center: { x: number; y: number }, radius: number, canvasW: number, canvasH: number): { x: number; y: number } {
  const clampAxis = (v: number, size: number): number => {
    const hi = size - radius;
    if (hi < radius) return size / 2;
    return Math.min(hi, Math.max(radius, v));
  };
  return { x: clampAxis(center.x, canvasW), y: clampAxis(center.y, canvasH) };
}

/**
 * `placeLens`'s FIRST candidate, direction E (dir = (1,0)): center + (sourceRadius
 * + gap + lensRadius, 0). For the down point this spec uses, E always fits
 * fully on-canvas and wins outright — the 7-candidate fallback path (see
 * `placeLens`'s doc comment) never triggers here, so it isn't replicated.
 */
function placeLensE(from: { x: number; y: number }, sourceRadius: number, lensRadius: number): { x: number; y: number } {
  const dist = sourceRadius + GAP_PX + lensRadius;
  return { x: from.x + dist, y: from.y };
}

test.describe("magnifier: slide-to-aim creation, auto-select, body-drag, undo", () => {
  test("press-and-slide creates a loupe whose source follows the release point; the loupe auto-selects on the select tool; body-drag moves only the lens; undo reverts the move", async ({ page }) => {
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    // 1. Pick the magnifier tool — participates in the same tool-active UI
    // as every other tool button (crop-dismiss.spec.ts's precedent).
    await page.locator('[data-tool="magnifier"]').tap();
    await expect(page.locator('[data-tool="magnifier"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="arrow"]')).not.toHaveClass(/active/); // arrow is the default-active tool

    // 2. Slide-to-aim creation (Addendum A, 2026-08-01a): press on a WHITE
    // area away from the black square, then slide onto the square's center
    // (25,25) and release. This discriminates the new gesture from the OLD
    // radial-drag one: the old gesture kept `from` fixed at the down point
    // (so the source would stay put on the white down-point, growing only
    // in radius); the new gesture has `from` track the pointer every frame,
    // so it ends up at the RELEASE point instead. Placement (`at`) is frozen
    // at pointerdown as a constant offset from `from`, then carried forward
    // and clamped back on-canvas as `from` moves — mirrored below via
    // `placeLensE` (once, at the down point) + `clampLensCenter` (applied to
    // the offset carried to the release point).
    let geo = await canvasGeometry(page);
    const canvasAttrs = await page.locator("#canvas").evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
    const down = { x: 35, y: 45 }; // plain white background, far from the black square
    const release = { x: 25, y: 25 }; // the black square's center

    // Addendum B (2026-08-02): bitmapPerCss = 1/geo.scale (geo.scale is CSS
    // px per bitmap px; canvas.ts's cropScale() — what magnifierSizeLimits
    // actually takes — is the inverse). This 120x90 fixture is small enough
    // that the browser lays the canvas out at its NATIVE size (geo.scale ===
    // 1, confirmed at the console — the CSS never upscales a tiny image to
    // fill the iPhone-14 viewport), so bitmapPerCss === 1 too. At that scale
    // the operability floor DOES bite here (unlike the magnifier UX brush-up
    // design note's ">= 333 CSS px long side" threshold — was ">= 267" before
    // MIN_MAGNIFIER_SOURCE_RADIUS_CSS_PX 16 -> 20 — which assumes a canvas
    // actually filling the viewport): shortSide=90, so minSource = max(2,
    // min(20*1=20, 0.15*90=13.5)) = 13.5 (the short-side cap wins over the
    // CSS term, same result as before the floor was raised — 20 > 16 doesn't
    // change anything once the short-side cap is already the binding term),
    // which EXCEEDS the nominal source radius (min(0.06*120,0.15*90)=7.2,
    // see defaultSourceRadius's own comment) — so defaultSourceRadius
    // returns 13.5, not 7.2. minLens = min(28,maxLens=0.45*90=40.5) = 28,
    // which also exceeds the nominal M-preset radius the OLD (pre-Addendum-B)
    // geometry would have produced (18), so the lens ends up floor-bound too.
    // Both numbers below are therefore derived generically via `sizeLimits`/
    // `defaultSourceRadius`/`deriveLensRadius`, not hardcoded, and `down` is
    // chosen (x <= ~38.5) so the larger auto-placed lens still fits E fully
    // on-canvas from this down point (`placeLensE`'s documented precondition).
    // Load-bearing assumptions behind the comment above, asserted so a future
    // retune (of this fixture, the M preset, or any Addendum B constant)
    // fails loudly here instead of silently producing a wrong expected
    // geometry downstream (review nit): this fixture's arithmetic only holds
    // because the canvas renders at native (1:1) scale, and `down.x` (35) was
    // chosen so `placeLensE`'s undocumented "E always fits fully on-canvas"
    // precondition still holds against the operability-floor-enlarged
    // sourceRadius/lensRadius.
    expect(geo.scale).toBe(1);
    const limits = sizeLimits(canvasAttrs.width, canvasAttrs.height, 1 / geo.scale);
    const sourceRadius = defaultSourceRadius(canvasAttrs.width, canvasAttrs.height, limits);
    const lensRadius = deriveLensRadius(sourceRadius, canvasAttrs.width, canvasAttrs.height, limits);
    // placeLensE's E candidate: center = down + (sourceRadius+GAP_PX+lensRadius, 0);
    // fits fully on-canvas iff center.x + lensRadius <= canvasW, i.e.
    // down.x <= canvasW - sourceRadius - GAP_PX - 2*lensRadius.
    expect(down.x).toBeLessThanOrEqual(canvasAttrs.width - sourceRadius - GAP_PX - 2 * lensRadius);
    const atDown = placeLensE(down, sourceRadius, lensRadius);
    const offset = { x: atDown.x - down.x, y: atDown.y - down.y };
    const atFinal = clampLensCenter(
      { x: release.x + offset.x, y: release.y + offset.y },
      lensRadius,
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

    // The lens center always maps exactly to `from` under the loupe's
    // uniform sampling (see magnifier.ts's clampSampleRect doc comment) —
    // zoom- and placement-independent. `from` is now the RELEASE point
    // (25,25), inside the black square, so the lens center reads black —
    // proof the source followed the slide instead of staying at the (white)
    // down point.
    const lensCenterPixel = await pixelAt(page, atFinal.x, atFinal.y);
    expect(colorDelta(lensCenterPixel, BLACK)).toBeLessThan(20);

    // 3. Release auto-selects the new loupe and switches to the select tool
    // (Addendum A) — both immediately visible: the toolbar's active-tool
    // highlight moves, and the floating delete button appears, with zero
    // extra taps.
    await expect(page.locator('[data-tool="select"]')).toHaveClass(/active/);
    await expect(page.locator('[data-tool="magnifier"]')).not.toHaveClass(/active/);
    await expect(page.locator(".selection-delete")).toBeVisible();

    // 4. WITHOUT any tool tap (already selected, already on the select
    // tool), drag the lens BODY, PERPENDICULAR to the from->at line (i.e.
    // vertically, since `offset.y` is 0 here) rather than along it —
    // dragging further along the same line would put the OLD center back on
    // top of the (moved) source<->lens connector, which is drawn along very
    // nearly that same line, making "reverted to white" fail for the wrong
    // reason. The drag distance is derived from the lens's own radius (+ a
    // safety margin) so the old and new lens circles are guaranteed
    // disjoint.
    geo = await canvasGeometry(page); // re-read: the tool switch can re-layout the toolbar/stage
    const atOldScreen = toScreen(geo, atFinal.x, atFinal.y);

    const dragBitmap = lensRadius + 8;
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

    // The old lens CENTER itself is unusable as a "reverted to background"
    // probe: it sits inside the black square's magnified image (see step 2),
    // so it reads BLACK even before any move, not white. Probe a fixed point,
    // `(95, 10)`, instead — recomputed (not assumed) for the EXTREME-TAPER
    // FAN+ARC connector (Addendum C §8, 2026-08-02a; the note's own §8.5
    // arithmetic is independently re-derived below rather than copied, per
    // this project's "redo the numbers" rule — it checks out exactly): with
    // `from=(25,25)`, `r1=sourceRadius=13.5`, and the post-drag lens at
    // `atNew=(78.5,64)`, `r2=lensRadius=28`, the trimmed axis runs
    // `p1≈(35.9,33.0)` to `p2≈(55.9,47.5)` exactly as under Addendum B/C's
    // first cut (trimmedConnectorAxis depends only on the radii/centers, not
    // the stroke widths below, so the magnifier UX brush-up's ratio changes
    // don't move it); `w1=markerStroke=max(1,6*0.9)=5.4` (narrow source end;
    // was 3.6 at the old MAGNIFIER_MARKER_STROKE_RATIO=0.6) and
    // `w2=max(FAN_RATIO(0.6)*r2=16.8, markerStroke=5.4,
    // lensStroke=max(1,6*1.5)=9)=16.8` (the FAN term still dominates both
    // trailing floor terms, same as before — `lensStroke` replaces the old
    // bare `strokeWidth=6` term now that the lens border itself is
    // `strokeWidth * MAGNIFIER_LENS_STROKE_RATIO`, but the max is unchanged
    // either way), unsaturated (`MAX_LENS_WIDTH_RATIO(1.0)*r2=28 > 16.8`) —
    // so `theta = asin(16.8/56) ≈ 17.46°`, and the lens-end ARC's two endpoints are
    // ≈(51.97, 55.05) (the `+n` side, toward the drag direction) and
    // ≈(61.86, 41.48) (the `-n` side). The probe is on the `-n` side, so the
    // nearest connector ink is that second endpoint, ≈45.7px away; the true
    // nearest point of the full lens rim is well outside the arc's ≈35°
    // span, so the arc doesn't bring anything closer than that endpoint.
    // Subtracting the connector's own 2px halo overshoot leaves ≈43.7px of
    // clearance (down from ≈49px under the first flat-ended Addendum-C cut,
    // since the wide end is now a fan rather than a stroke-anchored band) —
    // still far beyond the ~1px an antialiasing fringe reaches. At ≈24.4px
    // from the OLD lens center (78.5, 28) with old radius 28, the probe sat
    // ≈3.6px inside the OLD lens's own rim, i.e. on the OLD lens's
    // accent-colored border stroke, and should read the plain white
    // background once that border moves away with the lens. Also clear of
    // the (still-drawn, loupe still selected) zoom readout, beside the
    // SOURCE ring near (25, 25), ≈72px away. Revisit/recompute this offset
    // if the M size preset, `MAGNIFIER_GAP_PX`,
    // `MAGNIFIER_SOURCE_RADIUS_FRACTION`, any Addendum B size-limit constant,
    // or either connector-width expression in `render.ts`
    // (`MAGNIFIER_CONNECTOR_FAN_RATIO` or `MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO`)
    // is ever retuned. (The later post-undo white-revert probe below, at
    // `atNew`, re-derives against the RESTORED pre-drag lens position
    // `(78.5, 28)` the same way: nearest connector ink is the `+n`-side arc
    // endpoint at ≈39.8px, ≈37.8px clearance after the halo.)
    const oldLensAreaAfterMove = await pixelAt(page, 95, 10);
    expect(colorDelta(oldLensAreaAfterMove, WHITE)).toBeLessThan(20);

    // 5. Undo reverts the single most-recent history step — the lens-body
    // move (creation and move are two separate, independently undoable
    // steps, same one-gesture-one-undo-step granularity as every other tool
    // in this app) — so the lens returns to its pre-drag position: the OLD
    // center shows the source pixel again, and the NEW center goes back to
    // plain background.
    await page.locator("#undo").tap();
    const oldCenterAfterUndo = await pixelAt(page, atFinal.x, atFinal.y);
    expect(colorDelta(oldCenterAfterUndo, BLACK)).toBeLessThan(20);
    const newCenterAfterUndo = await pixelAt(page, atNew.x, atNew.y);
    expect(colorDelta(newCenterAfterUndo, WHITE)).toBeLessThan(20);
  });

  test("source-body drag pans the source without moving the lens, and works even while the magnifier is unselected (magnifier UX brush-up)", async ({ page }) => {
    // Same slide-to-aim creation gesture as the scenario above (see its
    // step 2 comment for the full derivation): down on plain white
    // background, slide onto the black square's center, release. Yields the
    // same geometry as that test — sourceRadius=13.5, lensRadius=28,
    // at=(78.5,28) — since this fixture/gesture pair is unchanged; re-derived
    // here rather than imported, to keep this test block self-contained.
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    await page.locator('[data-tool="magnifier"]').tap();

    const geo = await canvasGeometry(page);
    const canvasAttrs = await page.locator("#canvas").evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
    expect(geo.scale).toBe(1);
    const down = { x: 35, y: 45 };
    const release = { x: 25, y: 25 };

    const limits = sizeLimits(canvasAttrs.width, canvasAttrs.height, 1 / geo.scale);
    const sourceRadius = defaultSourceRadius(canvasAttrs.width, canvasAttrs.height, limits);
    const lensRadius = deriveLensRadius(sourceRadius, canvasAttrs.width, canvasAttrs.height, limits);
    const atDown = placeLensE(down, sourceRadius, lensRadius);
    const offset = { x: atDown.x - down.x, y: atDown.y - down.y };
    const at = clampLensCenter(
      { x: release.x + offset.x, y: release.y + offset.y },
      lensRadius,
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

    // Sanity check this test's own re-derivation against the scenario above.
    expect(sourceRadius).toBeCloseTo(13.5);
    expect(lensRadius).toBe(28);
    expect(at.x).toBeCloseTo(78.5);
    expect(at.y).toBeCloseTo(28);
    await expect(page.locator(".selection-delete")).toBeVisible(); // auto-selected on release

    // A fixed probe just outside the lens's rim+halo band, on the EAST side —
    // the source (west of the lens, at from=(25,25) initially) and its
    // connector never reach this side before or after either drag below, so
    // any change here would mean the LENS itself moved, not the source.
    // lensStroke = max(1, 6*MAGNIFIER_LENS_STROKE_RATIO) = 9; halo band
    // half-width = (lensStroke+4)/2 = 6.5; rim+halo extends to
    // at.x + lensRadius + 6.5 = 78.5+28+6.5 = 113; 118 clears it with margin,
    // and is still inside the 120-wide canvas.
    const probe = { x: 118, y: 28 };
    const probeBeforeA = await pixelAt(page, probe.x, probe.y);

    // (a) WHILE SELECTED: press inside the source disc's NW quadrant (clear
    // of the SE src-zoom grip, which sits at from + sourceRadius*(cos45,sin45)
    // — the opposite corner) and drag. `from` moves by the exact pointer
    // delta (translateAnnotation's "source" branch, unclamped); the press
    // point itself is irrelevant to the result, only the delta is.
    let from = { x: release.x, y: release.y }; // (25,25) — the black square's center
    const pressA = { x: from.x - 0.35 * sourceRadius, y: from.y - 0.35 * sourceRadius };
    const deltaA = { x: -15, y: -15 };
    const finalA = { x: pressA.x + deltaA.x, y: pressA.y + deltaA.y };
    from = { x: from.x + deltaA.x, y: from.y + deltaA.y }; // (10,10) — off the black square, plain white

    const pressAScreen = toScreen(geo, pressA.x, pressA.y);
    const finalAScreen = toScreen(geo, finalA.x, finalA.y);
    await page.mouse.move(pressAScreen.x, pressAScreen.y);
    await page.mouse.down();
    await page.mouse.move((pressAScreen.x + finalAScreen.x) / 2, (pressAScreen.y + finalAScreen.y) / 2, { steps: 3 });
    await page.mouse.move(finalAScreen.x, finalAScreen.y, { steps: 3 });
    await page.mouse.up();

    // The lens center still maps 1:1 to `from` (uniform sampling,
    // zoom/placement-independent — see magnifier.ts's clampSampleRect doc
    // comment): `from` is now (10,10), plain white background, so the lens
    // center reads white — proof the SOURCE moved.
    const lensCenterAfterA = await pixelAt(page, at.x, at.y);
    expect(colorDelta(lensCenterAfterA, WHITE)).toBeLessThan(20);
    // The fixed probe is unchanged — proof the LENS did not move.
    const probeAfterA = await pixelAt(page, probe.x, probe.y);
    expect(probeAfterA).toEqual(probeBeforeA);

    // Deselect (tap a point clear of both discs) before part (b), which
    // pins that the source-body drag also works on an UNSELECTED magnifier
    // (design decision: "live even when the magnifier is unselected").
    const emptyScreen = toScreen(geo, 5, 80);
    await page.mouse.move(emptyScreen.x, emptyScreen.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator(".selection-delete")).not.toBeVisible();

    // (b) WHILE UNSELECTED: press inside the (moved) source disc's NW
    // quadrant again and drag back onto the black square. No resize-handle
    // machinery is even consulted here (rotateOrResizeTarget only looks at
    // the CURRENTLY selected annotation, which is null) — this press must
    // resolve through the plain hitTest -> magnifierHitPart path.
    const pressB = { x: from.x - 0.35 * sourceRadius, y: from.y - 0.35 * sourceRadius };
    const deltaB = { x: 15, y: 15 };
    const finalB = { x: pressB.x + deltaB.x, y: pressB.y + deltaB.y };
    from = { x: from.x + deltaB.x, y: from.y + deltaB.y }; // back to (25,25)

    const pressBScreen = toScreen(geo, pressB.x, pressB.y);
    const finalBScreen = toScreen(geo, finalB.x, finalB.y);
    await page.mouse.move(pressBScreen.x, pressBScreen.y);
    await page.mouse.down();
    await page.mouse.move((pressBScreen.x + finalBScreen.x) / 2, (pressBScreen.y + finalBScreen.y) / 2, { steps: 3 });
    await page.mouse.move(finalBScreen.x, finalBScreen.y, { steps: 3 });
    await page.mouse.up();

    // The press-and-drag both SELECTED the magnifier (delete button back)
    // and MOVED the source (lens center reads black again, from is back on
    // the black square) — pinning that a source-body drag on an unselected
    // magnifier does both in one gesture.
    await expect(page.locator(".selection-delete")).toBeVisible();
    const lensCenterAfterB = await pixelAt(page, at.x, at.y);
    expect(colorDelta(lensCenterAfterB, BLACK)).toBeLessThan(20);
  });

  test("the floating delete button avoids the source disc when it's dragged NE of the lens, and stays functional after moving", async ({ page }) => {
    // Same slide-to-aim creation gesture as the two scenarios above — see
    // the first test's step 2 comment for the full derivation. Yields
    // sourceRadius=13.5, lensRadius=28, at=(78.5,28), from=(25,25).
    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    await page.locator('[data-tool="magnifier"]').tap();

    let geo = await canvasGeometry(page);
    const canvasAttrs = await page.locator("#canvas").evaluate((el: HTMLCanvasElement) => ({ width: el.width, height: el.height }));
    expect(geo.scale).toBe(1);
    const down = { x: 35, y: 45 };
    const release = { x: 25, y: 25 };

    const limits = sizeLimits(canvasAttrs.width, canvasAttrs.height, 1 / geo.scale);
    const sourceRadius = defaultSourceRadius(canvasAttrs.width, canvasAttrs.height, limits);
    const lensRadius = deriveLensRadius(sourceRadius, canvasAttrs.width, canvasAttrs.height, limits);
    const atDown = placeLensE(down, sourceRadius, lensRadius);
    const offset = { x: atDown.x - down.x, y: atDown.y - down.y };
    const at = clampLensCenter(
      { x: release.x + offset.x, y: release.y + offset.y },
      lensRadius,
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

    // Sanity check this test's own re-derivation against the sibling tests.
    expect(sourceRadius).toBeCloseTo(13.5);
    expect(lensRadius).toBe(28);
    expect(at.x).toBeCloseTo(78.5);
    expect(at.y).toBeCloseTo(28);
    await expect(page.locator(".selection-delete")).toBeVisible(); // auto-selected on release

    // Drag the source body so its center lands NE of the lens, just beyond
    // the PADDED selection marquee's own NE corner (`SELECTION_PAD_PX`,
    // mirrored below — canvas.ts's private constant the legacy NE button
    // placement is offset from) — the reported layout, tightened just
    // enough to guarantee the raw source disc actually reaches the legacy
    // NE button rect (verified against the pre-fix code path: nearest-point
    // distance ~8.5 CSS px, under the 13.5 CSS px raw source radius), so
    // this test would fail against the old NE-only placement, not just
    // against a hypothetically-tighter one. `translateAnnotation`'s
    // "source" branch is unclamped (see the sibling source-body-drag test's
    // part (a) comment), so `from` lands exactly there even though it's a
    // hair off the top of this small fixture canvas — irrelevant here since
    // this test only cares about screen-space button/disc geometry, not
    // sampled pixel content at `from`.
    const SELECTION_PAD_PX = 6; // mirrors canvas.ts's private SELECTION_PAD_PX
    const from0 = { x: release.x, y: release.y }; // (25,25)
    const cornerOffset = lensRadius + SELECTION_PAD_PX + 2;
    const target = { x: at.x + cornerOffset, y: at.y - cornerOffset };
    const press = { x: from0.x - 0.35 * sourceRadius, y: from0.y - 0.35 * sourceRadius }; // NW quadrant of the source disc, clear of the SE src-zoom grip
    const delta = { x: target.x - from0.x, y: target.y - from0.y };
    const final = { x: press.x + delta.x, y: press.y + delta.y };

    geo = await canvasGeometry(page); // re-read: defensive, matches the sibling tests' pattern
    const pressScreen = toScreen(geo, press.x, press.y);
    const finalScreen = toScreen(geo, final.x, final.y);
    await page.mouse.move(pressScreen.x, pressScreen.y);
    await page.mouse.down();
    await page.mouse.move((pressScreen.x + finalScreen.x) / 2, (pressScreen.y + finalScreen.y) / 2, { steps: 3 });
    await page.mouse.move(finalScreen.x, finalScreen.y, { steps: 3 });
    await page.mouse.up();

    await expect(page.locator(".selection-delete")).toBeVisible();

    // The delete button must clear the (moved) source disc by the FULL
    // enforced clearance, not just the raw disc: canvas.ts expands the
    // avoid radius by `HANDLE_HIT_PX * TOUCH_HIT_MULTIPLIER +
    // SELECTION_CONTROLS_MARGIN_PX` (12*2+8 = 32 CSS px, mirrored below) —
    // the src-zoom grip's own touch hit radius, drawn on the source rim —
    // before deciding whether a corner conflicts. Asserting against this
    // tighter, enforced radius (not just the raw disc) catches near-misses
    // that clear the disc itself but still land on top of the grip.
    const sourceCenterScreen = toScreen(geo, target.x, target.y);
    const HANDLE_HIT_PX = 12; // mirrors canvas.ts's private HANDLE_HIT_PX
    const TOUCH_HIT_MULTIPLIER = 2; // mirrors canvas.ts's private TOUCH_HIT_MULTIPLIER
    const SELECTION_CONTROLS_MARGIN_PX = 8; // mirrors canvas.ts's private SELECTION_CONTROLS_MARGIN_PX
    const clearanceRadiusScreen = sourceRadius * geo.scale + HANDLE_HIT_PX * TOUCH_HIT_MULTIPLIER + SELECTION_CONTROLS_MARGIN_PX;
    const deleteBtn = page.locator(".selection-delete");
    const btnBox = await deleteBtn.boundingBox();
    expect(btnBox).not.toBeNull();
    const box = btnBox!;
    const dx = Math.max(box.x - sourceCenterScreen.x, 0, sourceCenterScreen.x - (box.x + box.width));
    const dy = Math.max(box.y - sourceCenterScreen.y, 0, sourceCenterScreen.y - (box.y + box.height));
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(clearanceRadiusScreen);

    // Clicking the (repositioned) button still deletes through the normal
    // deleteSelected() path: the button disappears (selection cleared) and
    // the lens's magnified content is gone — the bitmap-px lens center now
    // shows the plain background pixel underneath (white) instead of the
    // (black) magnified source content.
    await deleteBtn.click();
    await expect(page.locator(".selection-delete")).not.toBeVisible();
    const lensAreaAfterDelete = await pixelAt(page, at.x, at.y);
    expect(colorDelta(lensAreaAfterDelete, WHITE)).toBeLessThan(20);
  });

  test("a document reset (Ctrl+N) mid-drag during magnifier creation does not throw and does not commit a phantom loupe", async ({ page }) => {
    // Round-2 review bug: `setBackground`/`restore`/`clearDocument`/
    // `applyCrop` reset `move`/`resize`/`rotateDrag`/`magnifierPlace` but
    // never `draft` — so a document reset mid-drag left a stale
    // `draft.kind === "magnifier"` around while `magnifierPlace` was wiped.
    // The next `pointermove` then dereferenced `this.magnifierPlace!` (now
    // null) and threw, and releasing afterward would have committed the
    // stale draft into the just-reset document as a phantom annotation. The
    // fix resets `draft` alongside the other gesture state at all four
    // choke points, so `onMove`'s `if (this.draft)` guard now skips
    // entirely and `onUp`'s `if (!this.draft) return;` bails out cleanly —
    // this test would have failed (thrown page error, or left a phantom
    // loupe / stray selection chrome) before that fix.
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.goto("/");
    await loadTestImage(page, SMALL_PNG_BASE64);

    await page.locator('[data-tool="magnifier"]').tap();

    const geo = await canvasGeometry(page);
    const down = toScreen(geo, 60, 45); // plain white background
    const moved = toScreen(geo, 40, 60);

    // Start the creation gesture (onDown arms `draft` + `magnifierPlace`)
    // but do NOT release yet.
    await page.mouse.move(down.x, down.y);
    await page.mouse.down();

    // Ctrl+N mid-drag -> clearDocument() (app.ts's global keydown handler;
    // isTypingTarget() doesn't block it since nothing has DOM focus here).
    await page.keyboard.press("Control+n");

    // Continue the (now-stale) gesture: move, then release.
    await page.mouse.move(moved.x, moved.y, { steps: 3 });
    await page.mouse.up();

    expect(pageErrors).toEqual([]);
    // Back to the empty/welcome state (clearDocument discarded the
    // document) — no ghost loupe, no leftover selection chrome from a
    // phantom commit.
    await expect(page.locator("#stage")).toHaveClass(/empty/);
    await expect(page.locator(".selection-delete")).not.toBeVisible();
  });
});
