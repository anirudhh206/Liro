/**
 * ADR-4: fixed tokenized-equity basket. Not user-configurable — keeps swap
 * routing and collateral logic simple, per the (unchanged) v1/v2 decision.
 */
export const ASSET_BASKET = ["AAPLx", "NVDAx", "SPYx"] as const;

export type AssetSymbol = (typeof ASSET_BASKET)[number];

export function isAssetSymbol(value: string): value is AssetSymbol {
  return (ASSET_BASKET as readonly string[]).includes(value);
}

/**
 * The single asset borrows are denominated in. Kamino's `borrow` action
 * needs its own reserve (separate from whichever basket asset backs the
 * loan as collateral) — this is that reserve's symbol on Kamino's main market.
 */
export const BORROW_ASSET_SYMBOL = "USDC" as const;
