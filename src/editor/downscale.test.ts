import { describe, it, expect } from "vitest";
import { clampImportSize, MAX_IMPORT_DIMENSION } from "./downscale";

describe("clampImportSize", () => {
  describe("max: null (desktop, unlimited — round 6)", () => {
    it("returns dimensions unchanged for a small image", () => {
      expect(clampImportSize(1920, 1080, null)).toEqual({ width: 1920, height: 1080 });
    });

    it("returns dimensions unchanged even far beyond MAX_IMPORT_DIMENSION", () => {
      expect(clampImportSize(20000, 15000, null)).toEqual({ width: 20000, height: 15000 });
    });
  });

  describe("max: MAX_IMPORT_DIMENSION (web)", () => {
    it("returns dimensions unchanged when well within the limit", () => {
      expect(clampImportSize(1920, 1080, MAX_IMPORT_DIMENSION)).toEqual({ width: 1920, height: 1080 });
    });

    it("returns dimensions unchanged when exactly at the limit", () => {
      expect(clampImportSize(MAX_IMPORT_DIMENSION, 2000, MAX_IMPORT_DIMENSION)).toEqual({
        width: MAX_IMPORT_DIMENSION,
        height: 2000,
      });
    });

    it("downscales a landscape image so the longest side matches the limit", () => {
      expect(clampImportSize(8000, 4000, MAX_IMPORT_DIMENSION)).toEqual({ width: 4096, height: 2048 });
    });

    it("downscales a portrait image so the longest side matches the limit", () => {
      const result = clampImportSize(3000, 9000, MAX_IMPORT_DIMENSION);
      expect(result.height).toBe(MAX_IMPORT_DIMENSION);
      expect(result.width).toBe(1365); // 3000 * (4096 / 9000), rounded
    });

    it("downscales a square image", () => {
      expect(clampImportSize(5000, 5000, MAX_IMPORT_DIMENSION)).toEqual({
        width: MAX_IMPORT_DIMENSION,
        height: MAX_IMPORT_DIMENSION,
      });
    });

    it("preserves aspect ratio within rounding", () => {
      const result = clampImportSize(12000, 8000, MAX_IMPORT_DIMENSION);
      expect(result.width).toBe(MAX_IMPORT_DIMENSION);
      expect(result.width / result.height).toBeCloseTo(12000 / 8000, 1);
    });

    it("never upscales a smaller image", () => {
      expect(clampImportSize(100, 50, MAX_IMPORT_DIMENSION)).toEqual({ width: 100, height: 50 });
    });
  });

  describe("max: an arbitrary custom limit", () => {
    it("clamps to whatever limit is passed, not just MAX_IMPORT_DIMENSION", () => {
      expect(clampImportSize(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
    });
  });
});
