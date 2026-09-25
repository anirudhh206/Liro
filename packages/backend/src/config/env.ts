import { z } from "zod";

/**
 * ADR-9: the only place process.env is read directly. Every other module
 * imports `env` from here, already validated and typed — a missing or
 * malformed secret fails fast at boot, not mid-request.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  SESSION_JWT_SECRET: z.string().min(32, "SESSION_JWT_SECRET must be at least 32 characters"),

  DATABASE_URL: z.string().url(),

  SOLANA_RPC_URL: z.string().url(),
  PYTH_HERMES_URL: z.string().url(),
  JUPITER_SWAP_API_URL: z.string().url(),

  TURNKEY_API_BASE_URL: z.string().url(),
  TURNKEY_ORGANIZATION_ID: z.string().min(1),
  TURNKEY_API_PUBLIC_KEY: z.string().min(1),
  TURNKEY_API_PRIVATE_KEY: z.string().min(1),

  GRID_CLIENT_ID: z.string().optional(),
  GRID_CLIENT_SECRET: z.string().optional(),
  GRID_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),

  IP_GEOLOCATION_API_URL: z.string().url().optional(),
  IP_GEOLOCATION_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

/** True once real Grid sandbox credentials exist (ADR-3 named blocker). */
export const gridCredentialsConfigured = Boolean(env.GRID_CLIENT_ID && env.GRID_CLIENT_SECRET);
