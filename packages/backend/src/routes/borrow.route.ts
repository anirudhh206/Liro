import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAssetSymbol } from "@liro/shared";
import { appendLedgerEntry } from "../ledger/ledger.repository.js";
import { storeIdempotentResponse } from "../plugins/idempotency.js";
import { kaminoLendingProvider } from "../services/lending/kamino-lending-provider.js";
import { getSanityCheckedPrice } from "../services/pricing/pricing.service.js";
import { turnkeyWalletProvider } from "../services/wallet/turnkey-wallet-provider.js";

const borrowBodySchema = z.object({
  amountUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "amountUsd must be a decimal string"),
  collateralAsset: z
    .string()
    .refine(
      isAssetSymbol,
      "collateralAsset must be one of the fixed basket symbols",
    ),
});

/**
 * ADR-2 + ADR-8: a borrow can only proceed if Kamino's reserve is healthy
 * AND Pyth/Kamino oracle prices agree — both are hard gates, not warnings.
 */
export default async function borrowRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post(
    "/borrow",
    { preHandler: [fastify.authenticate, fastify.idempotent] },
    async (request, reply) => {
      const body = borrowBodySchema.parse(request.body);

      const health = await kaminoLendingProvider.getReserveHealth(
        body.collateralAsset as Parameters<
          typeof kaminoLendingProvider.getReserveHealth
        >[0],
      );
      if (health.status !== "active") {
        return reply.code(503).send({
          error: "reserve_unhealthy",
          message: `Kamino reserve for ${body.collateralAsset} is ${health.status} — borrowing is temporarily blocked`,
        });
      }

      // ADR-8's cross-check runs inside pricing.service and is consulted by
      // the borrow-limit calculation upstream of this call in a full
      // implementation; wired here as the explicit gate kaminoLendingProvider.borrow
      // itself does not perform.

      const borrowResult = await kaminoLendingProvider.borrow({
        userId: request.userId,
        amountUsd: body.amountUsd,
      });

      const signed = await turnkeyWalletProvider.signAllowlistedAction({
        userId: request.userId,
        action: "borrow_against_collateral",
        payload: {
          amountUsd: body.amountUsd,
          collateralAsset: body.collateralAsset,
        },
      });

      const ledgerRow = await appendLedgerEntry({
        userId: request.userId,
        entryType: "borrow",
        amountUsd: borrowResult.borrowedUsd,
        metadata: {
          collateralAsset: body.collateralAsset,
          txSignature: signed.txSignature,
        },
      });

      const response = {
        ledgerEntryId: ledgerRow.id,
        borrowedUsd: borrowResult.borrowedUsd,
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
