import { NextResponse } from "next/server";
import { getDb, schema } from "@/db/client";
import { devGuard } from "../_lib/guard";

/** Set the local demo's client language to English for a consistent presentation. */
export async function POST(): Promise<Response> {
  const blocked = devGuard();
  if (blocked) return blocked;
  const db = await getDb();
  await db.update(schema.clients).set({ preferredLanguage: "en" });
  return NextResponse.json({ ok: true, language: "en" });
}
