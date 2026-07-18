import { describe, it, expect } from "vitest";
import {
  nextId,
  translateAnnotation,
  nextBadgeNumber,
  renumberBadges,
  contrastText,
  STROKE_PRESETS,
  FONT_PRESETS,
  DEFAULTS,
  PALETTE,
  type Annotation,
  type ArrowAnnotation,
  type RectAnnotation,
  type TextAnnotation,
  type HighlighterAnnotation,
  type BadgeAnnotation,
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

  const highlight: HighlighterAnnotation = {
    id: "a4",
    kind: "highlight",
    color: "#FBB034",
    strokeWidth: 6,
    points: [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 9, y: 3 }],
  };

  const badge: BadgeAnnotation = {
    id: "a5",
    kind: "badge",
    color: "#ED107B",
    strokeWidth: 6,
    at: { x: 20, y: 30 },
    number: 3,
    radius: 20,
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

  it("highlight: shifts every point by (dx,dy); preserves length/id/color/strokeWidth", () => {
    const result = translateAnnotation(highlight, 2, -1) as HighlighterAnnotation;
    expect(result.points).toEqual([{ x: 3, y: 0 }, { x: 7, y: 0 }, { x: 11, y: 2 }]);
    expect(result.points.length).toBe(highlight.points.length);
    expect(result.id).toBe(highlight.id);
    expect(result.color).toBe(highlight.color);
    expect(result.strokeWidth).toBe(highlight.strokeWidth);
  });

  it("badge: shifts at by (dx,dy); preserves number/radius", () => {
    const result = translateAnnotation(badge, 5, 5) as BadgeAnnotation;
    expect(result.at).toEqual({ x: 25, y: 35 });
    expect(result.number).toBe(badge.number);
    expect(result.radius).toBe(badge.radius);
  });

  it("does not mutate the input annotation", () => {
    const cases: Annotation[] = [arrow, rect, text, highlight, badge];
    for (const a of cases) {
      const before = structuredClone(a);
      translateAnnotation(a, 100, 100);
      expect(a).toEqual(before);
    }
  });
});

describe("nextBadgeNumber", () => {
  it("empty list -> 1", () => {
    expect(nextBadgeNumber([])).toBe(1);
  });

  it("list with 2 badges + an arrow -> 3", () => {
    const b1: BadgeAnnotation = { id: "b1", kind: "badge", color: "#ED107B", strokeWidth: 6, at: { x: 0, y: 0 }, number: 1, radius: 20 };
    const b2: BadgeAnnotation = { id: "b2", kind: "badge", color: "#ED107B", strokeWidth: 6, at: { x: 0, y: 0 }, number: 2, radius: 20 };
    const a1: ArrowAnnotation = { id: "a1", kind: "arrow", color: "#e8465a", strokeWidth: 6, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    expect(nextBadgeNumber([b1, a1, b2])).toBe(3);
  });
});

describe("renumberBadges", () => {
  function makeBadge(id: string, number: number): BadgeAnnotation {
    return { id, kind: "badge", color: "#ED107B", strokeWidth: 6, at: { x: 0, y: 0 }, number, radius: 20 };
  }
  const arrowFixture: ArrowAnnotation = { id: "arrow1", kind: "arrow", color: "#e8465a", strokeWidth: 6, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };

  it("three badges numbered 5,9,2 -> 1,2,3 in array order; non-badges untouched", () => {
    const list: Annotation[] = [makeBadge("b1", 5), arrowFixture, makeBadge("b2", 9), makeBadge("b3", 2)];
    const result = renumberBadges(list);
    expect((result[0] as BadgeAnnotation).number).toBe(1);
    expect(result[1]).toBe(arrowFixture);
    expect((result[2] as BadgeAnnotation).number).toBe(2);
    expect((result[3] as BadgeAnnotation).number).toBe(3);
  });

  it("does not mutate the input array", () => {
    const list: Annotation[] = [makeBadge("b1", 5), makeBadge("b2", 9)];
    const before = structuredClone(list);
    renumberBadges(list);
    expect(list).toEqual(before);
  });

  it("after removing the middle badge of 1,2,3, remaining renumber to 1,2", () => {
    const list: Annotation[] = [makeBadge("b1", 1), makeBadge("b2", 2), makeBadge("b3", 3)];
    const withoutMiddle = list.filter((a) => a.id !== "b2");
    const result = renumberBadges(withoutMiddle);
    expect((result[0] as BadgeAnnotation).number).toBe(1);
    expect((result[1] as BadgeAnnotation).number).toBe(2);
  });
});

describe("contrastText", () => {
  it("#FBB034 -> #000000", () => {
    expect(contrastText("#FBB034")).toBe("#000000");
  });

  it("#FFFFFF -> #000000", () => {
    expect(contrastText("#FFFFFF")).toBe("#000000");
  });

  it("#000000 -> #FFFFFF", () => {
    expect(contrastText("#000000")).toBe("#FFFFFF");
  });

  it("#313187 -> #FFFFFF", () => {
    expect(contrastText("#313187")).toBe("#FFFFFF");
  });

  it("#ED107B -> #FFFFFF", () => {
    expect(contrastText("#ED107B")).toBe("#FFFFFF");
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
