import { describe, it, expect } from "vitest";
import {
  nextId,
  translateAnnotation,
  STROKE_PRESETS,
  FONT_PRESETS,
  DEFAULTS,
  PALETTE,
  type Annotation,
  type ArrowAnnotation,
  type RectAnnotation,
  type TextAnnotation,
} from "./model";

describe("nextId", () => {
  it("returns strings matching /^a[0-9a-z]+$/", () => {
    for (let i = 0; i < 20; i++) {
      expect(nextId()).toMatch(/^a[0-9a-z]+$/);
    }
  });

  it("returns N distinct values over a tight loop", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      ids.add(nextId());
    }
    expect(ids.size).toBe(200);
  });
});

describe("translateAnnotation", () => {
  const arrow: ArrowAnnotation = {
    id: "a1",
    kind: "arrow",
    color: "#e8465a",
    strokeWidth: 6,
    from: { x: 1, y: 2 },
    to: { x: 3, y: 4 },
  };

  const rect: RectAnnotation = {
    id: "a2",
    kind: "rect",
    color: "#2f7de1",
    strokeWidth: 3,
    a: { x: 5, y: 6 },
    b: { x: 7, y: 8 },
  };

  const text: TextAnnotation = {
    id: "a3",
    kind: "text",
    color: "#222222",
    strokeWidth: 6,
    at: { x: 9, y: 10 },
    text: "hello",
    fontSize: 28,
  };

  it("arrow: shifts from/to by (dx,dy); preserves color/strokeWidth/id", () => {
    const result = translateAnnotation(arrow, 10, -5) as ArrowAnnotation;
    expect(result.from).toEqual({ x: 11, y: -3 });
    expect(result.to).toEqual({ x: 13, y: -1 });
    expect(result.color).toBe(arrow.color);
    expect(result.strokeWidth).toBe(arrow.strokeWidth);
    expect(result.id).toBe(arrow.id);
  });

  it("rect: shifts a/b by (dx,dy); preserves other fields", () => {
    const result = translateAnnotation(rect, -2, 3) as RectAnnotation;
    expect(result.a).toEqual({ x: 3, y: 9 });
    expect(result.b).toEqual({ x: 5, y: 11 });
    expect(result.color).toBe(rect.color);
    expect(result.strokeWidth).toBe(rect.strokeWidth);
    expect(result.id).toBe(rect.id);
  });

  it("text: shifts at by (dx,dy); preserves text/fontSize", () => {
    const result = translateAnnotation(text, 1, 1) as TextAnnotation;
    expect(result.at).toEqual({ x: 10, y: 11 });
    expect(result.text).toBe(text.text);
    expect(result.fontSize).toBe(text.fontSize);
  });

  it("does not mutate the input annotation", () => {
    const cases: Annotation[] = [arrow, rect, text];
    for (const a of cases) {
      const before = structuredClone(a);
      translateAnnotation(a, 100, 100);
      expect(a).toEqual(before);
    }
  });
});

describe("presets and defaults", () => {
  it("STROKE_PRESETS.S < .M < .L", () => {
    expect(STROKE_PRESETS.S).toBeLessThan(STROKE_PRESETS.M);
    expect(STROKE_PRESETS.M).toBeLessThan(STROKE_PRESETS.L);
  });

  it("FONT_PRESETS.S < .M < .L", () => {
    expect(FONT_PRESETS.S).toBeLessThan(FONT_PRESETS.M);
    expect(FONT_PRESETS.M).toBeLessThan(FONT_PRESETS.L);
  });

  it("DEFAULTS.color is in PALETTE", () => {
    expect(PALETTE).toContain(DEFAULTS.color);
  });
});
