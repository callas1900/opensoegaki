/**
 * Pure rendering of the object model onto a CanvasRenderingContext2D.
 * Used both by the live editor canvas and by the exporter — keep it side-effect free.
 */
import type { Annotation, ArrowAnnotation, RectAnnotation, TextAnnotation, HighlighterAnnotation, BadgeAnnotation, ImageAnnotation, MagnifierAnnotation } from "./model";
import { contrastText, HIGHLIGHTER_WIDTH_SCALE } from "./model";
import { badgeHalfWidth, fontString } from "./bounds";
import { pivotOfAnnotation } from "./rotate";
import { magnifierSourceRadius, magnifierSourceRect, magnifierLensRect, clampSampleRect, connectorShape } from "./magnifier";

const OUTLINE = "rgba(255,255,255,0.9)";

// Lens-border stroke weight relative to strokeWidth (floored at 1px) — the
// magnifier's PRIMARY frame weight (design note "magnifier UX brush-up",
// 2026-08-06): the S/M/L stroke picker is the user's only weight lever, and
// at the pre-brush-up ratio (strokeWidth verbatim) the lens border read as a
// hairline on a large capture. 1.5× thickens it uniformly across every size.
// `MAGNIFIER_MARKER_STROKE_RATIO` (below) is defined relative to THIS ratio,
// not to `strokeWidth` directly, so the marker layer (source ring + connector
// narrow end) keeps its fixed 0.6:1 relationship to the lens border at every
// stroke width.
export const MAGNIFIER_LENS_STROKE_RATIO = 1.5;

// Marker-layer stroke weight relative to strokeWidth (floored at 1px) — the
// source ring's weight, AND the source<->lens connector's NARROW (source)
// end weight only. (Addendum C, 2026-08-02a §8: the connector's WIDE (lens)
// end is no longer weight-anchored at all — see MAGNIFIER_CONNECTOR_FAN_RATIO
// below — so this ratio no longer describes it in any form.) Exported so
// hittest.ts's source-ring hit band uses the exact same weight the ring is
// actually drawn at — one owner for "how thick is the ring / the connector's
// narrow tip". Renamed from `MAGNIFIER_SOURCE_STROKE_RATIO` (Addendum B,
// 2026-08-02). 0.6 -> 0.9 (design note "magnifier UX brush-up", 2026-08-06,
// alongside MAGNIFIER_LENS_STROKE_RATIO above): still exactly 0.6 × the lens
// border (`0.9 / 1.5 = 0.6`), preserving the marker/frame weight relationship
// the connector's flushness arithmetic (magnifier.ts's `connectorShape` doc
// comment) depends on.
export const MAGNIFIER_MARKER_STROKE_RATIO = 0.9;

// The connector's lens-end APERTURE, as a fraction of the lens radius itself
// (Addendum C §8, 2026-08-02a — supersedes §2's `Math.max(markerStroke,
// a.strokeWidth)` weight rule, per the user's explicit "make it much more
// extreme" follow-up request, exactly the escape hatch that rule's own doc
// comment anticipated). Anchoring the wide end to `a.radius` instead of to a
// stroke weight is deliberate: the half-angle the wedge subtends at the lens
// center is `asin(FAN_RATIO / 2)` — a CONSTANT 17.46 deg (a ~35 deg mouth) at
// every lens size, document scale, and display scale, because both the
// opposite side (`FAN_RATIO * r2`) and the hypotenuse (`r2`) of that triangle
// scale together. A stroke-anchored width cannot do this: it reads as wide on
// a small lens and as a pinstripe on a large one, because `strokeWidth` does
// not scale with the lens radius the way this ratio does. Owned here, in
// `render.ts` (not `magnifier.ts`), because it is an EDITORIAL aperture
// choice — how wide the connector should look — as opposed to
// `MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO` (magnifier.ts), which is a
// GEOMETRIC domain bound on how wide `connectorShape`'s arc math can accept;
// neither constant is derivable from the other, so this project's one-owner
// rule gives each its own home rather than collapsing them into one.
export const MAGNIFIER_CONNECTOR_FAN_RATIO = 0.6;

