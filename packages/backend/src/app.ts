import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import authPlugin from "./plugins/auth.js";
import idempotencyPlugin from "./plugins/idempotency.js";
import { OracleDivergenceError } from "./services/pricing/pricing.service.js";
import { WalletPolicyViolationError } from "./services/wallet/turnkey-wallet-provider.js";
import { PayoutProviderNotConfiguredError } from "./services/payout/lightspark-grid-payout-provider.js";
import onboardRoutes from "./routes/onboard.route.js";
import investRoutes from "./routes/invest.route.js";
import borrowRoutes from "./routes/borrow.route.js";
import payoutRoutes from "./routes/payout.route.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  await app.register(sensible);
  await app.register(authPlugin);
  await app.register(idempotencyPlugin);

  await app.register(onboardRoutes);
  await app.register(investRoutes);
  await app.register(borrowRoutes);
  await app.register(payoutRoutes);

  app.get("/health", () => ({ status: "ok" }));

  // Central mapping from internal error types to HTTP responses — keeps
  // route handlers free of try/catch boilerplate for these known cases.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    }
    if (error instanceof OracleDivergenceError) {
      return reply.code(503).send({ error: "oracle_divergence", message: error.message });
    }
    if (error instanceof WalletPolicyViolationError) {
      return reply.code(403).send({ error: "wallet_policy_violation", message: error.message });
    }
    if (error instanceof PayoutProviderNotConfiguredError) {
      return reply.code(503).send({
        error: "payout_provider_not_configured",
        message: error.message,
      });
    }

    app.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  return app;
}
