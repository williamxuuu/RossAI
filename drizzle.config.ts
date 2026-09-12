import { defineConfig } from "drizzle-kit";

// Migrations are generated from src/db/schema.ts into ./drizzle and applied at
// boot by src/db/client.ts (works for both PGlite and real Postgres).
// Locally (no DATABASE_URL) drizzle-kit talks to the embedded PGlite directory so
// `drizzle-kit push` / `drizzle-kit studio` work without a Postgres server.
const url = process.env.DATABASE_URL;

export default defineConfig(
  url
    ? { dialect: "postgresql", schema: "./src/db/schema.ts", out: "./drizzle", dbCredentials: { url } }
    : {
        dialect: "postgresql",
        driver: "pglite",
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dbCredentials: { url: process.env.PGLITE_DATA_DIR ?? "./.data/pglite" },
      },
);
