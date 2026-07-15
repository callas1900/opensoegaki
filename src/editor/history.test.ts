import { describe, it, expect } from "vitest";
import { History, type DocSnapshot } from "./history";
import type { ArrowAnnotation } from "./model";

// Plain sentinel object standing in for an ImageBitmap; tests only need
// reference identity, never real bitmap behavior.
function bitmapSentinel(): ImageBitmap {
  return {} as unknown as ImageBitmap;
}

function arrow(x: number): ArrowAnnotation {
  return {
    id: `a${x}`,
    kind: "arrow",
    color: "#e8465a",
    strokeWidth: 6,
    from: { x, y: x },
    to: { x: x + 1, y: x + 1 },
  };
}

describe("History", () => {
  it("undo on empty history returns null", () => {
    const h = new History();
    expect(h.undo({ imageBitmap: null, annotations: [] })).toBeNull();
  });

  it("redo on empty history returns null", () => {
    const h = new History();
    expect(h.redo({ imageBitmap: null, annotations: [] })).toBeNull();
  });

  it("push(A) then undo(B) returns a snapshot deep-equal to A", () => {
    const h = new History();
    const a: DocSnapshot = { imageBitmap: null, annotations: [arrow(1)] };
    const b: DocSnapshot = { imageBitmap: null, annotations: [arrow(2)] };
    h.push(a);
    const result = h.undo(b);
    expect(result).toEqual(a);
  });

  it("snapshot isolation: mutating A after push does not affect a later undo", () => {
    const h = new History();
    const a: DocSnapshot = { imageBitmap: null, annotations: [arrow(1)] };
    h.push(a);
    // Mutate a nested point in A's annotations after pushing.
    (a.annotations[0] as ArrowAnnotation).from.x = 999;

    const b: DocSnapshot = { imageBitmap: null, annotations: [arrow(2)] };
    const result = h.undo(b);
    expect((result!.annotations[0] as ArrowAnnotation).from.x).toBe(1);
  });

  it("redo after undo returns the doc that was current at the undo call", () => {
    const h = new History();
    const a: DocSnapshot = { imageBitmap: null, annotations: [arrow(1)] };
    const b: DocSnapshot = { imageBitmap: null, annotations: [arrow(2)] };
    h.push(a);
    h.undo(b);
    const result = h.redo(a);
    expect(result).toEqual(b);
  });

  it("push clears the redo stack", () => {
    const h = new History();
    const a: DocSnapshot = { imageBitmap: null, annotations: [arrow(1)] };
    const b: DocSnapshot = { imageBitmap: null, annotations: [arrow(2)] };
    const c: DocSnapshot = { imageBitmap: null, annotations: [arrow(3)] };
    h.push(a);
    h.undo(b);
    h.push(c);
    expect(h.redo(c)).toBeNull();
  });

  it("background-replacement undo: bitmap is restored by identity, never cloned", () => {
    const h = new History();
    const b1 = bitmapSentinel();
    const b2 = bitmapSentinel();
    const before: DocSnapshot = { imageBitmap: b1, annotations: [arrow(1)] };
    h.push(before);
    const after: DocSnapshot = { imageBitmap: b2, annotations: [arrow(2)] };

    const result = h.undo(after);
    expect(result!.imageBitmap).toBe(b1);
    expect(result!.annotations).toEqual(before.annotations);
  });
});
