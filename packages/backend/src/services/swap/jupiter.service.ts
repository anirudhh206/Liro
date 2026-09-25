import { env } from "../../config/env.js";

/**
 * Jupiter's Swap API (lite tier, no API key required): real HTTP calls
 * against https://lite-api.jup.ag/swap/v1 — see https://dev.jup.ag/docs/swap-api/.
 * No SDK wrapper needed; the REST contract is the stable interface.
 */

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  [key: string]: unknown;
}

export async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amountLamports: string;
  slippageBps?: number;
}): Promise<JupiterQuoteResponse> {
  const url = new URL(`${env.JUPITER_SWAP_API_URL}/quote`);
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", params.amountLamports);
  url.searchParams.set("slippageBps", String(params.slippageBps ?? 50));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as JupiterQuoteResponse;
}

export async function buildSwapTransaction(params: {
  quoteResponse: JupiterQuoteResponse;
  userPublicKey: string;
}): Promise<{ swapTransaction: string }> {
  const res = await fetch(`${env.JUPITER_SWAP_API_URL}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: params.quoteResponse,
      userPublicKey: params.userPublicKey,
      wrapAndUnwrapSol: true,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Jupiter swap build failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as { swapTransaction: string };
}

/**
 * Jupiter returns `swapTransaction` as base64-encoded wire bytes (a
 * web3.js-serialized VersionedTransaction). Turnkey's SIGN_TRANSACTION_V2
 * activity expects hex (confirmed against @turnkey/solana's own
 * serialization — see solana-tx.util.ts), so every swap transaction is
 * re-encoded before it reaches TurnkeyWalletProvider.
 */
export function swapTransactionToHex(swapTransactionBase64: string): string {
  return Buffer.from(swapTransactionBase64, "base64").toString("hex");
}
