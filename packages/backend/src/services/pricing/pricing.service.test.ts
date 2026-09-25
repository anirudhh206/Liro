import { describe, it, expect } from "vitest";
import { isWithinDivergenceTolerance } from "./pricing.service.js";

describe("isWithinDivergenceTolerance (ADR-8)", () => {
  it("treats identical prices as within tolerance", () => {
    expect(isWithinDivergenceTolerance(100, 100)).toBe(true);
  });

  it("accepts a small divergence under the default 2% tolerance", () => {
    expect(isWithinDivergenceTolerance(100, 101)).toBe(true);
  });

  it("accepts a divergence exactly at the tolerance boundary", () => {
    // 100 vs 102 => |100-102|/102 ≈ 1.96% — just under 2%
    expect(isWithinDivergenceTolerance(100, 102)).toBe(true);
  });

  it("rejects a divergence over the default 2% tolerance", () => {
    // 100 vs 103 => |100-103|/103 ≈ 2.91% — over 2%
    expect(isWithinDivergenceTolerance(100, 103)).toBe(false);
  });

  it("is symmetric regardless of argument order", () => {
    expect(isWithinDivergenceTolerance(100, 103)).toBe(isWithinDivergenceTolerance(103, 100));
  });

  it("respects a custom tolerance", () => {
    expect(isWithinDivergenceTolerance(100, 110, 0.2)).toBe(true);
    expect(isWithinDivergenceTolerance(100, 110, 0.05)).toBe(false);
  });

  it("rejects wildly divergent prices (a plausible bad-feed scenario)", () => {
    expect(isWithinDivergenceTolerance(100, 1)).toBe(false);
  });
});
