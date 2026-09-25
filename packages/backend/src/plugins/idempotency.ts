import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";

const IDEMPOTENCY_HEADER = "idempotency-key";

/**
 * ADR-6: every mutating endpoint (/invest, /borrow, /payout) requires this
 * header. A retried request with the same (userId, key) short-circuits to
 * the stored response instead of re-executing the side effect.
 *
 * Must run AFTER auth (needs request.userId) and BEFORE the route handler
 * does any real work.
 */
async function idempotencyPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = request.headers[IDEMPOTENCY_HEADER];
  if (typeof key !== "string" || key.length === 0) {
    return reply.code(400).send({ error: "missing_idempotency_key" });
  }

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      userId_idempotencyKey: { userId: request.userId, idempotencyKey: key },
    },
  });

  if (existing) {
    reply.header("x-idempotent-replay", "true");
    reply.send(existing.responseBody);
    return reply; // short-circuits the route handler
  }

  request.idempotencyKey = key;
}

/**
 * Called by a route handler once its side effect has committed, to persist
 * the response under this request's idempotency key. Uses the unique
 * constraint as the race guard: a concurrent duplicate request loses the
 * insert race and its handler's own effect must be transactionally guarded
 * upstream (e.g. inside the same DB transaction as the ledger write).
 */
export async function storeIdempotentResponse(
  userId: string,
  idempotencyKey: string,
  responseBody: unknown,
): Promise<void> {
  try {
    await prisma.idempotencyKey.create({
      data: {
        userId,
        idempotencyKey,
        responseBody: responseBody as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return; // another concurrent request already stored it — not an error
    }
    throw err;
  }
}

export default fp(function idempotencyPlugin(fastify: FastifyInstance) {
  fastify.decorate("idempotent", idempotencyPreHandler);
});

declare module "fastify" {
  interface FastifyInstance {
    idempotent: typeof idempotencyPreHandler;
  }
  interface FastifyRequest {
    idempotencyKey: string;
  }
}
