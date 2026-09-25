import type { FastifyInstance } from "fastify";
import { prisma } from "../db/client.js";
import { personaCredentialsConfigured } from "../config/env.js";
import { personaKycProvider } from "../services/kyc/persona-kyc-provider.js";

/**
 * ADR-5's next layer: polls Persona for the latest status and reconciles it
 * — every observed status is appended immutably (KycVerificationRecord),
 * with the User row's kycStatus/kycInquiryId updated as a derived cache.
 * (A production deployment would also register a Persona webhook that
 * calls this same reconciliation path; polling here keeps the scaffold
 * self-contained without requiring a public webhook endpoint yet.)
 */
export default function kycRoutes(fastify: FastifyInstance): void {
  fastify.get("/kyc/status", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    if (!personaCredentialsConfigured) {
      return reply.code(503).send({ error: "kyc_provider_not_configured" });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.userId } });
    if (!user.kycInquiryId) {
      return reply.code(404).send({ error: "no_verification_started" });
    }

    const { status } = await personaKycProvider.getVerificationStatus({ inquiryId: user.kycInquiryId });

    if (status !== user.kycStatus) {
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { kycStatus: status } }),
        prisma.kycVerificationRecord.create({
          data: { userId: user.id, inquiryId: user.kycInquiryId, status },
        }),
      ]);
    }

    return reply.code(200).send({ status });
  });
}
