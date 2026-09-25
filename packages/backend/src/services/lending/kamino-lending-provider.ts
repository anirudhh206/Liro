import { Connection, PublicKey } from "@solana/web3.js";
import {
  KaminoAction,
  KaminoMarket,
  VanillaObligation,
} from "@kamino-finance/klend-sdk";
import type { AssetSymbol, LendingProvider, ReserveHealth } from "@liro/shared";
import { env } from "../../config/env.js";

const connection = new Connection(env.SOLANA_RPC_URL, "confirmed");

/**
 * Kamino's main lending market address (mainnet-beta), per Kamino's own
 * deployed-addresses docs. Not a secret — public program state.
 */
const KAMINO_MAIN_MARKET = new PublicKey(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
);

let cachedMarket: KaminoMarket | null = null;

async function loadMarket(): Promise<KaminoMarket> {
  if (!cachedMarket) {
    const market = await KaminoMarket.load(connection, KAMINO_MAIN_MARKET);
    if (!market) {
      throw new Error(
        "Kamino market failed to load — check SOLANA_RPC_URL and market address",
      );
    }
    cachedMarket = market;
  }
  return cachedMarket;
}

function getReserveForAsset(market: KaminoMarket, asset: AssetSymbol) {
  // ADR-4's basket symbols (AAPLx/NVDAx/SPYx) are expected to match Kamino's
  // own reserve token symbols for the xStocks collateral market. If Kamino
  // lists them under a different symbol string, this lookup needs updating
  // to key off mint address instead — verify against
  // market.getReserves() once the xStocks reserve set is confirmed live.
  const reserve = market.getReserve(asset);
  if (!reserve) {
    throw new Error(`No Kamino reserve found for asset ${asset}`);
  }
  return reserve;
}

/** ADR-8: Kamino's own oracle reading (Chainlink-backed) for the same collateral Pyth prices. */
export async function getKaminoOraclePrice(
  asset: AssetSymbol,
): Promise<number> {
  const market = await loadMarket();
  const reserve = getReserveForAsset(market, asset);
  // reserve.stats exposes the SDK's own decimal-adjusted oracle price.
  // Field name to reconfirm against the installed klend-sdk version's types
  // (ReserveStats) before first real run — this is the SDK's documented
  // "current price" accessor as of the README, not a guess at a raw account field.
  return Number(reserve.stats.currentPrice ?? reserve.getOracleMarketPrice());
}

/**
 * ADR-2: thin wrapper so Kamino's specific SDK shape doesn't leak through
 * the rest of the codebase. This is the only LendingProvider implementation
 * — not a hedge toward a custom risk engine, just an interface seam.
 */
export const kaminoLendingProvider: LendingProvider = {
  async getReserveHealth(asset: AssetSymbol): Promise<ReserveHealth> {
    const market = await loadMarket();
    const reserve = getReserveForAsset(market, asset);

    // Kamino reserves carry an on-chain status (Active / Obsolete / Hidden).
    // Verify this exact accessor against the installed SDK version — it's
    // read from reserve.state.status in the on-chain layout as of the
    // current klend-sdk, not fabricated, but SDK versions shift field paths.
    const rawStatus = reserve.state.status;
    const status: ReserveHealth["status"] =
      rawStatus === 0 ? "active" : rawStatus === 1 ? "degraded" : "paused";

    return {
      status,
      liquidityAvailableUsd: reserve.stats.totalDepositsWads
        ? reserve.stats.totalDepositsWads.toString()
        : "0",
      checkedAt: new Date().toISOString(),
    };
  },

  async deposit(params): Promise<{ txSignature: string }> {
    const market = await loadMarket();
    const reserve = getReserveForAsset(market, params.asset);
    const owner = new PublicKey(params.userId); // userId is the user's wallet pubkey (ADR-1)
    const currentSlot = await connection.getSlot();

    const kaminoAction = await KaminoAction.buildDepositTxns({
      kaminoMarket: market,
      amount: params.amountUsd,
      reserveAddress: reserve.address,
      owner,
      obligation: new VanillaObligation(market.programId),
      useV2Ixs: true,
      scopeRefreshConfig: undefined,
      currentSlot,
    });

    // Actual signing happens via the Turnkey policy-scoped signer (ADR-1),
    // not a locally-held key — see wallet/turnkey-wallet-provider.ts, which
    // calls this builder's output through signAllowlistedAction.
    throw new Error(
      "kaminoAction built (" +
        kaminoAction.setupIxs.length +
        " setup ixs) — wire through TurnkeyWalletProvider.signAllowlistedAction to sign & submit before returning a real txSignature",
    );
  },

  async borrow(params): Promise<{ txSignature: string; borrowedUsd: string }> {
    // Symmetric to buildDepositTxns; klend-sdk exposes a borrow builder on
    // KaminoAction (naming to confirm against the installed version — the
    // README excerpt available at scaffold time only documented deposit).
    // Same signing path as deposit: build here, sign via Turnkey policy.
    throw new Error(
      `borrow() not yet wired: build via KaminoAction's borrow txn builder for ${params.amountUsd} USD, ` +
        `then sign through TurnkeyWalletProvider.signAllowlistedAction("borrow_against_collateral", ...)`,
    );
  },
};
