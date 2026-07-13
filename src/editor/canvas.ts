/**
 * Editor: owns the document, the <canvas>, pointer interaction and undo/redo.
 * Rendering of annotation shapes is delegated to render.ts (shared with export).
 */
import { type Annotation, type Doc, type Point, type ToolKind, DEFAULTS, nextId } from "./model";
import { renderAnnotations } from "./render";
import { History } from "./history";

export class Editor {
  readonly doc: Doc = { imageBitmap: null, annotations: [] };
  tool: ToolKind = "arrow";
  color: string = DEFAULTS.color;

  private readonly history = new History();
  private draft: Annotation | null = null;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
    this.bindPointerEvents();
  }

  /** Load a captured PNG (raw bytes) as the new background. */
  async loadImage(png: Uint8Array): Promise<void> {
    const blob = new Blob([png as BlobPart], { type: "image/png" });
    this.doc.imageBitmap = await createImageBitmap(blob);
    this.doc.annotations = [];
    this.history.clear();
    this.canvas.width = this.doc.imageBitmap.width;
    this.canvas.height = this.doc.imageBitmap.height;
    this.render();
  }

  undo(): void {
    const prev = this.history.undo(this.doc.annotations);
    if (prev) {
      this.doc.annotations = prev;
      this.render();
    }
  }

  redo(): void {
    const next = this.history.redo(this.doc.annotations);
    if (next) {
      this.doc.annotations = next;
      this.render();
    }
  }

  render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.doc.imageBitmap) ctx.drawImage(this.doc.imageBitmap, 0, 0);
    renderAnnotations(ctx, this.doc.annotations);
    if (this.draft) renderAnnotations(ctx, [this.draft]);
  }

  hasImage(): boolean {
    return this.doc.imageBitmap !== null;
  }

  // ---- pointer interaction -------------------------------------------------

  private bindPointerEvents(): void {
    this.canvas.addEventListener("pointerdown", (e) => this.onDown(this.toCanvas(e), e));
    this.canvas.addEventListener("pointermove", (e) => this.onMove(this.toCanvas(e)));
    this.canvas.addEventListener("pointerup", () => this.onUp());
  }

  /** Map client coords to canvas bitmap coords (canvas may be CSS-scaled). */
  private toCanvas(e: PointerEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.canvas.width,
      y: ((e.clientY - r.top) / r.height) * this.canvas.height,
    };
  }

  private onDown(p: Point, e: PointerEvent): void {
    if (!this.hasImage()) return;
    this.canvas.setPointerCapture(e.pointerId);
    const base = { id: nextId(), color: this.color, strokeWidth: DEFAULTS.strokeWidth };
    if (this.tool === "arrow") {
      this.draft = { ...base, kind: "arrow", from: p, to: p };
    } else if (this.tool === "rect") {
      this.draft = { ...base, kind: "rect", a: p, b: p };
    } else {
      const text = window.prompt("Text:");
      if (text) {
        this.commit({ ...base, kind: "text", at: p, text, fontSize: DEFAULTS.fontSize });
      }
    }
    this.render();
  }

  private onMove(p: Point): void {
    if (!this.draft) return;
    if (this.draft.kind === "arrow") this.draft.to = p;
    else if (this.draft.kind === "rect") this.draft.b = p;
    this.render();
  }

  private onUp(): void {
    if (!this.draft) return;
    const d = this.draft;
    this.draft = null;
    // Ignore accidental clicks that produced a zero-size shape.
    const degenerate =
      (d.kind === "arrow" && d.from.x === d.to.x && d.from.y === d.to.y) ||
      (d.kind === "rect" && d.a.x === d.b.x && d.a.y === d.b.y);
    if (!degenerate) this.commit(d);
    this.render();
  }

  private commit(a: Annotation): void {
    this.history.push(this.doc.annotations);
    this.doc.annotations = [...this.doc.annotations, a];
  }
}
