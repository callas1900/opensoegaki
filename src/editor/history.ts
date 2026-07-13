/**
 * Minimal snapshot-based undo/redo. Annotation arrays are small, so we store
 * full copies of the annotation list per step. Revisit if documents grow.
 */
import type { Annotation } from "./model";

export class History {
  private past: Annotation[][] = [];
  private future: Annotation[][] = [];

  /** Call BEFORE mutating the annotation list. */
  push(current: Annotation[]): void {
    this.past.push(structuredClone(current));
    this.future = [];
  }

  undo(current: Annotation[]): Annotation[] | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: Annotation[]): Annotation[] | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(structuredClone(current));
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
