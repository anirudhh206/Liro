import LightsparkGrid from "@lightsparkdev/grid";
import type { PayoutProvider, PayoutQuote } from "@liro/shared";
import { env, gridCredentialsConfigured } from "../../config/env.js";

/**
 * ADR-3: real Lightspark Grid sandbox client — not instantiated until real
 * sandbox credentials exist. `gridCredentialsConfigured` is the named
 * blocker check the rest of the app uses to decide whether payout is live.
 */
const client = gridCredentialsConfigured
  ? new LightsparkGrid({
      username: env.GRID_CLIENT_ID,
      password: env.GRID_CLIENT_SECRET,
    })
  : null;

export class PayoutProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "Lightspark Grid credentials are not configured (GRID_CLIENT_ID / GRID_CLIENT_SECRET). " +
        "This is the named ADR-3 blocker: sandbox access requires completing Lightspark's KYB process first.",
    );
    this.name = "PayoutProviderNotConfiguredError";
  }
}

function requireClient(): LightsparkGrid {
  if (!client) throw new PayoutProviderNotConfiguredError();
  return client;
}

export const lightsparkGridPayoutProvider: PayoutProvider = {
  async getQuote(params: {
    amountUsd: string;
    localCurrency: "BRL" | "INR";
  }): Promise<PayoutQuote> {
    const grid = requireClient();
    void grid; // real call: grid.quotes.create({...}) once account IDs for the
    // internal (Liro-held) and external (user payout destination) accounts
    // are provisioned in Grid's dashboard — see grid-js-sdk README for the
    // quotes.create shape (source/destination/lockedCurrencyAmount).
    throw new Error(
      `getQuote not yet wired for ${params.amountUsd} USD -> ${params.localCurrency}: ` +
        "call grid.quotes.create once Grid account IDs are provisioned",
    );
  },

  async executePayout(params: {
    userId: string;
    quoteId: string;
    destination: Record<string, unknown>;
    idempotencyKey: string;
  }): Promise<{
    payoutId: string;
    status: "pending" | "completed" | "failed";
  }> {
    const grid = requireClient();
    void grid; // real call: Grid's transfer/payout execution endpoint, keyed
    // by quoteId, with params.idempotencyKey passed through as Grid's own
    // idempotency header/field (in addition to our own ADR-6 dedupe layer).
    // Exact method name to confirm against api.md before first real run.
    throw new Error(
      `executePayout not yet wired for userId=${params.userId}, quoteId=${params.quoteId}: ` +
        "call Grid's payout execution endpoint with idempotencyKey passed through",
    );
  },
};
