/**
 * Annotation object model — the single source of truth for everything drawn
 * on top of the captured image. Annotations stay editable objects until the
 * user exports; rasterization happens only in `exporter.ts`.
 */

export type Point = { x: number; y: number };

export type ToolKind = "arrow" | "rect" | "text" | "highlight" | "badge" | "magnifier";
export type Tool = ToolKind | "select" | "crop";

/** Annotation kinds, including "image" — which is inserted via insertImage(), not the toolbar tool loop. */
export type AnnotationKind = ToolKind | "image";

interface AnnotationBase {
  id: string;
  kind: AnnotationKind;
  color: string;
  strokeWidth: number;
  // Rotation in radians, clockwise (canvas y-down coordinates — feeds
  // ctx.rotate() directly), normalized to (-π, π]. Absent or 0 means
  // unrotated. The pivot is always the center of the annotation's unrotated
  // (local-frame) boundsOf box (src/editor/bounds.ts) — never per-kind, never
  // stored — computed on demand by rotate.ts's pivotOfAnnotation. Rotation is
  // render-time only: it is never baked into a shape's points (arrow's
  // from/to, rect's a/b, etc.) — the same "annotations are data, not pixels"
  // invariant every other transform in this model follows. Every kind
  // carries the field (not just the ones with a rotate-handle affordance, see
  // rotate.ts's canRotate) so a future multi-select group rotation can rotate
  // a mixed selection uniformly.
  angle?: number;
}

export interface ArrowAnnotation extends AnnotationBase {
  kind: "arrow";
  from: Point;
  to: Point;
}

export interface RectAnnotation extends AnnotationBase {
  kind: "rect";
  a: Point; // one corner
  b: Point; // opposite corner
}

export interface TextAnnotation extends AnnotationBase {
  kind: "text";
  at: Point;
  text: string;
  fontSize: number;
}

export interface HighlighterAnnotation extends AnnotationBase {
  kind: "highlight";
  points: Point[]; // >= 2 after commit; bitmap coords
}

export interface BadgeAnnotation extends AnnotationBase {
  kind: "badge";
  at: Point;       // circle center
  number: number;  // 1-based display value
  radius: number;  // baked from BADGE_RADIUS_PRESETS at creation
  // Manual (fixed-number) badges have a user-pinned `number` and are exempt
  // from auto-sequencing: nextBadgeNumber/renumberBadges skip them entirely.
  manual?: boolean;
}

export interface ImageAnnotation extends AnnotationBase {
  kind: "image";
  at: Point;      // top-left corner
  width: number;
  height: number;
  // color/strokeWidth are inherited but unused placeholders, filled from DEFAULTS at creation.
}

export interface MagnifierAnnotation extends AnnotationBase {
  kind: "magnifier";
  /** CENTER of the lens circle, in bitmap coords — same convention as
   *  BadgeAnnotation's `at` (a center, not a corner). */
  at: Point;
  /** Lens radius, bitmap px. */
  radius: number;
  /** Magnification factor (> 1). */
  zoom: number;
  /** CENTER of the source region, in bitmap coords. The source region is
   *  DERIVED: a circle of radius `radius / zoom` centered here. */
  from: Point;
}

export type Annotation =
  | ArrowAnnotation
  | RectAnnotation
  | TextAnnotation
  | HighlighterAnnotation
  | BadgeAnnotation
  | ImageAnnotation
  | MagnifierAnnotation;

/** Editor document: background bitmap + ordered annotation list. */
export interface Doc {
  imageBitmap: ImageBitmap | null;
  annotations: Annotation[];
  // Session-scoped cache of image-annotation bitmaps, keyed by annotation id.
  // Monotonic: entries are added on insertImage() and never pruned, so undo
  // followed by redo can always find the bitmap for a re-appearing
  // ImageAnnotation. Deliberately kept out of history snapshots (which
  // structuredClone the annotation list) — bitmaps are large and this map is
  // append-only, so there is nothing to snapshot per step.
  images: Map<string, ImageBitmap>;
}

export const PALETTE = ["#ED107B", "#FBB034", "#313187", "#00AFA5", "#00C0F3", "#434345", "#FFFFFF", "#000000"] as const;

export const DEFAULTS = {
  color: PALETTE[0] as string,
  strokeWidth: 6,
  fontSize: 28,
};

export type SizeName = "S" | "M" | "L";

export const STROKE_PRESETS: Record<SizeName, number> = { S: 3, M: 6, L: 12 };
export const FONT_PRESETS: Record<SizeName, number> = { S: 18, M: 28, L: 44 };

export const HIGHLIGHTER_WIDTH_SCALE = 3;
export const BADGE_RADIUS_PRESETS: Record<SizeName, number> = { S: 14, M: 20, L: 28 };

