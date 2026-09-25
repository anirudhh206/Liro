import {
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getTransactionEncoder,
  pipe,
  type Address,
  type Instruction,
  type Base64EncodedWireTransaction,
} from "@solana/kit";
import { env } from "../../config/env.js";

export const rpc = createSolanaRpc(env.SOLANA_RPC_URL);

/**
 * Compiles a list of instructions into an unsigned transaction and encodes
 * it to hex — the exact wire format Turnkey's SIGN_TRANSACTION_V2 activity
 * expects for TRANSACTION_TYPE_SOLANA (confirmed against @turnkey/solana's
 * own serialization: `tx.serialize({requireAllSignatures:false}).toString("hex")`,
 * reproduced here for @solana/kit's compiled-transaction wire format instead
 * of web3.js's, since klend-sdk v12 only builds Kit-shaped instructions).
 */
export async function buildUnsignedTransactionHex(params: {
  instructions: Instruction[];
  feePayer: Address;
}): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(params.feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(params.instructions, m),
  );

  const compiled = compileTransaction(message);
  const wireBytes = getTransactionEncoder().encode(compiled);
  return Buffer.from(wireBytes).toString("hex");
}

/** Submits a fully-signed transaction (hex wire bytes, as returned by Turnkey) and returns its signature. */
export async function submitSignedTransactionHex(signedTransactionHex: string): Promise<string> {
  const wireBytes = Buffer.from(signedTransactionHex, "hex");
  // No runtime validator for this brand ships in @solana/kit for a bare
  // string (only for a Kit-native Transaction object) — this cast is a
  // compile-time-only nominal-type assertion, not a data transformation.
  const base64Tx = wireBytes.toString("base64") as Base64EncodedWireTransaction;

  const signature = await rpc
    .sendTransaction(base64Tx, {
      encoding: "base64",
      skipPreflight: false,
      maxRetries: BigInt(3),
    })
    .send();

  return signature;
}
