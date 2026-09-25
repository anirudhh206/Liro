import { createSolanaRpc, address, type Address } from "@solana/kit";
import {
  KaminoMarket,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  ReserveStatus,
} from "@kamino-finance/klend-sdk";
import type { AssetSymbol, LendingProvider, ReserveHealth } from "@liro/shared";
import { env } from "../../config/env.js";

const rpc = createSolanaRpc(env.SOLANA_RPC_URL);

/**
 * Kamino's main lending market address (mainnet-beta), per Kamino's own
 * deployed-addresses docs. Not a secret — public program state.
 */
const KAMINO_MAIN_MARKET: Address = address(
  "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
);

let cachedMarket: KaminoMarket | null = null;

async function loadMarket(): Promise<KaminoMarket> {
  if (!cachedMarket) {
    // klend-sdk v12 is built on @solana/kit (Rpc<...>/Address), not web3.js's
    // Connection/PublicKey — confirmed against the installed package's own
    // type declarations (dist/classes/market.d.ts) rather than assumed.
    // klend-sdk bundles its own @solana/kit@2.3.0 internally while its own
    // sub-dependencies (@solana-program/*) require @solana/kit@^3.0 — a real
    // version-skew bug in Kamino's own dependency tree (visible as a pnpm
    // peer-dependency warning on install), which makes the Rpc client from
    // our top-level @solana/kit@3.x structurally incompatible with what
    // klend-sdk's types declare. The cast below bridges that mismatch; it
    // does not paper over anything on our side.
    const market = await KaminoMarket.load(
      rpc as unknown as Parameters<typeof KaminoMarket.load>[0],
      KAMINO_MAIN_MARKET,
      DEFAULT_RECENT_SLOT_DURATION_MS,
    );
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
  // to key off mint address instead — verify against market.getReserves()
  // once the xStocks reserve set is confirmed live.
  const [reserve] = market.getReservesBySymbol(asset);
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
  return reserve.getOracleMarketPrice().toNumber();
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

    const status: ReserveHealth["status"] =
      reserve.stats.status === ReserveStatus.Active
        ? "active"
        : reserve.stats.status === ReserveStatus.Obsolete
          ? "degraded"
          : "paused";

    return {
      status,
      liquidityAvailableUsd: reserve.getLiquidityAvailableAmount().toString(),
      checkedAt: new Date().toISOString(),
    };
  },

  async deposit(params): Promise<{ txSignature: string }> {
    // Real flow: load the reserve via getReserveForAsset, then build the
    // deposit instructions through KaminoAction's v12 builder (which now
    // takes a @solana/kit TransactionSigner, not a web3.js PublicKey, for
    // the owner — matching the ecosystem-wide Solana Kit migration this SDK
    // major went through). The signer itself is Turnkey's policy-scoped
    // signer (ADR-1), not a locally-held key — see
    // wallet/turnkey-wallet-provider.ts. Exact KaminoAction method name/
    // shape for v12 needs confirming against the current SDK docs before
    // first real run; deliberately left unimplemented rather than guessed.
    throw new Error(
      `deposit() not yet wired for userId=${params.userId}, asset=${params.asset}, amountUsd=${params.amountUsd}: ` +
        "build via KaminoAction's v12 deposit txn builder, then sign through TurnkeyWalletProvider.signAllowlistedAction",
    );
  },

  async borrow(params): Promise<{ txSignature: string; borrowedUsd: string }> {
    // Symmetric to deposit() above — same not-yet-wired reasoning.
    throw new Error(
      `borrow() not yet wired for userId=${params.userId}, amountUsd=${params.amountUsd}: ` +
        `build via KaminoAction's v12 borrow txn builder, then sign through TurnkeyWalletProvider.signAllowlistedAction("borrow_against_collateral", ...)`,
    );
  },
};
