import "server-only";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";
import { log } from "@/lib/log";

/**
 * Single DB entry point. Picks the driver from the environment:
 *   DATABASE_URL set   → node-postgres (Neon, Supabase, any Postgres)
 *   DATABASE_URL unset → embedded PGlite in ./.data/pglite (zero-setup local dev)
 *
 * Both return a Drizzle instance with the same query API, so nothing else in the
 * codebase knows which driver is active. Migrations run once per process on first use.
 */

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const logger = log.scope("db");

type Holder = { promise?: Promise<Db> };
const globalHolder = globalThis as unknown as { __rossaiDb?: Holder };
const holder: Holder = (globalHolder.__rossaiDb ??= {});

/** True on Cloud Run (K_SERVICE is set by the platform). */
function isCloudRun(): boolean {
  return Boolean(process.env.K_SERVICE);
}

async function createPg(): Promise<Db> {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const { Pool } = await import("pg");
  // Neon: put `?sslmode=verify-full` in DATABASE_URL; pg reads it, no `ssl` option needed.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const db = drizzle(pool, { schema });
  // Migrate on boot by default (single-instance MVP). Set DB_MIGRATE_ON_BOOT=false once
  // migrations are run from CI/deploy instead.
  if (process.env.DB_MIGRATE_ON_BOOT !== "false") {
    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  }
  logger.info("connected", { driver: "pg" });
  return db as unknown as Db;
}

async function createPglite(): Promise<Db> {
  if (isCloudRun() || (process.env.NODE_ENV === "production" && process.env.REQUIRE_DATABASE_URL === "true")) {
    // Cloud Run's filesystem is ephemeral; an embedded DB would silently lose every case.
    throw new Error("DATABASE_URL must be set in production (PGlite is for local development only)");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  // Tests set PGLITE_DATA_DIR=memory:// for a throwaway in-memory database.
  const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!dataDir.startsWith("memory://")) fs.mkdirSync(dataDir, { recursive: true }); // PGlite does not create parent dirs
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  logger.info("connected", { driver: "pglite", dataDir });
  return db as unknown as Db;
}

/** Get the shared, migrated database handle. */
export function getDb(): Promise<Db> {
  if (!holder.promise) {
    holder.promise = (process.env.DATABASE_URL ? createPg() : createPglite()).catch((err) => {
      holder.promise = undefined; // allow retry on next call
      throw err;
    });
  }
  return holder.promise;
}

export { schema };
