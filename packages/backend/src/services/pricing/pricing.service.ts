import { HermesClient } from "@pythnetwork/hermes-client";
import type { AssetSymbol } from "@liro/shared";
import { env } from "../../config/env.js";
import { getKaminoOraclePrice } from "../lending/kamino-lending-provider.js";

const hermes = new HermesClient(env.PYTH_HERMES_URL, {});

/**
 * Pyth price feed IDs, looked up live from Hermes
 * (GET https://hermes.pyth.network/v2/price_feeds?query=<symbol>&asset_type=crypto)
 * against symbols Crypto.AAPLX/USD, Crypto.NVDAX/USD, Crypto.SPYX/USD on 2026-09-18.
 * Verify against that endpoint again if Pyth ever re-issues a feed for the basket.
 */
const PYTH_PRICE_FEED_IDS: Record<AssetSymbol, string> = {
  AAPLx: "0x978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
  NVDAx: "0x4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f",
  SPYx: "0x2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14",
};

/** Max tolerable relative divergence between Pyth and Kamino's own oracle before we block a borrow (ADR-8). */
const MAX_ORACLE_DIVERGENCE = 0.02; // 2%

export class OracleDivergenceError extends Error {
  constructor(
    public readonly asset: AssetSymbol,
    public readonly pythPrice: number,
    public readonly kaminoPrice: number,
  ) {
    super(
      `Price feeds disagree for ${asset}: Pyth=${pythPrice}, Kamino=${kaminoPrice}`,
    );
    this.name = "OracleDivergenceError";
  }
}

async function getPythPrice(asset: AssetSymbol): Promise<number> {
  const feedId = PYTH_PRICE_FEED_IDS[asset];
  const updates = await hermes.getLatestPriceUpdates([feedId]);
  const parsed = updates.parsed?.[0];
  if (!parsed) {
    throw new Error(`No Pyth price update returned for ${asset}`);
  }
  const { price, expo } = parsed.price;
  return Number(price) * 10 ** expo;
}

/**
 * ADR-8: the only function callers should use to price a borrow decision.
 * Fetches Pyth's price and cross-checks it against Kamino's own oracle
 * reading (Chainlink) for the same collateral before trusting either.
 */
export async function getSanityCheckedPrice(
  asset: AssetSymbol,
): Promise<{ priceUsd: number }> {
  const [pythPrice, kaminoPrice] = await Promise.all([
    getPythPrice(asset),
    getKaminoOraclePrice(asset),
  ]);

  const divergence =
    Math.abs(pythPrice - kaminoPrice) / Math.max(pythPrice, kaminoPrice);
  if (divergence > MAX_ORACLE_DIVERGENCE) {
    throw new OracleDivergenceError(asset, pythPrice, kaminoPrice);
  }

  return { priceUsd: pythPrice };
}