// Target lens DIAMETER as a fraction of the canvas's long side, keyed by the
// S/M/L size picker. Nudged down from the 25/33/45% a rectangular inset would
// use: a disc is visually dominant and must coexist with its own source
// region and connector on the same canvas. See deriveLensForSource (magnifier.ts).
export const MAGNIFIER_LENS_FRACTION_PRESETS: Record<SizeName, number> = { S: 0.22, M: 0.30, L: 0.40 };

// Adaptive annotation sizing (TASK-35.16, web-only): stroke/radius/font
// presets were tuned for a typical desktop capture's long side; on an
// imported photo many times larger (an iPhone's own 12 MP library shot),
// the same fixed pixel sizes read as hairline-thin. `computeAnnotationScale`
// mirrors the `maxImportDimension`/`decodeClampedBitmap` pattern exactly:
// `baseline: null` (desktop) is the identity no-op, a number (web) scales
// creation-time sizes up to keep roughly the same visual fraction of the
// image, capped so an extreme photo doesn't produce absurdly thick strokes.
// Round 8 tuning (real-iPhone feedback: web annotations still read too
// small — "current L should be about the new M"): baseline lowered from
// 1400 to 900 so a ~4000px iPhone photo scales by ~4.5x instead of ~2.9x,
// making the new M render like the old L. Cap raised from 4 to 6 as
// headroom that a `maxImportDimension`-clamped (4096px) import never
// actually reaches: 4096 / 900 ≈ 4.55.
export const ANNOTATION_SCALE_BASELINE = 900;
export const ANNOTATION_SCALE_MAX = 6;

/** Factor to multiply creation-time sizes by. `baseline === null` => 1 (desktop, unchanged). */
export function computeAnnotationScale(longestSide: number, baseline: number | null): number {
  if (baseline === null) return 1;
  return Math.min(ANNOTATION_SCALE_MAX, Math.max(1, longestSide / baseline));
}

let counter = 0;
export function nextId(): string {
  return `a${Date.now().toString(36)}${(counter++).toString(36)}`;
}

/**
 * Return a new annotation shifted by (dx, dy); never mutates the input.
 *
 * `part` only matters for "magnifier": "all" (the default, used by crop /
 * resize re-anchor / text re-anchor — all rigid moves) shifts both `from` and
 * `at`; "lens" shifts only `at`, i.e. dragging the lens body moves the lens
 * without changing what it magnifies. Every other kind ignores `part`.
 */
export function translateAnnotation(a: Annotation, dx: number, dy: number, part: "all" | "lens" = "all"): Annotation {
  switch (a.kind) {
    case "arrow":
      return {
        ...a,
        from: { x: a.from.x + dx, y: a.from.y + dy },
        to: { x: a.to.x + dx, y: a.to.y + dy },
      };
    case "rect":
      return {
        ...a,
        a: { x: a.a.x + dx, y: a.a.y + dy },
        b: { x: a.b.x + dx, y: a.b.y + dy },
      };
    case "text":
      return { ...a, at: { x: a.at.x + dx, y: a.at.y + dy } };
    case "highlight":
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case "badge":
      return { ...a, at: { x: a.at.x + dx, y: a.at.y + dy } };
    case "image":
      return { ...a, at: { x: a.at.x + dx, y: a.at.y + dy } };
    case "magnifier":
      if (part === "lens") return { ...a, at: { x: a.at.x + dx, y: a.at.y + dy } };
      return {
        ...a,
        from: { x: a.from.x + dx, y: a.from.y + dy },
        at: { x: a.at.x + dx, y: a.at.y + dy },
      };
  }
}

/**
 * 1-based number the next auto-sequenced badge should display: count of
 * existing auto badges (`!a.manual`) + 1. Manual (fixed-number) badges are
 * not counted — they don't participate in the sequence.
 */
export function nextBadgeNumber(list: Annotation[]): number {
  return list.filter((a) => a.kind === "badge" && !a.manual).length + 1;
}

/**
 * Return a new array where auto-sequenced badge annotations (`!a.manual`) are
 * reassigned `number` 1..N in array order; manual badges and non-badge
 * annotations pass through unchanged. Never mutates the input array or its
 * elements.
 */
export function renumberBadges(list: Annotation[]): Annotation[] {
  let n = 0;
  return list.map((a) => (a.kind === "badge" && !a.manual ? { ...a, number: ++n } : a));
}

/**
 * Pick the readable text color (black or white) for a given `#RRGGBB`
 * background, using the standard perceived-luminance formula.
 */
export function contrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const L = 0.299 * r + 0.587 * g + 0.114 * b;
  return L > 140 ? "#000000" : "#FFFFFF";
}