/**
 * Draw every annotation in `list`. Unrotated annotations (the overwhelming
 * majority — `if (!a.angle)`) take the exact byte-identical path this
 * function always has, at zero extra cost (no `measureText` for the pivot).
 * A rotated annotation is wrapped in the standard
 * translate(pivot)/rotate/translate(-pivot) transform around the center of
 * its own unrotated `boundsOf` box (`pivotOfAnnotation`, rotate.ts) — the
 * single generic mechanism that makes every kind rotate correctly with no
 * per-kind drawing changes. `exporter.ts` calls this same function on its
 * offscreen context, so rotation is exported for free.
 *
 * `background` is the ONLY bitmap the magnifier annotation samples from (see
 * `drawMagnifier`) — required, not optional, so both call sites (`canvas.ts`'s
 * `render()`, `exporter.ts`) are forced to pass it explicitly rather than
 * silently rendering a magnifier with nothing inside.
 */
export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  list: Annotation[],
  images: ReadonlyMap<string, ImageBitmap>,
  background: ImageBitmap | null,
): void {
  for (const a of list) {
    if (!a.angle) {
      drawOne(ctx, a, images, background);
      continue;
    }
    ctx.save();
    const pivot = pivotOfAnnotation(a, ctx);
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(a.angle);
    ctx.translate(-pivot.x, -pivot.y);
    drawOne(ctx, a, images, background);
    ctx.restore();
  }
}

function drawOne(ctx: CanvasRenderingContext2D, a: Annotation, images: ReadonlyMap<string, ImageBitmap>, background: ImageBitmap | null): void {
  switch (a.kind) {
    case "arrow":
      drawArrow(ctx, a);
      break;
    case "rect":
      drawRect(ctx, a);
      break;
    case "text":
      drawText(ctx, a);
      break;
    case "highlight":
      drawHighlight(ctx, a);
      break;
    case "badge":
      drawBadge(ctx, a);
      break;
    case "image":
      drawImageAnnotation(ctx, a, images);
      break;
    case "magnifier":
      drawMagnifier(ctx, a, background);
      break;
  }
}

/** Skitch-style readable arrow: white outline pass, then colored pass. */
function drawArrow(ctx: CanvasRenderingContext2D, a: ArrowAnnotation): void {
  const { from, to } = a;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLen = a.strokeWidth * 3.2;

  const path = new Path2D();
  path.moveTo(from.x, from.y);
  path.lineTo(to.x, to.y);
  for (const side of [-1, 1]) {
    path.moveTo(to.x, to.y);
    path.lineTo(
      to.x - headLen * Math.cos(angle - side * Math.PI / 6),
      to.y - headLen * Math.sin(angle - side * Math.PI / 6),
    );
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = a.strokeWidth + 4;
  ctx.stroke(path);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.strokeWidth;
  ctx.stroke(path);
}

function drawRect(ctx: CanvasRenderingContext2D, a: RectAnnotation): void {
  const x = Math.min(a.a.x, a.b.x);
  const y = Math.min(a.a.y, a.b.y);
  const w = Math.abs(a.a.x - a.b.x);
  const h = Math.abs(a.a.y - a.b.y);

  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = a.strokeWidth + 4;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.strokeWidth;
  ctx.strokeRect(x, y, w, h);
}

function drawText(ctx: CanvasRenderingContext2D, a: TextAnnotation): void {
  ctx.font = fontString(a.fontSize);
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.strokeText(a.text, a.at.x, a.at.y);
  ctx.fillStyle = a.color;
  ctx.fillText(a.text, a.at.x, a.at.y);
}

const HIGHLIGHT_MULTIPLY_ALPHA = 0.45;
const HIGHLIGHT_SCREEN_ALPHA = 0.3;

/**
 * Translucent marker-style stroke; deliberately no white outline pass (unlike
 * arrow/rect/text). Two passes over the same path: multiply deposits color on
 * light backgrounds while keeping dark text/lines legible underneath; screen
 * lifts the stroke into view on dark/black backgrounds (a no-op over white).
 */
function drawHighlight(ctx: CanvasRenderingContext2D, a: HighlighterAnnotation): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = a.strokeWidth * HIGHLIGHTER_WIDTH_SCALE;
  ctx.strokeStyle = a.color;
  ctx.beginPath();
  ctx.moveTo(a.points[0].x, a.points[0].y);
  for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = HIGHLIGHT_MULTIPLY_ALPHA;
  ctx.stroke();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = HIGHLIGHT_SCREEN_ALPHA;
  ctx.stroke();
  ctx.restore();
}

/**
 * Auto badges: filled circle + white ring + centered number, shrinking the
 * font to fit if a multi-digit number would overflow the fixed radius.
 * Manual (fixed-number) badges: same fill/ring/text treatment, but drawn as a
 * rounded rect that widens (via `badgeHalfWidth`) to fit the number at the
 * normal badge font size instead of shrinking it — these numbers are the
 * point (categorizing items), so they stay full-size and legible.
 * save/restore is load-bearing: textAlign/textBaseline must not leak into drawText.
 */
