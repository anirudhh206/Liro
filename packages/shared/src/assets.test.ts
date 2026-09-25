import { describe, it, expect } from "vitest";
import { ASSET_BASKET, isAssetSymbol } from "./assets.js";

describe("isAssetSymbol", () => {
  it("accepts every symbol in the fixed basket", () => {
    for (const symbol of ASSET_BASKET) {
      expect(isAssetSymbol(symbol)).toBe(true);
    }
  });

  it("rejects a symbol outside the basket", () => {
    expect(isAssetSymbol("TSLAx")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isAssetSymbol("")).toBe(false);
  });

  it("is case-sensitive — lowercase is not a valid basket symbol", () => {
    expect(isAssetSymbol("aaplx")).toBe(false);
  });
});
