import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { isLlmConfigured } from "@/lib/llm/client";
import { isExaConfigured } from "@/lib/grounding/exa";
import { getChannelProvider } from "@/lib/channel";
import { isTriggerConfigured } from "@/lib/jobs";
import { isAuthDisabled } from "@/lib/auth";
import { log } from "@/lib/log";

/**
 * GET /api/health — liveness + configuration summary for Cloud Run and operators.
 *
 * Reports WHICH backends are active, never their values: only booleans and enum
 * strings leave this handler (src/app/api/health/route.test.ts asserts no env
 * value appears in the body). Public in src/proxy.ts (no paralegal session).
 */

const logger = log.scope("health");

export type HealthReport = {
  ok: boolean;
  db: "pglite" | "pg";
  llm: boolean;
  exa: boolean;
  channel: string;
  jobs: "trigger" | "inline";
  auth: "auth0" | "disabled";
  storage: "local" | "gcs";
  warnings: string[];
  error?: "db unreachable";
};

function dbDriver(): HealthReport["db"] {
  return process.env.DATABASE_URL ? "pg" : "pglite";
}

function storageProvider(): HealthReport["storage"] {
  return process.env.STORAGE_PROVIDER === "gcs" ? "gcs" : "local";
}

/** Production misconfigurations that would silently lose data (docs/DEPLOY.md). */
function collectWarnings(): string[] {
  const warnings: string[] = [];
  const prod = process.env.NODE_ENV === "production";
  const onCloudRun = Boolean(process.env.K_SERVICE);
  if (prod && dbDriver() === "pglite") warnings.push("pglite in production");
  if (onCloudRun && storageProvider() === "local") warnings.push("local document storage on Cloud Run");
  if (prod && !isTriggerConfigured()) warnings.push("jobs run inline in production");
  return warnings;
}

async function channelName(): Promise<string> {
  try {
    return (await getChannelProvider()).name;
  } catch (err) {
    logger.warn("channel provider failed to initialise", { err: String(err) });
    return (process.env.CHANNEL_PROVIDER ?? "mock").toLowerCase();
  }
}

/** Trivial round-trip; migrations run on first getDb() so this also proves the schema is in place. */
async function dbReachable(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    logger.error("db check failed", { err: String(err) });
    return false;
  }
}

export async function GET(): Promise<NextResponse<HealthReport>> {
  const [dbOk, channel] = await Promise.all([dbReachable(), channelName()]);
  const report: HealthReport = {
    ok: dbOk,
    db: dbDriver(),
    llm: isLlmConfigured(),
    exa: isExaConfigured(),
    channel,
    jobs: isTriggerConfigured() ? "trigger" : "inline",
    auth: isAuthDisabled() ? "disabled" : "auth0",
    storage: storageProvider(),
    warnings: collectWarnings(),
    ...(dbOk ? {} : { error: "db unreachable" as const }),
  };
  return NextResponse.json(report, { status: dbOk ? 200 : 503, headers: { "cache-control": "no-store" } });
}
