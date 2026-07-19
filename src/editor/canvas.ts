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
  BADGE_RADIUS_PRESETS,
  DEFAULTS,
  FONT_PRESETS,
  PALETTE,
  STROKE_PRESETS,
  nextBadgeNumber,
  nextId,
  renumberBadges,
  translateAnnotation,
} from "./model";
import { fontString, renderAnnotations } from "./render";
import { History, type DocSnapshot } from "./history";
import { boundsOf, hitTest } from "./hittest";
import { computeCrop, fullImageRect, handleAt, applyHandleDrag, MIN_CROP_PX, type CropRect, type CropHandle } from "./crop";

/** Selection hit-test tolerance in CSS px; scale-compensated to bitmap px at the call site. */
const BASE_TOL_PX = 6;
/** Crop corner handle draw size and grab radius, in CSS px; scale-compensated at the call site. */
const HANDLE_DRAW_PX = 10;
const HANDLE_HIT_PX = 12;
/** Gap kept between the crop corner handle and the floating ✓/✗ controls, in CSS px. */
const HANDLE_MARGIN_PX = HANDLE_DRAW_PX / 2 + 8;
/** Minimum distance (in bitmap px) between consecutive freehand highlighter points, to keep the point list light. */
const HIGHLIGHTER_MIN_POINT_DIST_PX = 2;

export class Editor {
  // doc.images is a monotonic session cache (see model.ts's Doc.images doc
  // comment); it is never cleared by setBackground/restore, only appended to
  // by insertImage.
  readonly doc: Doc = { imageBitmap: null, annotations: [], images: new Map() };
  tool: Tool = "arrow";
  color: string = DEFAULTS.color;
  strokeWidth: number = DEFAULTS.strokeWidth;
  fontSize: number = DEFAULTS.fontSize;
  size: SizeName = "M";
  selectedId: string | null = null;

  private readonly history = new History();
  private draft: Annotation | null = null;
  // Armed while a select-tool drag is in progress; `original` is the pre-drag
  // clone so each move frame recomputes the translation from a fixed base
  // (never incrementally), avoiding drift.
  private move: { original: Annotation; anchor: Point; moved: boolean } | null = null;
  // Crop tool state: the current region (starts as the full image), the
  // corner handle actively being dragged (if any), and the owned floating
  // ✓/✗ controls overlay + its resize-reposition handler. Never part of doc,
  // history, or renderAnnotations.
  private crop: {
    rect: CropRect;
    drag: CropHandle | null;
    controls: HTMLDivElement;
    reposition: () => void;
  } | null = null;
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
   * Insert `bitmap` as a new image annotation, scaled to fit within 90% of
   * the canvas (never upscaled) and centered. No-op if there is no
   * background image loaded yet. The bitmap is cached in `doc.images` keyed
   * by the new annotation's id, then committed through the normal
   * history-push+append path so the insertion is undoable.
   */
  insertImage(bitmap: ImageBitmap): void {
    if (!this.hasImage()) return;
    const canvasW = this.doc.imageBitmap!.width;
    const canvasH = this.doc.imageBitmap!.height;
    const scale = Math.min(1, (0.9 * canvasW) / bitmap.width, (0.9 * canvasH) / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    const at: Point = { x: (canvasW - width) / 2, y: (canvasH - height) / 2 };

    const id = nextId();
    this.doc.images.set(id, bitmap);
    this.commit({
      id,
      kind: "image",
      color: DEFAULTS.color,
      strokeWidth: DEFAULTS.strokeWidth,
      at,
      width,
      height,
    });
    this.render();
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
    // doc.images is intentionally NOT cleared here: it's a monotonic session
    // cache keyed by annotation id (see model.ts), so undo/redo across a
    // background replacement can still find bitmaps for image annotations
    // that predate it.
    if (this.doc.imageBitmap !== null) {
      this.history.push(this.snapshot());
    } else {
      this.history.clear();
    }
    this.doc.imageBitmap = bitmap;
    this.doc.annotations = [];
    this.selectedId = null;
    this.move = null;
    this.teardownCrop();
    this.canvas.width = bitmap.width;
    this.canvas.height = bitmap.height;
    // If the crop tool is active (including when it was selected before any
    // image existed, leaving initCrop() a no-op at the time), the new image
    // now has a bitmap to crop: re-initialize a fresh full-image region
    // instead of leaving a dead toolbar state. initCrop() renders internally,
    // so only one of these two paths renders.
    if (this.tool === "crop") this.initCrop();
    else this.render();
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
    // doc.images is not touched here either — same monotonic-cache rationale
    // as setBackground(): a redo that brings back an ImageAnnotation must
    // still find its bitmap.
    // The restored array may not contain the previously selected id, and even
    // if it does by coincidence, the highlight would be misleading.
    this.selectedId = null;
    this.move = null;
    this.teardownCrop();
    if (snapshot.imageBitmap) {
      this.canvas.width = snapshot.imageBitmap.width;
      this.canvas.height = snapshot.imageBitmap.height;
    }
    // Mirrors setBackground: if the crop tool is active, re-initialize a
    // fresh full-image region on the restored image instead of leaving a
    // dead crop-tool state after undo/redo. initCrop() renders internally
    // (and no-ops if the restored snapshot has no image, via hasImage()), so
    // only one of these two paths renders.
    if (this.tool === "crop") this.initCrop();
    else this.render();
  }

  render(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.doc.imageBitmap) ctx.drawImage(this.doc.imageBitmap, 0, 0);
    renderAnnotations(ctx, this.doc.annotations, this.doc.images);
    if (this.draft) renderAnnotations(ctx, [this.draft], this.doc.images);
    // Selection chrome is drawn last, directly on the live canvas context only —
    // never through renderAnnotations, so it can never reach exportPng().
    const selected = this.selectedAnnotation();
    if (selected) this.drawSelectionOverlay(selected);
    this.drawCropOverlay();
  }

