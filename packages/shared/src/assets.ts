/**
 * ADR-4: fixed tokenized-equity basket. Not user-configurable — keeps swap
 * routing and collateral logic simple, per the (unchanged) v1/v2 decision.
 */
export const ASSET_BASKET = ["AAPLx", "NVDAx", "SPYx"] as const;

export type AssetSymbol = (typeof ASSET_BASKET)[number];

export function isAssetSymbol(value: string): value is AssetSymbol {
  return (ASSET_BASKET as readonly string[]).includes(value);
}
