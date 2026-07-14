/**
 * Snapshot-based undo/redo over the whole document (background +
 * annotations). Annotation arrays are small, so we store full copies of the
 * annotation list per step. The background bitmap is stored by reference —
 * never structuredClone'd — since bitmaps are large and are never mutated in
 * place by the editor, so sharing the reference across steps is safe.
 */
import type { Annotation } from "./model";

export interface DocSnapshot {
  imageBitmap: ImageBitmap | null;
  annotations: Annotation[];
}

export class History {
  private past: DocSnapshot[] = [];
  private future: DocSnapshot[] = [];

  /** Call BEFORE mutating the document. */
  push(current: DocSnapshot): void {
    this.past.push(cloneSnapshot(current));
    this.future = [];
  }

  undo(current: DocSnapshot): DocSnapshot | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(cloneSnapshot(current));
    return prev;
  }

  redo(current: DocSnapshot): DocSnapshot | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(cloneSnapshot(current));
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

/** Copy the annotation list but keep the bitmap by reference. */
function cloneSnapshot(snapshot: DocSnapshot): DocSnapshot {
  return { imageBitmap: snapshot.imageBitmap, annotations: structuredClone(snapshot.annotations) };
}
