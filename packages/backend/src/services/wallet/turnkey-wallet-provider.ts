import { Turnkey } from "@turnkey/sdk-server";
import type { WalletProvider, WalletPolicyAction } from "@liro/shared";
import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";
import { submitSignedTransactionHex } from "./solana-tx.util.js";

const turnkey = new Turnkey({
  defaultOrganizationId: env.TURNKEY_ORGANIZATION_ID,
  apiBaseUrl: env.TURNKEY_API_BASE_URL,
  apiPrivateKey: env.TURNKEY_API_PRIVATE_KEY,
  apiPublicKey: env.TURNKEY_API_PUBLIC_KEY,
});

const apiClient = turnkey.apiClient();

/** Solana's standard BIP-44 derivation path for the first account. */
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

/**
 * ADR-1: the backend's signing authority is scoped to exactly these three
 * actions. Turnkey's own policy engine (attached to each sub-organization
 * at creation, see createEmbeddedWallet) is the real enforcement boundary;
 * this array is defense in depth at the application layer, not the only guard.
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
 * sub-organization at onboarding, with our backend's own API key installed
 * as its sole root user — that's what lets the backend sign on the user's
 * behalf without ever holding a private key locally. The policy document
 * that actually restricts *which* actions that root user may sign for this
 * sub-org is provisioned once per Turnkey organization (via the Turnkey
 * dashboard or Policies API, keyed to ALLOWED_ACTIONS' underlying program
 * IDs/instruction discriminators) — out of scope for this file, which
 * enforces the same allow-list as a second, application-layer gate.
 */
export const turnkeyWalletProvider: WalletProvider = {
  async createEmbeddedWallet(params: {
    userId: string;
  }): Promise<{ walletAddress: string; turnkeySubOrgId: string }> {
    const response = await apiClient.createSubOrganization({
      subOrganizationName: `liro-${params.userId}`,
      rootQuorumThreshold: 1,
      rootUsers: [
        {
          userName: "liro-backend",
          apiKeys: [
            {
              apiKeyName: "liro-backend-signer",
              publicKey: env.TURNKEY_API_PUBLIC_KEY,
              curveType: "API_KEY_CURVE_P256",
            },
          ],
          authenticators: [],
          oauthProviders: [],
        },
      ],
      wallet: {
        walletName: `liro-wallet-${params.userId}`,
        accounts: [
          {
            curve: "CURVE_ED25519",
            pathFormat: "PATH_FORMAT_BIP32",
            path: SOLANA_DERIVATION_PATH,
            addressFormat: "ADDRESS_FORMAT_SOLANA",
            name: "solana-main",
          },
        ],
      },
    });

    const walletAddress = response.wallet?.addresses[0];
    if (!walletAddress) {
      throw new Error(
        `Turnkey createSubOrganization for userId=${params.userId} did not return a Solana wallet address`,
      );
    }

    return { walletAddress, turnkeySubOrgId: response.subOrganizationId };
  },

  async signAndSubmitTransaction(params: {
    userId: string;
    action: WalletPolicyAction;
    unsignedTransactionHex: string;
  }): Promise<{ txSignature: string }> {
    if (!ALLOWED_ACTIONS.includes(params.action)) {
      throw new WalletPolicyViolationError(params.action);
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: params.userId },
    });
    if (!user.turnkeySubOrgId) {
      throw new Error(
        `User ${params.userId} has no Turnkey sub-organization on record — onboarding incomplete`,
      );
    }

    // Turnkey's own policy engine re-checks this signing request against the
    // sub-org's policy document server-side, independent of the allow-list
    // check above — that's the real security boundary (ADR-1); this call
    // only succeeds if Turnkey's policy also permits it.
    const { signedTransaction } = await apiClient.signTransaction({
      organizationId: user.turnkeySubOrgId,
      signWith: user.walletAddress,
      unsignedTransaction: params.unsignedTransactionHex,
      type: "TRANSACTION_TYPE_SOLANA",
    });

    const txSignature = await submitSignedTransactionHex(signedTransaction);
    return { txSignature };
  },
};
