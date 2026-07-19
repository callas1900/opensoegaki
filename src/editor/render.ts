/**
 * Pure rendering of the object model onto a CanvasRenderingContext2D.
 * Used both by the live editor canvas and by the exporter — keep it side-effect free.
 */
import type { Annotation, ArrowAnnotation, RectAnnotation, TextAnnotation, HighlighterAnnotation, BadgeAnnotation, ImageAnnotation } from "./model";
import { contrastText, HIGHLIGHTER_WIDTH_SCALE } from "./model";

const OUTLINE = "rgba(255,255,255,0.9)";

export const FONT_STACK = "system-ui, sans-serif";
export function fontString(fontSize: number): string {
  return `bold ${fontSize}px ${FONT_STACK}`;
}

export function renderAnnotations(
  ctx: CanvasRenderingContext2D,
  list: Annotation[],
  images: ReadonlyMap<string, ImageBitmap>,
): void {
  for (const a of list) {
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
    }
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

/** Filled circle + white ring + centered number. save/restore is load-bearing: textAlign/textBaseline must not leak into drawText. */
function drawBadge(ctx: CanvasRenderingContext2D, a: BadgeAnnotation): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(a.at.x, a.at.y, a.radius, 0, 2 * Math.PI);
  ctx.fillStyle = a.color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(2, a.radius * 0.15);
  ctx.stroke();
  ctx.font = fontString(a.radius * 1.2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = contrastText(a.color);
  ctx.fillText(String(a.number), a.at.x, a.at.y);
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
