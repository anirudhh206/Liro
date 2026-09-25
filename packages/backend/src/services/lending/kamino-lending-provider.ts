import { Decimal } from "decimal.js";
import { address, createNoopSigner, type Address } from "@solana/kit";
import {
  KaminoAction,
  KaminoMarket,
  VanillaObligation,
  DEFAULT_RECENT_SLOT_DURATION_MS,
  ReserveStatus,
  getCurrentLedgerInstant,
} from "@kamino-finance/klend-sdk";
import { BORROW_ASSET_SYMBOL, type AssetSymbol, type LendingProvider, type ReserveHealth } from "@liro/shared";
import { prisma } from "../../db/client.js";
import { rpc, buildUnsignedTransactionHex } from "../wallet/solana-tx.util.js";
import { turnkeyWalletProvider } from "../wallet/turnkey-wallet-provider.js";
import { getSanityCheckedPrice } from "../pricing/pricing.service.js";

/**
 * Kamino's main lending market address (mainnet-beta), per Kamino's own
 * deployed-addresses docs. Not a secret — public program state.
 */
const KAMINO_MAIN_MARKET: Address = address("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");

let cachedMarket: KaminoMarket | null = null;

async function loadMarket(): Promise<KaminoMarket> {
  if (!cachedMarket) {
    // klend-sdk v12 is built on @solana/kit (Rpc<...>/Address), not web3.js's
    // Connection/PublicKey — confirmed against the installed package's own
    // type declarations (dist/classes/market.d.ts) rather than assumed.
    // klend-sdk bundles its own @solana/kit@2.3.0 internally while its own
    // sub-dependencies (@solana-program/*) require @solana/kit@^3.0 — a real
    // version-skew bug in Kamino's own dependency tree (visible as a pnpm
    // peer-dependency warning on install). It doesn't actually break type
    // compatibility here — both @solana/kit majors' Rpc<KaminoMarketRpcApi>
    // shapes structurally match — so no cast is needed for this call.
    const market = await KaminoMarket.load(rpc, KAMINO_MAIN_MARKET, DEFAULT_RECENT_SLOT_DURATION_MS);
    if (!market) {
      throw new Error("Kamino market failed to load — check SOLANA_RPC_URL and market address");
    }
    cachedMarket = market;
  }
  return cachedMarket;
}

function getReserveBySymbol(market: KaminoMarket, symbol: string) {
  // ADR-4's basket symbols (AAPLx/NVDAx/SPYx) and BORROW_ASSET_SYMBOL (USDC)
  // are expected to match Kamino's own reserve token symbols on the xStocks
  // collateral market. If Kamino lists any of them under a different symbol
  // string, this lookup needs updating to key off mint address instead —
  // verify against market.getReserves() once the reserve set is confirmed live.
  const [reserve] = market.getReservesBySymbol(symbol);
  if (!reserve) {
    throw new Error(`No Kamino reserve found for symbol ${symbol}`);
  }
  return reserve;
}

/** ADR-8: Kamino's own oracle reading (Chainlink-backed) for the same collateral Pyth prices. */
export async function getKaminoOraclePrice(asset: AssetSymbol): Promise<number> {
  const market = await loadMarket();
  const reserve = getReserveBySymbol(market, asset);
  return reserve.getOracleMarketPrice().toNumber();
}

/** Converts a USD amount into a reserve's base-unit token amount using decimal.js — never floats — for financial-grade precision. */
function usdToBaseUnits(amountUsd: string, priceUsd: number, decimals: number): string {
  return new Decimal(amountUsd).dividedBy(priceUsd).mul(new Decimal(10).pow(decimals)).toFixed(0);
}

async function loadUserSigner(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ownerAddress = address(user.walletAddress);
  return { ownerAddress, owner: createNoopSigner(ownerAddress) };
}

/**
 * ADR-2: thin wrapper so Kamino's specific SDK shape doesn't leak through
 * the rest of the codebase. This is the only LendingProvider implementation
 * — not a hedge toward a custom risk engine, just an interface seam.
 */
export const kaminoLendingProvider: LendingProvider = {
  async getReserveHealth(asset: AssetSymbol): Promise<ReserveHealth> {
    const market = await loadMarket();
    const reserve = getReserveBySymbol(market, asset);

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

  async deposit(params: { userId: string; asset: AssetSymbol; amountUsd: string }): Promise<{ txSignature: string }> {
    const market = await loadMarket();
    const reserve = getReserveBySymbol(market, params.asset);
    const { ownerAddress, owner } = await loadUserSigner(params.userId);

    // ADR-8's cross-checked price, not Kamino's own reading alone — a
    // deposit amount computed off a single unchecked oracle is exactly the
    // failure mode ADR-8 exists to prevent.
    const { priceUsd } = await getSanityCheckedPrice(params.asset);
    const amount = usdToBaseUnits(params.amountUsd, priceUsd, reserve.stats.decimals);

    const currentLedgerInstant = await getCurrentLedgerInstant(rpc);

    const kaminoAction = await KaminoAction.buildDepositTxns({
      kaminoMarket: market,
      amount,
      reserveAddress: reserve.address,
      owner,
      obligation: new VanillaObligation(market.programId),
      useV2Ixs: true,
      scopeRefreshConfig: undefined,
      currentLedgerInstant,
    });

    const unsignedTransactionHex = await buildUnsignedTransactionHex({
      instructions: [...kaminoAction.setupIxs, ...kaminoAction.lendingIxs, ...kaminoAction.cleanupIxs],
      feePayer: ownerAddress,
    });

    const signed = await turnkeyWalletProvider.signAndSubmitTransaction({
      userId: params.userId,
      action: "deposit_kamino_collateral",
      unsignedTransactionHex,
    });

    return { txSignature: signed.txSignature };
  },

  async borrow(params: { userId: string; amountUsd: string }): Promise<{ txSignature: string; borrowedUsd: string }> {
    const market = await loadMarket();
    const reserve = getReserveBySymbol(market, BORROW_ASSET_SYMBOL);
    const { ownerAddress, owner } = await loadUserSigner(params.userId);

    // USDC is a stable, 1:1 asset — no oracle cross-check needed to convert
    // a USD borrow amount into USDC base units (unlike deposit(), which
    // prices a volatile xStock).
    const amount = usdToBaseUnits(params.amountUsd, 1, reserve.stats.decimals);

    const currentLedgerInstant = await getCurrentLedgerInstant(rpc);

    const kaminoAction = await KaminoAction.buildBorrowTxns({
      kaminoMarket: market,
      amount,
      reserveAddress: reserve.address,
      owner,
      obligation: new VanillaObligation(market.programId),
      useV2Ixs: true,
      scopeRefreshConfig: undefined,
      currentLedgerInstant,
    });

    const unsignedTransactionHex = await buildUnsignedTransactionHex({
      instructions: [...kaminoAction.setupIxs, ...kaminoAction.lendingIxs, ...kaminoAction.cleanupIxs],
      feePayer: ownerAddress,
    });

    const signed = await turnkeyWalletProvider.signAndSubmitTransaction({
      userId: params.userId,
      action: "borrow_against_collateral",
      unsignedTransactionHex,
    });

    return { txSignature: signed.txSignature, borrowedUsd: params.amountUsd };
  },
};
