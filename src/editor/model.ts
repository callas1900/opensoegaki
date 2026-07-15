/**
 * Annotation object model — the single source of truth for everything drawn
 * on top of the captured image. Annotations stay editable objects until the
 * user exports; rasterization happens only in `exporter.ts`.
 */

export type Point = { x: number; y: number };

export type ToolKind = "arrow" | "rect" | "text";
export type Tool = ToolKind | "select" | "crop";

interface AnnotationBase {
  id: string;
  kind: ToolKind;
  color: string;
  strokeWidth: number;
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

export type Annotation = ArrowAnnotation | RectAnnotation | TextAnnotation;

/** Editor document: background bitmap + ordered annotation list. */
export interface Doc {
  imageBitmap: ImageBitmap | null;
  annotations: Annotation[];
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

let counter = 0;
export function nextId(): string {
  return `a${Date.now().toString(36)}${(counter++).toString(36)}`;
}

/** Return a new annotation shifted by (dx, dy); never mutates the input. */
export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation {
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
  }
}
