import { PrismaClient } from "@prisma/client";

/**
 * Single shared Prisma client. Fastify's lifecycle hooks close this on
 * shutdown (see app.ts) so connections don't leak between hot reloads.
 */
export const prisma = new PrismaClient();
