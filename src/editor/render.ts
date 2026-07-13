/**
 * Pure rendering of the object model onto a CanvasRenderingContext2D.
 * Used both by the live editor canvas and by the exporter — keep it side-effect free.
 */
import type { Annotation, ArrowAnnotation, RectAnnotation, TextAnnotation } from "./model";

const OUTLINE = "rgba(255,255,255,0.9)";

export function renderAnnotations(ctx: CanvasRenderingContext2D, list: Annotation[]): void {
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
  ctx.font = `bold ${a.fontSize}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 4;
  ctx.strokeText(a.text, a.at.x, a.at.y);
  ctx.fillStyle = a.color;
  ctx.fillText(a.text, a.at.x, a.at.y);
}
