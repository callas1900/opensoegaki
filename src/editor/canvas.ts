/**
 * Editor: owns the document, the <canvas>, pointer interaction and undo/redo.
 * Rendering of annotation shapes is delegated to render.ts (shared with export).
 */
import {
  type Annotation,
  type Doc,
  type Point,
  type SizeName,
  type Tool,
  DEFAULTS,
  FONT_PRESETS,
  PALETTE,
  STROKE_PRESETS,
  nextId,
  translateAnnotation,
} from "./model";
import { fontString, renderAnnotations } from "./render";
import { History, type DocSnapshot } from "./history";
import { boundsOf, hitTest } from "./hittest";

/** Selection hit-test tolerance in CSS px; scale-compensated to bitmap px at the call site. */
const BASE_TOL_PX = 6;

export class Editor {
  readonly doc: Doc = { imageBitmap: null, annotations: [] };
  tool: Tool = "arrow";
  color: string = DEFAULTS.color;
  strokeWidth: number = DEFAULTS.strokeWidth;
  fontSize: number = DEFAULTS.fontSize;
  selectedId: string | null = null;

  private readonly history = new History();
  private draft: Annotation | null = null;
  // Armed while a select-tool drag is in progress; `original` is the pre-drag
  // clone so each move frame recomputes the translation from a fixed base
  // (never incrementally), avoiding drift.
  private move: { original: Annotation; anchor: Point; moved: boolean } | null = null;
  private readonly ctx: CanvasRenderingContext2D;
  // Transient DOM overlay for the text tool; never part of doc, history, or renderAnnotations.
  private textEdit: {
    input: HTMLInputElement;
    at: Point;
    color: string;
    fontSize: number;
    reposition: () => void;
  } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas is not available");
    this.ctx = ctx;
    this.bindPointerEvents();
  }

  /** Load a captured PNG (raw bytes) as the new background. */
  async loadImage(png: Uint8Array): Promise<void> {
    const blob = new Blob([png as BlobPart], { type: "image/png" });
    this.setBackground(await createImageBitmap(blob));
  }

  /** Load an arbitrary image blob (e.g. from a clipboard paste) as the new background. */
  async loadImageBlob(blob: Blob): Promise<void> {
    this.setBackground(await createImageBitmap(blob));
  }

  /**
   * Shared tail of loadImage/loadImageBlob: replace the background and resize
   * the canvas. If a document is already loaded, the previous {background,
   * annotations} snapshot is pushed onto history first so the replacement is
   * undoable; on the very first load there is nothing to undo back to, so
   * history is cleared instead.
   */
  private setBackground(bitmap: ImageBitmap): void {
    // The pending text belongs to the old image; discard rather than commit onto the new one.
    this.cancelTextEditor();
    if (this.doc.imageBitmap !== null) {
      this.history.push(this.snapshot());
    } else {
      this.history.clear();
    }
    this.doc.imageBitmap = bitmap;
    this.doc.annotations = [];
    this.selectedId = null;
    this.move = null;
    this.canvas.width = bitmap.width;
    this.canvas.height = bitmap.height;
    this.render();
  }

  undo(): void {
    const prev = this.history.undo(this.snapshot());
    if (prev) this.restore(prev);
  }

  redo(): void {
    const next = this.history.redo(this.snapshot());
    if (next) this.restore(next);
  }

  // Returns a live reference to doc.annotations; safe only because every caller
  // that stores this snapshot routes it through History's cloneSnapshot first.
  private snapshot(): DocSnapshot {
    return { imageBitmap: this.doc.imageBitmap, annotations: this.doc.annotations };
  }

  /** Apply a restored snapshot, resizing the canvas to match its background before rendering. */
  private restore(snapshot: DocSnapshot): void {
    this.cancelTextEditor();
    this.doc.imageBitmap = snapshot.imageBitmap;
    this.doc.annotations = snapshot.annotations;
    // The restored array may not contain the previously selected id, and even
    // if it does by coincidence, the highlight would be misleading.
    this.selectedId = null;
    this.move = null;
    if (snapshot.imageBitmap) {
      this.canvas.width = snapshot.imageBitmap.width;
      this.canvas.height = snapshot.imageBitmap.height;
    }
    this.render();
  }

  render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.doc.imageBitmap) ctx.drawImage(this.doc.imageBitmap, 0, 0);
    renderAnnotations(ctx, this.doc.annotations);
    if (this.draft) renderAnnotations(ctx, [this.draft]);
    // Selection chrome is drawn last, directly on the live canvas context only —
    // never through renderAnnotations, so it can never reach exportPng().
    const selected = this.selectedAnnotation();
    if (selected) this.drawSelectionOverlay(selected);
  }

  hasImage(): boolean {
    return this.doc.imageBitmap !== null;
  }

  /** Switch the active tool, clearing any selection and updating cursor feedback. */
  setTool(t: Tool): void {
    this.tool = t;
    this.clearSelection();
    this.canvas.style.cursor = t === "select" ? "default" : "crosshair";
  }

  clearSelection(): void {
    this.selectedId = null;
    this.move = null;
    this.render();
  }

  /** Set the stroke width / font size used by newly drawn annotations. */
  setSize(name: SizeName): void {
    this.strokeWidth = STROKE_PRESETS[name];
    this.fontSize = FONT_PRESETS[name];
  }

  /** Export sinks call this to materialize any in-flight inline text before reading `doc`. */
  commitPendingText(): void {
    this.commitTextEditor();
  }

  deleteSelected(): void {
    if (this.selectedId === null) return;
    this.history.push(this.snapshot());
    this.doc.annotations = this.doc.annotations.filter((a) => a.id !== this.selectedId);
    this.selectedId = null;
    this.render();
  }

  private selectedAnnotation(): Annotation | undefined {
    return this.selectedId === null
      ? undefined
      : this.doc.annotations.find((a) => a.id === this.selectedId);
  }

  /** Dashed marquee around the selected annotation's bounds. Not exported (see render()). */
  private drawSelectionOverlay(a: Annotation): void {
    const { ctx } = this;
    const b = boundsOf(a, ctx);
    const pad = 6;
    const x = b.x - pad;
    const y = b.y - pad;
    const w = b.w + pad * 2;
    const h = b.h + pad * 2;

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE[0];
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
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

  /** Hit-test tolerance in bitmap px, compensating for CSS scaling of the canvas. */
  private tolerance(): number {
    const rect = this.canvas.getBoundingClientRect();
    const scale = this.canvas.width / rect.width;
    return BASE_TOL_PX * scale;
  }

  private onDown(p: Point, e: PointerEvent): void {
    if (!this.hasImage()) return;
    const tool = this.tool;

    if (tool === "text") {
      // No pointer capture: text editing hands input focus to the DOM overlay.
      // preventDefault() is load-bearing: canceling pointerdown suppresses the
      // compatibility mousedown's default action, which would otherwise move
      // focus to the (non-focusable) canvas -> body right after we focus the
      // input, firing blur -> commitTextEditor() -> the editor self-destructs
      // with an empty value before the user can type anything.
      e.preventDefault();
      this.openTextEditor(p);
      return;
    }

    this.canvas.setPointerCapture(e.pointerId);

    if (tool === "select") {
      const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance());
      if (hit) {
        this.selectedId = hit.id;
        // Do not push history yet: a pure click that never moves is not undoable.
        this.move = { original: structuredClone(hit), anchor: p, moved: false };
      } else {
        this.selectedId = null;
        this.move = null;
      }
      this.render();
      return;
    }

    const base = { id: nextId(), color: this.color, strokeWidth: this.strokeWidth };
    if (tool === "arrow") {
      this.draft = { ...base, kind: "arrow", from: p, to: p };
    } else if (tool === "rect") {
      this.draft = { ...base, kind: "rect", a: p, b: p };
    }
    this.render();
  }

  private onMove(p: Point): void {
    const tool = this.tool;

    if (this.move) {
      const dx = p.x - this.move.anchor.x;
      const dy = p.y - this.move.anchor.y;
      if (!this.move.moved && (dx !== 0 || dy !== 0)) {
        // Push before mutate: capture the pre-move array on the first real frame.
        this.move.moved = true;
        this.history.push(this.snapshot());
      }
      if (this.move.moved) {
        const original = this.move.original;
        this.doc.annotations = this.doc.annotations.map((a) =>
          a.id === this.selectedId ? translateAnnotation(original, dx, dy) : a,
        );
      }
      this.canvas.style.cursor = "grabbing";
      this.render();
      return;
    }

    if (this.draft) {
      if (this.draft.kind === "arrow") this.draft.to = p;
      else if (this.draft.kind === "rect") this.draft.b = p;
      this.render();
      return;
    }

    if (tool === "select") {
      const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance());
      this.canvas.style.cursor = hit ? "move" : "default";
    }
  }

  private onUp(): void {
    if (this.move) {
      this.move = null;
      // The pointer hasn't necessarily moved since the last hover check, so
      // fall back to the tool's resting cursor rather than leaving "grabbing".
      this.canvas.style.cursor = this.tool === "select" ? "default" : "crosshair";
      return;
    }

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
    this.history.push(this.snapshot());
    this.doc.annotations = [...this.doc.annotations, a];
  }

  // ---- inline text editing --------------------------------------------------
  // A single DOM <input> overlay is the live preview for the text tool. It is
  // transient DOM only: never part of doc, never in history, never rendered
  // through renderAnnotations (so it can never be rasterized into an export).

  private openTextEditor(at: Point): void {
    this.commitTextEditor(); // idempotent: commit any already-open editor first

    const input = document.createElement("input");
    input.className = "text-editor";
    const color = this.color;
    const fontSize = this.fontSize;
    const reposition = () => this.positionTextEditor();
    this.textEdit = { input, at, color, fontSize, reposition };

    this.positionTextEditor();
    input.style.color = color;
    this.canvas.parentElement!.appendChild(input);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.commitTextEditor();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancelTextEditor();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        // Defensive: prevent WebView2's native save-page accelerator from
        // firing mid-edit. Ctrl+S stays inert while the text editor is open.
        e.preventDefault();
      }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => this.commitTextEditor());
    window.addEventListener("resize", reposition);
    input.focus();
  }

  /** Recompute the input's CSS-px position/font from the stored bitmap-px `at`. */
  private positionTextEditor(): void {
    if (!this.textEdit) return;
    const { input, at, fontSize } = this.textEdit;
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageRect = this.canvas.parentElement!.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;

    input.style.left = `${canvasRect.left - stageRect.left + at.x * scale}px`;
    input.style.top = `${canvasRect.top - stageRect.top + at.y * scale}px`;
    input.style.font = fontString(fontSize * scale);
  }

  private commitTextEditor(): void {
    if (!this.textEdit) return;
    const { input, at, color, fontSize, reposition } = this.textEdit;
    const text = input.value;
    this.textEdit = null;
    input.remove();
    window.removeEventListener("resize", reposition);
    if (text.trim() !== "") {
      this.commit({ id: nextId(), color, strokeWidth: this.strokeWidth, kind: "text", at, text, fontSize });
    }
    this.render();
  }

  private cancelTextEditor(): void {
    if (!this.textEdit) return;
    const { input, reposition } = this.textEdit;
    this.textEdit = null;
    input.remove();
    window.removeEventListener("resize", reposition);
    this.render();
  }
}
