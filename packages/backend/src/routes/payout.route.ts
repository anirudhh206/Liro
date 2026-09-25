import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendLedgerEntry } from "../ledger/ledger.repository.js";
import { storeIdempotentResponse } from "../plugins/idempotency.js";
import { lightsparkGridPayoutProvider } from "../services/payout/lightspark-grid-payout-provider.js";

const payoutBodySchema = z.object({
  amountUsd: z.string().regex(/^\d+(\.\d{1,2})?$/, "amountUsd must be a decimal string"),
  localCurrency: z.enum(["BRL", "INR"]),
  destination: z.record(z.string(), z.unknown()),
});

/**
 * ADR-3: the local-currency cash-out leg. Calls the real Lightspark Grid
 * sandbox client — if GRID_CLIENT_ID/SECRET aren't configured yet, this
 * fails loudly with PayoutProviderNotConfiguredError (mapped to 503 in
 * app.ts) rather than returning a fabricated success.
 */
export default function payoutRoutes(fastify: FastifyInstance): void {
  fastify.post("/payout", { preHandler: [fastify.authenticate, fastify.idempotent] }, async (request, reply) => {
    const body = payoutBodySchema.parse(request.body);

    const quote = await lightsparkGridPayoutProvider.getQuote({
      amountUsd: body.amountUsd,
      localCurrency: body.localCurrency,
    });

    const payout = await lightsparkGridPayoutProvider.executePayout({
      userId: request.userId,
      quoteId: quote.quoteId,
      destination: body.destination,
      idempotencyKey: request.idempotencyKey,
    });

    const ledgerRow = await appendLedgerEntry({
      userId: request.userId,
      entryType: "payout",
      amountUsd: body.amountUsd,
      metadata: {
        localCurrency: body.localCurrency,
        amountLocal: quote.amountLocal,
        rail: quote.rail,
        gridQuoteId: quote.quoteId,
        gridPayoutId: payout.payoutId,
        status: payout.status,
      },
    });

    const response = {
      ledgerEntryId: ledgerRow.id,
      payoutId: payout.payoutId,
      status: payout.status,
      amountLocal: quote.amountLocal,
      localCurrency: body.localCurrency,
    };
    await storeIdempotentResponse(request.userId, request.idempotencyKey, response);
    return reply.code(201).send(response);
  });
}
