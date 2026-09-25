import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../config/env.js";

const secretKey = new TextEncoder().encode(env.SESSION_JWT_SECRET);
const ISSUER = "liro-backend";
const AUDIENCE = "liro-client";

/**
 * ADR-7: issued once at onboarding, after the wallet provider (ADR-1)
 * confirms the user's embedded-wallet identity. Every other endpoint
 * verifies this token and derives userId from it — the body/query/params
 * are never trusted for identity.
 */
export async function issueSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secretKey);
}

async function verifySessionToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secretKey, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Session token missing subject claim");
  }
  return payload.sub;
}

async function authPreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing_bearer_token" });
  }

  const token = header.slice("Bearer ".length);
  try {
    request.userId = await verifySessionToken(token);
  } catch {
    return reply.code(401).send({ error: "invalid_session_token" });
  }
}

/**
 * Registers `authPreHandler` as a decorator so routes opt in explicitly
 * (`preHandler: [fastify.authenticate]`) rather than applying auth globally
 * and special-casing the onboarding route that issues the first token.
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate("authenticate", authPreHandler);
});

declare module "fastify" {
  interface FastifyInstance {
    authenticate: typeof authPreHandler;
  }
}
