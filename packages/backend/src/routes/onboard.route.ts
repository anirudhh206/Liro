import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { issueSessionToken } from "../plugins/auth.js";
import { evaluateEligibility } from "../services/eligibility/eligibility.service.js";
import { turnkeyWalletProvider } from "../services/wallet/turnkey-wallet-provider.js";

const onboardBodySchema = z.object({
  declaredCountry: z.string().length(2),
});

/**
 * The one unauthenticated route in the system: it's what *creates* the
 * identity everything else authenticates against (ADR-7). Every other
 * mutating route requires the session token this issues.
 */
export default async function onboardRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post("/onboard", async (request, reply) => {
    const body = onboardBodySchema.parse(request.body);
    const ipAddress = request.ip;

    // 1. Create the user's policy-scoped embedded wallet (ADR-1).
    const wallet = await turnkeyWalletProvider.createEmbeddedWallet({
      userId: "pending",
    });

    const user = await prisma.user.create({
      data: { walletAddress: wallet.walletAddress },
    });

    // 2. Record eligibility immutably (ADR-5) — this never blocks wallet
    // creation from being recorded, but does block session issuance below.
    const eligibility = await evaluateEligibility({
      userId: user.id,
      declaredCountry: body.declaredCountry,
      ipAddress,
    });

    if (eligibility.decision === "rejected") {
      return reply
        .code(403)
        .send({ error: "not_eligible", reason: eligibility.reason });
    }

    // 3. Issue the session token (ADR-7) — the only source of userId from here on.
    const token = await issueSessionToken(user.id);

    return reply.code(201).send({
      userId: user.id,
      walletAddress: user.walletAddress,
      sessionToken: token,
    });
  });
}
