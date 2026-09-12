import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { resetChannelProvider } from "@/lib/channel";
import { log } from "@/lib/log";
import { devGuard } from "../_lib/guard";

/**
 * POST /api/dev/reset — empty the database so the demo can be run again.
 *
 * Deletes clients (cases, documents, flags, messages and escalations cascade) and the
 * audit entries that are not attached to a case. Stored document bytes are left on
 * disk: they are keyed by uuid, nothing points at them any more, and `rm -rf .data`
 * (npm run db:reset) is the way to clear those.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const blocked = devGuard();
  if (blocked) return blocked;
  const db = await getDb();
  await db.delete(schema.clients);
  await db.delete(schema.auditEntries);
  resetChannelProvider();
  log.scope("dev:reset").info("database cleared");
  return NextResponse.json({ ok: true });
}