function drawBadge(ctx: CanvasRenderingContext2D, a: BadgeAnnotation): void {
  ctx.save();
  const text = String(a.number);
  const ringWidth = Math.max(2, a.radius * 0.15);

  if (a.manual) {
    const hw = badgeHalfWidth(a);
    ctx.beginPath();
    ctx.roundRect(a.at.x - hw, a.at.y - a.radius, hw * 2, a.radius * 2, a.radius * 0.45);
    ctx.fillStyle = a.color;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = ringWidth;
    ctx.stroke();
    ctx.font = fontString(a.radius * 1.2);
  } else {
    ctx.beginPath();
    ctx.arc(a.at.x, a.at.y, a.radius, 0, 2 * Math.PI);
    ctx.fillStyle = a.color;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = ringWidth;
    ctx.stroke();
    ctx.font = fontString(a.radius * 1.2);
    const width = ctx.measureText(text).width;
    if (width > a.radius * 1.6) {
      ctx.font = fontString(a.radius * 1.2 * ((a.radius * 1.6) / width));
    }
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = contrastText(a.color);
  ctx.fillText(text, a.at.x, a.at.y);
  ctx.restore();
}

/**
 * Draw a previously-inserted image at its stored position/size. The actual
 * pixel data lives in `Doc.images` (keyed by annotation id), not on the
 * annotation itself; if the bitmap isn't in the map (e.g. a stale reference),
 * skip silently rather than throwing.
 */
function drawImageAnnotation(
  ctx: CanvasRenderingContext2D,
  a: ImageAnnotation,
  images: ReadonlyMap<string, ImageBitmap>,
): void {
  const bmp = images.get(a.id);
  if (!bmp) return;
  ctx.drawImage(bmp, a.at.x, a.at.y, a.width, a.height);
}

/**
 * Magnifier/loupe. Draw order matters — connector first (tucks under both
 * rims' strokes), then the source ring, then the clipped lens content, then
 * the lens border last (over the content, so the stroke isn't half-clipped).
 *
 * Samples `background` (== `doc.imageBitmap`) ONLY — never other
 * annotations, never `ctx.canvas`. Sampling the canvas would make the result
 * depend on draw order, diverge between the live canvas (which has a draft in
 * flight) and the export, and create paradoxes with two loupes pointing at
 * each other. So an arrow drawn over the detail does not appear magnified
 * inside the lens.
 *
 * TASK-42 hazard (multi-select group rotation): a magnifier must be
 * translation-only under group rotation — rigidly rotate `from`/`at`, never
 * set `angle`. `ctx.drawImage`'s source rect is always axis-aligned in image
 * space and unaffected by the ctx transform, while the source ring drawn
 * inside `renderAnnotations`'s generic rotate transform WOULD swing around
 * the lens's pivot — pointing at a region the loupe does not actually sample.
 */
function drawMagnifier(ctx: CanvasRenderingContext2D, a: MagnifierAnnotation, background: ImageBitmap | null): void {
  const sourceRadius = magnifierSourceRadius(a);
  // Set unconditionally, up front (matches drawArrow's pattern), rather than
  // only inside the connector branch below — the previous conditional set
  // made the leaked ctx.lineCap state into the NEXT annotation's draw call
  // depend on whether THIS magnifier happened to have a connector, which is
  // deterministic in what it leaks but not in an obviously-correct way.
  ctx.lineCap = "round";

  // Marker-layer stroke weight, shared by the connector (below) and the
  // source ring (step 2) — computed once so the two can never drift apart.
  const markerStroke = Math.max(1, a.strokeWidth * MAGNIFIER_MARKER_STROKE_RATIO);
  // Lens-border stroke weight (design note "magnifier UX brush-up"),
  // computed once and shared by both lens-border passes (step 4) AND the
  // connector's wide-end floor (step 1) — one owner, so the border and the
  // connector's wide end can never drift apart the way `markerStroke` above
  // already guarantees for the narrow end.
  const lensStroke = Math.max(1, a.strokeWidth * MAGNIFIER_LENS_STROKE_RATIO);

  // 1. Connector, underneath both rings — a wedge that fans out toward the
  // lens (Addendum C, 2026-08-02a §8; was a flat-ended tapered quad earlier
  // in Addendum C, a uniform-weight rim-to-rim segment in Addendum B, and
  // two external tangents before that): the user's explicit follow-up asked
  // for the taper to be "much more extreme" than the first Addendum-C build.
  // Narrow (source) end = markerStroke, UNCHANGED from the first cut. Wide
  // (lens) end is no longer weight-anchored at all: `Math.max(
  // MAGNIFIER_CONNECTOR_FAN_RATIO * a.radius, markerStroke, lensStroke)` —
  // the fan term is the one that actually matters (it dwarfs the other two
  // for any realistic lens), and the trailing `markerStroke`/`lensStroke`
  // terms exist only as a floor so the wide end never becomes narrower than
  // the narrow one on a pathologically tiny lens (same monotonicity
  // guarantee the earlier `Math.max` already made, just extended to a third
  // term; `lensStroke` replaces the old bare `a.strokeWidth` floor now that
  // the lens border itself is `a.strokeWidth * MAGNIFIER_LENS_STROKE_RATIO`,
  // not `a.strokeWidth` — the floor tracks what actually gets drawn). The
  // GEOMETRIC cap that keeps this width sane relative to the lens
  // itself (`MAGNIFIER_CONNECTOR_MAX_LENS_WIDTH_RATIO`) is applied INSIDE
  // `connectorShape`, not here — this expression is the uncapped editorial
  // request, and the cap is a separate, differently-owned concern (see that
  // constant's doc comment in magnifier.ts).
  const connector = connectorShape(
    a.from,
    sourceRadius,
    a.at,
    a.radius,
    markerStroke,
    Math.max(MAGNIFIER_CONNECTOR_FAN_RATIO * a.radius, markerStroke, lensStroke),
  );
  if (connector) {
    const { source, lens } = connector;
    const path = new Path2D();
    path.moveTo(source[0].x, source[0].y);
    path.arc(lens.center.x, lens.center.y, lens.radius, lens.startAngle, lens.endAngle);
    path.lineTo(source[1].x, source[1].y);
    path.closePath();
    // `lineWidth = 4` here is the SAME house halo constant every other
    // two-pass stroke in this file writes as `+ 4` on top of a centerline —
    // applied to a boundary instead, since the outline is now stroked along
    // the wedge's own edge rather than straddling a centerline. `stroke()`
    // follows an arc segment exactly as it follows a straight one, so the
    // 2px white band wraps the lens-end arc too. Stroking a width-X line at
    // X+4 already puts exactly 2px of white beyond each edge; stroking a
    // closed boundary at width 4 puts that same 2px outside it directly. The
    // fill (not a second, narrower stroke) then covers the shape's interior
    // in `a.color` — this two-pass "stroke wide, fill over" is what makes
    // the taper possible at all (a stroke cannot vary its own width along
    // its length). No `ctx.lineJoin` is set — every corner and both arc
    // junctions are buried under a rim band; see connectorShape's doc
    // comment for the arithmetic.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.stroke(path);
    ctx.fillStyle = a.color;
    ctx.fill(path);
  }

  // 2. Source ring — secondary weight, outline only (no exterior dimming;
  // that's crop chrome, and this is exported content).
  const sourcePath = new Path2D();
  sourcePath.arc(a.from.x, a.from.y, sourceRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = markerStroke + 4;
  ctx.stroke(sourcePath);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = markerStroke;
  ctx.stroke(sourcePath);

  // 3. Lens content, clipped to the lens circle. save/restore is
  // load-bearing, exactly like drawBadge's: imageSmoothingEnabled/Quality and
  // the clip are ctx state that would otherwise leak into the next
  // annotation's drawImage call in this same loop (drawImageAnnotation).
  if (background) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(a.at.x, a.at.y, a.radius, 0, 2 * Math.PI);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const s = clampSampleRect(magnifierSourceRect(a), background.width, background.height, magnifierLensRect(a));
    if (s) ctx.drawImage(background, s.src.x, s.src.y, s.src.w, s.src.h, s.dest.x, s.dest.y, s.dest.w, s.dest.h);
    ctx.restore();
  }

  // 4. Lens border, last — over the clipped content so the stroke isn't
  // half-clipped. `lensStroke` (computed once above) replaces the bare
  // `a.strokeWidth` this used pre-brush-up — see MAGNIFIER_LENS_STROKE_RATIO.
  const lensPath = new Path2D();
  lensPath.arc(a.at.x, a.at.y, a.radius, 0, 2 * Math.PI);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = lensStroke + 4;
  ctx.stroke(lensPath);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = lensStroke;
  ctx.stroke(lensPath);
}
