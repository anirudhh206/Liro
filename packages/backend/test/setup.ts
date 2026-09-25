import { config } from "dotenv";
import { resolve } from "node:path";

// Loads .env.test (never .env — tests must never touch a real/production
// database or real provider credentials). See .env.test for the schema;
// it points DATABASE_URL at a local/CI Postgres instance.
config({ path: resolve(import.meta.dirname, "../.env.test") });
