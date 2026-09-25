import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAssetSymbol } from "@liro/shared";
import { appendLedgerEntry } from "../ledger/ledger.repository.js";
import { storeIdempotentResponse } from "../plugins/idempotency.js";
import { turnkeyWalletProvider } from "../services/wallet/turnkey-wallet-provider.js";

const investBodySchema = z.object({
  asset: z
    .string()
    .refine(isAssetSymbol, "asset must be one of the fixed basket symbols"),
  amountUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "amountUsd must be a decimal string"),
});

export default async function investRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post(
    "/invest",
    { preHandler: [fastify.authenticate, fastify.idempotent] },
    async (request, reply) => {
      const body = investBodySchema.parse(request.body);

      // Swap USDC -> basket asset, then deposit as Kamino collateral — both
      // steps are signed via the same allow-listed Turnkey policy (ADR-1).
      const swapResult = await turnkeyWalletProvider.signAllowlistedAction({
        userId: request.userId,
        action: "swap_usdc_for_basket",
        payload: { asset: body.asset, amountUsd: body.amountUsd },
      });

      const depositResult = await turnkeyWalletProvider.signAllowlistedAction({
        userId: request.userId,
        action: "deposit_kamino_collateral",
        payload: { asset: body.asset, amountUsd: body.amountUsd },
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
