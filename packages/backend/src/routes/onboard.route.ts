import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { issueSessionToken } from "../plugins/auth.js";
import { personaCredentialsConfigured } from "../config/env.js";
import { evaluateEligibility } from "../services/eligibility/eligibility.service.js";
import { turnkeyWalletProvider } from "../services/wallet/turnkey-wallet-provider.js";
import { personaKycProvider } from "../services/kyc/persona-kyc-provider.js";

const onboardBodySchema = z.object({
  declaredCountry: z.string().length(2),
});

/**
 * The one unauthenticated route in the system: it's what *creates* the
 * identity everything else authenticates against (ADR-7). Every other
 * mutating route requires the session token this issues.
 */
export default function onboardRoutes(fastify: FastifyInstance): void {
  fastify.post("/onboard", async (request, reply) => {
    const body = onboardBodySchema.parse(request.body);
    const ipAddress = request.ip;

    // 1. Create the user's policy-scoped embedded wallet (ADR-1). Turnkey's
    // sub-organization is keyed by its own generated name, independent of
    // our userId, so this can run before the User row exists — the row is
    // then created with both identifiers already in hand, never backfilled.
    const provisionalUserId = crypto.randomUUID();
    const wallet = await turnkeyWalletProvider.createEmbeddedWallet({ userId: provisionalUserId });

    const user = await prisma.user.create({
      data: { walletAddress: wallet.walletAddress, turnkeySubOrgId: wallet.turnkeySubOrgId },
    });

    // 2. Record eligibility immutably (ADR-5) — this never blocks wallet
    // creation from being recorded, but does block session issuance below.
    const eligibility = await evaluateEligibility({
      userId: user.id,
      declaredCountry: body.declaredCountry,
      ipAddress,
    });

    if (eligibility.decision === "rejected") {
      return reply.code(403).send({ error: "not_eligible", reason: eligibility.reason });
    }

    // 3. Start real identity verification (ADR-5's next layer) — unlike
    // ADR-3's payout, an unconfigured KYC provider doesn't block onboarding
    // itself (a user can hold a wallet and be geo-eligible before KYC
    // exists); it's surfaced in the response instead so the client can
    // prompt the user once Persona is wired up.
    let kyc: { inquiryId: string; verificationUrl: string; status: string } | null = null;
    if (personaCredentialsConfigured) {
      const verification = await personaKycProvider.startVerification({
        userId: user.id,
        declaredCountry: body.declaredCountry,
      });
      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: { kycInquiryId: verification.inquiryId, kycStatus: verification.status },
        }),
        prisma.kycVerificationRecord.create({
          data: { userId: user.id, inquiryId: verification.inquiryId, status: verification.status },
        }),
      ]);
      kyc = verification;
    }

    // 4. Issue the session token (ADR-7) — the only source of userId from here on.
    const token = await issueSessionToken(user.id);

    return reply.code(201).send({
      userId: user.id,
      walletAddress: user.walletAddress,
      sessionToken: token,
      kyc: kyc ?? { status: "not_configured" },
    });
  });
}
