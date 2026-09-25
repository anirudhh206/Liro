import type { AssetSymbol } from "@liro/shared";

/**
 * Real Solana mainnet mint addresses, looked up live against Jupiter's
 * verified token registry (https://lite-api.jup.ag/tokens/v2/search) on
 * 2026-09-25 and cross-checked against each entry's `isVerified: true` +
 * `xstocks` tag (Backed Finance's issuer tags) to rule out the many
 * imitation tokens that squat on these symbols. Re-verify if xStocks ever
 * re-issues a mint for the basket.
 */
export const ASSET_MINTS: Record<AssetSymbol, string> = {
  AAPLx: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  NVDAx: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  SPYx: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
};

/** Circle's canonical USDC mint on Solana mainnet — the fixed input side of every swap/borrow. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
