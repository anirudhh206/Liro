import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Decimal } from "decimal.js";
import { isAssetSymbol } from "@liro/shared";
import { appendLedgerEntry } from "../ledger/ledger.repository.js";
import { storeIdempotentResponse } from "../plugins/idempotency.js";
import { prisma } from "../db/client.js";
import { ASSET_MINTS, USDC_MINT } from "../config/asset-mints.js";
import {
  getSwapQuote,
  buildSwapTransaction,
  swapTransactionToHex,
} from "../services/swap/jupiter.service.js";
import { turnkeyWalletProvider } from "../services/wallet/turnkey-wallet-provider.js";
import { kaminoLendingProvider } from "../services/lending/kamino-lending-provider.js";

const investBodySchema = z.object({
  asset: z
    .string()
    .refine(isAssetSymbol, "asset must be one of the fixed basket symbols"),
  amountUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "amountUsd must be a decimal string"),
});

const USDC_DECIMALS = 6;

export default async function investRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post(
    "/invest",
    { preHandler: [fastify.authenticate, fastify.idempotent] },
    async (request, reply) => {
      const body = investBodySchema.parse(request.body);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.userId },
      });

      // 1. Swap USDC -> the target basket asset via Jupiter, signed through
      // the allow-listed Turnkey policy (ADR-1).
      const amountLamports = new Decimal(body.amountUsd)
        .mul(new Decimal(10).pow(USDC_DECIMALS))
        .toFixed(0);

      const quote = await getSwapQuote({
        inputMint: USDC_MINT,
        outputMint: ASSET_MINTS[body.asset],
        amountLamports,
      });
      const built = await buildSwapTransaction({
        quoteResponse: quote,
        userPublicKey: user.walletAddress,
      });

      const swapResult = await turnkeyWalletProvider.signAndSubmitTransaction({
        userId: request.userId,
        action: "swap_usdc_for_basket",
        unsignedTransactionHex: swapTransactionToHex(built.swapTransaction),
      });

      // 2. Deposit the swapped asset as Kamino collateral — deposit() builds
      // and signs its own transaction internally (see kamino-lending-provider.ts).
      const depositResult = await kaminoLendingProvider.deposit({
        userId: request.userId,
        asset: body.asset,
        amountUsd: body.amountUsd,
      });

      const ledgerRow = await appendLedgerEntry({
        userId: request.userId,
        entryType: "invest",
        amountUsd: body.amountUsd,
        metadata: {
          asset: body.asset,
          swapTx: swapResult.txSignature,
          depositTx: depositResult.txSignature,
        },
      });

      const response = {
        ledgerEntryId: ledgerRow.id,
        asset: body.asset,
        amountUsd: body.amountUsd,
      };
      await storeIdempotentResponse(
        request.userId,
        request.idempotencyKey,
        response,
      );
      return reply.code(201).send(response);
    },
  );
}
