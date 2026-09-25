import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAssetSymbol } from "@liro/shared";
import { appendLedgerEntry } from "../ledger/ledger.repository.js";
import { storeIdempotentResponse } from "../plugins/idempotency.js";
import { kaminoLendingProvider } from "../services/lending/kamino-lending-provider.js";
import { getSanityCheckedPrice } from "../services/pricing/pricing.service.js";

const borrowBodySchema = z.object({
  amountUsd: z.string().regex(/^\d+(\.\d{1,2})?$/, "amountUsd must be a decimal string"),
  collateralAsset: z.string().refine(isAssetSymbol, "collateralAsset must be one of the fixed basket symbols"),
});

/**
 * ADR-2 + ADR-8: a borrow can only proceed if Kamino's reserve is healthy
 * AND Pyth/Kamino oracle prices agree — both are hard gates, not warnings.
 */
export default function borrowRoutes(fastify: FastifyInstance): void {
  fastify.post("/borrow", { preHandler: [fastify.authenticate, fastify.idempotent] }, async (request, reply) => {
    const body = borrowBodySchema.parse(request.body);

    const health = await kaminoLendingProvider.getReserveHealth(body.collateralAsset);
    if (health.status !== "active") {
      return reply.code(503).send({
        error: "reserve_unhealthy",
        message: `Kamino reserve for ${body.collateralAsset} is ${health.status} — borrowing is temporarily blocked`,
      });
    }

    // ADR-8: hard gate, not a warning — refuses to price the borrow off a
    // single unchecked oracle read. Throws OracleDivergenceError (which the
    // Fastify error handler in app.ts maps to a 503) if Pyth and Kamino disagree.
    await getSanityCheckedPrice(body.collateralAsset);

    // borrow() builds and signs its own transaction internally (see
    // kamino-lending-provider.ts) — no separate Turnkey call here.
    const borrowResult = await kaminoLendingProvider.borrow({
      userId: request.userId,
      amountUsd: body.amountUsd,
    });

    const ledgerRow = await appendLedgerEntry({
      userId: request.userId,
      entryType: "borrow",
      amountUsd: borrowResult.borrowedUsd,
      metadata: {
        collateralAsset: body.collateralAsset,
        txSignature: borrowResult.txSignature,
      },
    });

    const response = {
      ledgerEntryId: ledgerRow.id,
      borrowedUsd: borrowResult.borrowedUsd,
    };
    await storeIdempotentResponse(request.userId, request.idempotencyKey, response);
    return reply.code(201).send(response);
  });
}
