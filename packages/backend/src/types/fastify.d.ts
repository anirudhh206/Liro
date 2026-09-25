import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** ADR-7: set only by the auth plugin, from a verified session token. Never trust a client-supplied userId. */
    userId: string;
  }
}
