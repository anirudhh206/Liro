import type { AssetSymbol } from "./assets.js";

/** ADR-2: the shape every lending backend must satisfy — Kamino today, nothing else planned. */
export interface ReserveHealth {
  status: "active" | "paused" | "degraded";
  liquidityAvailableUsd: string;
  checkedAt: string;
}

export interface LendingProvider {
  getReserveHealth(asset: AssetSymbol): Promise<ReserveHealth>;
  deposit(params: {
    userId: string;
    asset: AssetSymbol;
    amountUsd: string;
  }): Promise<{ txSignature: string }>;
  borrow(params: {
    userId: string;
    amountUsd: string;
  }): Promise<{ txSignature: string; borrowedUsd: string }>;
}

/** ADR-1: only a pre-declared, allow-listed action set may ever be signed on the user's behalf. */
export type WalletPolicyAction =
  | "swap_usdc_for_basket"
  | "deposit_kamino_collateral"
  | "borrow_against_collateral";

export interface WalletProvider {
  createEmbeddedWallet(params: {
    userId: string;
  }): Promise<{ walletAddress: string }>;
  signAllowlistedAction(params: {
    userId: string;
    action: WalletPolicyAction;
    payload: Record<string, unknown>;
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
  getQuote(params: {
    amountUsd: string;
    localCurrency: "BRL" | "INR";
  }): Promise<PayoutQuote>;
  executePayout(params: {
    userId: string;
    quoteId: string;
    destination: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{ payoutId: string; status: "pending" | "completed" | "failed" }>;
}
