/**
 * Rasterization: object model -> PNG bytes. The only place annotations become pixels.
 */
import type { Doc } from "./model";
import { renderAnnotations } from "./render";

export async function exportPng(doc: Doc): Promise<Uint8Array> {
  if (!doc.imageBitmap) throw new Error("Nothing to export");
  const off = new OffscreenCanvas(doc.imageBitmap.width, doc.imageBitmap.height);
  const ctx = off.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(doc.imageBitmap, 0, 0);
  renderAnnotations(ctx as unknown as CanvasRenderingContext2D, doc.annotations, doc.images);
  const blob = await off.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}
