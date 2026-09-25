import { Turnkey } from "@turnkey/sdk-server";
import type { WalletProvider, WalletPolicyAction } from "@liro/shared";
import { env } from "../../config/env.js";

const turnkey = new Turnkey({
  defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID,
  apiBaseUrl: env.TURNKEY_API_BASE_URL,
  apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
  apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
});

const apiClient = turnkey.apiClient();

/**
 * ADR-1: the backend's signing authority is scoped to exactly these three
 * actions via a Turnkey policy attached to each user's sub-organization at
 * onboarding — this array is the allow-list, not a UI label. Extending it
 * requires updating the actual Turnkey policy document, not just this list.
 */
const ALLOWED_ACTIONS: readonly WalletPolicyAction[] = [
  "swap_usdc_for_basket",
  "deposit_kamino_collateral",
  "borrow_against_collateral",
];

export class WalletPolicyViolationError extends Error {
  constructor(action: string) {
    super(
      `Action "${action}" is not in the allow-listed policy set — refusing to sign`,
    );
    this.name = "WalletPolicyViolationError";
  }
}

/**
 * ADR-1: policy-scoped session signer. Each user gets their own Turnkey
 * sub-organization at onboarding (created with a policy document that
 * hard-restricts signable actions server-side, enforced by Turnkey itself —
 * this app-level allow-list check is defense in depth, not the only guard).
 */
export const turnkeyWalletProvider: WalletProvider = {
  async createEmbeddedWallet(params: {
    userId: string;
  }): Promise<{ walletAddress: string }> {
    // Real flow: apiClient.createSubOrganization({...}) with a policy
    // document scoped to ALLOWED_ACTIONS, then apiClient.createWallet(...)
    // for the new sub-org, returning its Solana address. Exact request
    // shape (root user config, policy JSON) needs confirming against
    // Turnkey's current API reference before first real run — this stub
    // makes the missing piece explicit instead of returning a fake address.
    throw new Error(
      `createEmbeddedWallet not yet wired for userId=${params.userId}: ` +
        "call apiClient.createSubOrganization with an ALLOWED_ACTIONS policy, then createWallet on that sub-org",
    );
  },

  async signAllowlistedAction(params: {
    userId: string;
    action: WalletPolicyAction;
    payload: Record<string, unknown>;
  }): Promise<{ txSignature: string }> {
    if (!ALLOWED_ACTIONS.includes(params.action)) {
      throw new WalletPolicyViolationError(params.action);
    }

    // Real flow: apiClient.signTransaction({ signWith: <sub-org wallet id>,
    // unsignedTransaction, type: "TRANSACTION_TYPE_SOLANA" }) — Turnkey's
    // own policy engine re-checks this against the sub-org's policy
    // document server-side regardless of the app-level check above.
    // Exact method/param names to confirm against the current API
    // reference before first real run.
    void apiClient;
    throw new Error(
      `signAllowlistedAction not yet wired for action="${params.action}", userId=${params.userId}: ` +
        "call apiClient.signTransaction against the user's sub-org wallet",
    );
  },
};
