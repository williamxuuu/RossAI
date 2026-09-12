import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { devGuard } from "../_lib/guard";

/** Clear client-visible message history while preserving cases, documents, and review data. */
export async function POST(): Promise<Response> {
  const blocked = devGuard();
  if (blocked) return blocked;
  const db = await getDb();
  await db.delete(schema.messages);
  return NextResponse.json({ ok: true });
}