  hasImage(): boolean {
    return this.doc.imageBitmap !== null;
  }

  /** Switch the active tool, clearing any selection and updating cursor feedback. */
  setTool(t: Tool): void {
    this.tool = t;
    // Activating the crop tool (re)initializes a fresh full-image region with
    // handles; every other tool tears it down. Do this before clearSelection()'s
    // render so that render reflects the final state.
    if (t === "crop") this.initCrop();
    else this.teardownCrop();
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
    this.size = name;
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
    this.doc.annotations = renumberBadges(this.doc.annotations);
    this.selectedId = null;
    this.render();
  }

  /** True while the crop tool has an active region awaiting Enter/✓ (apply) or Esc/✗ (cancel). */
  hasPendingCrop(): boolean {
    return this.crop !== null;
  }

  /**
   * Initialize crop state: the region starts as the full loaded image with
   * corner handles, plus a floating ✓/✗ controls overlay (owned like
   * `textEdit.input`). No-op if there is no image or crop is already active.
   */
  private initCrop(): void {
    if (!this.hasImage() || this.crop) return;
    const bitmap = this.doc.imageBitmap!;

    const controls = document.createElement("div");
    controls.className = "crop-controls";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "crop-apply";
    apply.title = "Apply crop (Enter)";
    apply.textContent = "✓";
    apply.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.applyCrop();
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "crop-cancel";
    cancel.title = "Cancel crop (Esc)";
    cancel.textContent = "✗";
    cancel.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cancelCrop();
    });
    controls.appendChild(apply);
    controls.appendChild(cancel);
    this.canvas.parentElement!.appendChild(controls);

    const reposition = () => this.positionCropControls();
    window.addEventListener("resize", reposition);

    this.crop = { rect: fullImageRect(bitmap.width, bitmap.height), drag: null, controls, reposition };
    this.render();
  }

  /** Tear down crop state and its DOM overlay. Does not render (callers render). */
  private teardownCrop(): void {
    if (!this.crop) return;
    this.crop.controls.remove();
    window.removeEventListener("resize", this.crop.reposition);
    this.crop = null;
  }

  /**
   * Reset the crop region to the full image without touching the document.
   * Crop mode stays fully active (region, handles and ✓/✗ controls remain
   * visible) — this is a reset, not a teardown. Returns false if there was
   * no active crop.
   */
  cancelCrop(): boolean {
    if (!this.crop) return false;
    const bitmap = this.doc.imageBitmap!;
    this.crop.rect = fullImageRect(bitmap.width, bitmap.height);
    this.crop.drag = null;
    this.render();
    return true;
  }

  /**
   * Apply the pending crop: re-rasterize the background to the rectangle and
   * translate every annotation by the crop origin, as a single undoable step
   * (the same `{ imageBitmap, annotations }` snapshot mechanism as background
   * replacement). No-op (resets the region to full-image, pushes no history)
   * if the region is degenerate or already equals the untouched full image.
   */
  async applyCrop(): Promise<void> {
    if (!this.crop || !this.hasImage()) return;
    const src = this.doc.imageBitmap!;
    const r = this.crop.rect;
    const rect = computeCrop({ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, src.width, src.height, MIN_CROP_PX);
    if (!rect) {
      // Region is already full-image or below the minimum size: nothing to
      // apply. Crop mode stays active; just clear any in-flight drag.
      this.crop.drag = null;
      this.render();
      return;
    }
    const cropped = await createImageBitmap(src, rect.x, rect.y, rect.w, rect.h);
    // The document may have changed (new paste/capture, undo/redo) while awaiting.
    // Note: setBackground/restore may have already torn down and, if the crop
    // tool was still active, re-initialized `this.crop` for the *new* image
    // during this await — this stale abort path never touches `this.crop`, so
    // it is safe to just discard the outdated bitmap and return regardless.
    if (this.doc.imageBitmap !== src) {
      cropped.close();
      return;
    }
    this.history.push(this.snapshot());
    this.doc.imageBitmap = cropped;
    this.doc.annotations = this.doc.annotations.map((a) => translateAnnotation(a, -rect.x, -rect.y));
    this.canvas.width = rect.w;
    this.canvas.height = rect.h;
    this.selectedId = null;
    this.move = null;
    // Crop mode stays active on the newly-cropped image: re-arm the region to
    // the new full image so the user can immediately crop again. Guarded:
    // switching tools during the await tears crop down without changing the
    // bitmap, so the apply still lands but there is no region to re-arm.
    if (this.crop) {
      this.crop.rect = fullImageRect(rect.w, rect.h);
      this.crop.drag = null;
    }
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

  /**
   * Dimmed exterior + dashed border + corner handles for the active crop
   * region. Not exported (see render()). Also repositions the floating
   * ✓/✗ controls so they track the rect every frame.
   */
  private drawCropOverlay(): void {
    if (!this.crop) return;
    const { ctx, canvas } = this;
    const { x, y, w, h } = this.crop.rect;

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, canvas.width, y); // top
    ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h)); // bottom
    ctx.fillRect(0, y, x, h); // left
    ctx.fillRect(x + w, y, canvas.width - (x + w), h); // right

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PALETTE[0];
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    const side = HANDLE_DRAW_PX * this.cropScale();
    const half = side / 2;
    const corners: Point[] = [
      { x, y },
      { x: x + w, y },
      { x, y: y + h },
      { x: x + w, y: y + h },
    ];
    ctx.lineWidth = 1.5;
    for (const c of corners) {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(c.x - half, c.y - half, side, side);
      ctx.strokeStyle = PALETTE[0];
      ctx.strokeRect(c.x - half, c.y - half, side, side);
    }

    this.positionCropControls();
  }

  /**
   * Position the floating ✓/✗ controls in stage-local CSS px, near the crop
   * rect's bottom-right corner, using the same bitmap-px -> CSS-px mapping as
   * `positionTextEditor`. The default placement is outside the region,
   * offset down-right of the SE handle by `HANDLE_MARGIN_PX` so the group
   * never sits on top of (and steals clicks from) the handle. When that
   * placement would be clamped back onto the handle — the crop rect touching
   * the stage's bottom/right edge — the group instead goes inside the
   * region, offset up-left of the SE handle by the same margin, keeping the
   * handle clear from the other side. A final clamp keeps the group fully
   * inside the stage viewport regardless of which placement was chosen.
   */
  private positionCropControls(): void {
    if (!this.crop) return;
    const { controls, rect } = this.crop;
    const canvasRect = this.canvas.getBoundingClientRect();
    const stageEl = this.canvas.parentElement!;
    const stageRect = stageEl.getBoundingClientRect();
    const scale = canvasRect.width / this.canvas.width;
    const originX = canvasRect.left - stageRect.left;
    const originY = canvasRect.top - stageRect.top;

    const seX = originX + (rect.x + rect.w) * scale;
    const seY = originY + (rect.y + rect.h) * scale;

    const cw = controls.offsetWidth || 72;
    const ch = controls.offsetHeight || 32;

    let left = seX + HANDLE_MARGIN_PX;
    let top = seY + HANDLE_MARGIN_PX;

    const clampedLeft = Math.min(Math.max(left, 0), stageRect.width - cw);
    const clampedTop = Math.min(Math.max(top, 0), stageRect.height - ch);
    if (clampedLeft !== left || clampedTop !== top) {
      // Outward placement got clamped back onto the handle: flip to inside
      // the region, offset up-left of the SE corner by the same margin.
      left = seX - HANDLE_MARGIN_PX - cw;
      top = seY - HANDLE_MARGIN_PX - ch;
    }

    // Final clamp so the control group stays fully inside the stage viewport
    // regardless of which placement branch ran above.
    left = Math.min(Math.max(left, 0), stageRect.width - cw);
    top = Math.min(Math.max(top, 0), stageRect.height - ch);

    controls.style.left = `${left}px`;
    controls.style.top = `${top}px`;
  }

  // ---- pointer interaction -------------------------------------------------

  private bindPointerEvents(): void {
    this.canvas.addEventListener("pointerdown", (e) => this.onDown(this.toCanvas(e), e));
    this.canvas.addEventListener("pointermove", (e) => this.onMove(this.toCanvas(e), e.shiftKey));
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

  /** Bitmap-px-per-CSS-px scale factor for the (possibly CSS-scaled) canvas. */
  private cropScale(): number {
    const rect = this.canvas.getBoundingClientRect();
    return this.canvas.width / rect.width;
  }

  /** Crop corner handle grab radius in bitmap px, compensating for CSS scaling. */
  private handleHitRadius(): number {
    return HANDLE_HIT_PX * this.cropScale();
  }

  /** Resize cursor for a given corner handle. */
  private cursorForHandle(h: CropHandle): string {
    return h === "nw" || h === "se" ? "nwse-resize" : "nesw-resize";
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

    if (tool === "crop") {
      // Manages its own pointer capture: only a handle grab takes capture.
      // A press elsewhere in the region (or if crop state is somehow absent)
      // is inert — no capture, no draft.
      if (!this.crop) return;
      const h = handleAt(p, this.crop.rect, this.handleHitRadius());
      if (h) {
        this.canvas.setPointerCapture(e.pointerId);
        this.crop.drag = h;
        this.canvas.style.cursor = this.cursorForHandle(h);
        this.render();
      }
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

    if (tool === "badge") {
      this.commit({
        ...base,
        kind: "badge",
        at: p,
        number: nextBadgeNumber(this.doc.annotations),
        radius: BADGE_RADIUS_PRESETS[this.size],
      });
      this.render();
      return;
    }

    if (tool === "arrow") {
      this.draft = { ...base, kind: "arrow", from: p, to: p };
    } else if (tool === "rect") {
      this.draft = { ...base, kind: "rect", a: p, b: p };
    } else if (tool === "highlight") {
      this.draft = { ...base, kind: "highlight", points: [p] };
    }
    this.render();
  }

  private onMove(p: Point, shiftKey = false): void {
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

    if (this.crop?.drag) {
      const bitmap = this.doc.imageBitmap!;
      this.crop.rect = applyHandleDrag(this.crop.rect, this.crop.drag, p, bitmap.width, bitmap.height, MIN_CROP_PX);
      this.render();
      return;
    }

    if (this.draft) {
      if (this.draft.kind === "arrow") this.draft.to = p;
      else if (this.draft.kind === "rect") this.draft.b = p;
      else if (this.draft.kind === "highlight") {
        if (shiftKey) {
          // Straight-line mode: y locked to the stroke's starting point (horizontal marking).
          const first = this.draft.points[0];
          this.draft.points = [first, { x: p.x, y: first.y }];
        } else {
          const last = this.draft.points[this.draft.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= HIGHLIGHTER_MIN_POINT_DIST_PX) {
            this.draft.points.push(p);
          }
        }
      }
      this.render();
      return;
    }

    if (tool === "select") {
      const hit = hitTest(this.doc.annotations, p, this.ctx, this.tolerance());
      this.canvas.style.cursor = hit ? "move" : "default";
    } else if (tool === "crop" && this.crop) {
      const h = handleAt(p, this.crop.rect, this.handleHitRadius());
      this.canvas.style.cursor = h ? this.cursorForHandle(h) : "default";
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

    if (this.crop?.drag) {
      // Handle release commits nothing to history; the crop only becomes
      // undoable state on applyCrop().
      this.crop.drag = null;
      this.canvas.style.cursor = "crosshair";
      this.render();
      return;
    }

    if (!this.draft) return;
    const d = this.draft;
    this.draft = null;
    // Ignore accidental clicks that produced a zero-size shape.
    const degenerate =
      (d.kind === "arrow" && d.from.x === d.to.x && d.from.y === d.to.y) ||
      (d.kind === "rect" && d.a.x === d.b.x && d.a.y === d.b.y) ||
      (d.kind === "highlight" && (d.points.length < 2 || d.points.every((pt) => pt.x === d.points[0].x && pt.y === d.points[0].y)));
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
