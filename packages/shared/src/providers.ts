import type { AssetSymbol } from "./assets.js";

/** ADR-2: the shape every lending backend must satisfy — Kamino today, nothing else planned. */
export interface ReserveHealth {
  status: "active" | "paused" | "degraded";
  liquidityAvailableUsd: string;
  checkedAt: string;
}

export interface LendingProvider {
  getReserveHealth(asset: AssetSymbol): Promise<ReserveHealth>;
  /** Deposits `asset` (priced via ADR-8's sanity-checked oracle) as Kamino collateral. */
  deposit(params: { userId: string; asset: AssetSymbol; amountUsd: string }): Promise<{ txSignature: string }>;
  /**
   * Borrows against whatever collateral the user's on-chain obligation
   * already holds, denominated in BORROW_ASSET_SYMBOL (USDC). Which asset
   * backs it isn't a parameter here — Kamino's obligation account tracks
   * deposited collateral on-chain, so a borrow instruction only needs the
   * debt reserve. Collateral health is checked by the caller beforehand
   * (see routes/borrow.route.ts) via getReserveHealth on that asset.
   */
  borrow(params: { userId: string; amountUsd: string }): Promise<{ txSignature: string; borrowedUsd: string }>;
}

/** ADR-1: only a pre-declared, allow-listed action set may ever be signed on the user's behalf. */
export type WalletPolicyAction = "swap_usdc_for_basket" | "deposit_kamino_collateral" | "borrow_against_collateral";

export interface WalletProvider {
  createEmbeddedWallet(params: { userId: string }): Promise<{ walletAddress: string; turnkeySubOrgId: string }>;
  /**
   * Signs a fully-built, unsigned transaction (hex-encoded wire bytes, as
   * produced by `getTransactionEncoder().encode()` in @solana/kit) through
   * the user's policy-scoped Turnkey sub-organization, then submits it to
   * the network and returns the real on-chain signature. `action` is
   * re-validated against the allow-list before any signing call is made.
   */
  signAndSubmitTransaction(params: {
    userId: string;
    action: WalletPolicyAction;
    unsignedTransactionHex: string;
  }): Promise<{ txSignature: string }>;
}

/** ADR-3: local-currency payout via a real, licensed payment-as-a-service partner. */
export interface PayoutQuote {
  quoteId: string;
  amountUsd: string;
  amountLocal: string;
  localCurrency: "BRL" | "INR";
  rail: "PIX" | "UPI";
  expiresAt: string;
}

export interface PayoutProvider {
  getQuote(params: { amountUsd: string; localCurrency: "BRL" | "INR" }): Promise<PayoutQuote>;
  executePayout(params: {
    userId: string;
    quoteId: string;
    destination: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ payoutId: string; status: "pending" | "completed" | "failed" }>;
}

/**
 * ADR-5's next layer: real identity verification, gated the same way as
 * ADR-1/ADR-3 — a real adapter against a real provider's API, blocked on
 * the user creating a real account, never silently re-mocked.
 */
export type KycStatus = "pending" | "approved" | "declined" | "requires_input";

export interface KycProvider {
  /** Starts a verification session/inquiry for a user; the client completes it via `verificationUrl`. */
  startVerification(params: { userId: string; declaredCountry: string }): Promise<{
    inquiryId: string;
    verificationUrl: string;
    status: KycStatus;
  }>;
  /** Polls the current status — also called from the provider's webhook handler to reconcile async updates. */
  getVerificationStatus(params: { inquiryId: string }): Promise<{ status: KycStatus }>;
}
