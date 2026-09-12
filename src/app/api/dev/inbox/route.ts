import { NextResponse } from "next/server";
import { and, asc, desc, eq, ne, or } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { devGuard } from "../_lib/guard";

/**
 * GET /api/dev/inbox?from=<phone|email> — the client's own view of the thread.
 *
 * This is what the client would see on their phone: their messages and the clinic's
 * replies, nothing else. The case status and checklist progress are included so the
 * simulator can show what the agent is waiting for without opening the console.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const blocked = devGuard();
  if (blocked) return blocked;

  const from = new URL(req.url).searchParams.get("from")?.trim();
  if (!from) return NextResponse.json({ error: "from is required" }, { status: 400 });

  const db = await getDb();
  const client = await db.query.clients.findFirst({
    where: or(eq(schema.clients.phone, from), eq(schema.clients.email, from.toLowerCase())),
    orderBy: [desc(schema.clients.createdAt)],
  });
  if (!client) return NextResponse.json({ client: null, case: null, messages: [], checklist: [] });

  const kase = await db.query.cases.findFirst({
    where: and(eq(schema.cases.clientId, client.id), ne(schema.cases.status, "closed")),
    orderBy: [desc(schema.cases.updatedAt)],
  });

  const messages = kase
    ? await db.query.messages.findMany({ where: eq(schema.messages.caseId, kase.id), orderBy: [asc(schema.messages.createdAt)] })
    : [];
  const checklist = kase
    ? await db.query.checklistItems.findMany({
        where: eq(schema.checklistItems.caseId, kase.id),
        orderBy: [asc(schema.checklistItems.updatedAt)],
      })
    : [];

  return NextResponse.json({
    client: { id: client.id, phone: client.phone, email: client.email, preferredLanguage: client.preferredLanguage },
    case: kase ? { id: kase.id, caseType: kase.caseType, status: kase.status } : null,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      channel: m.channel,
      body: m.body,
      subject: m.subject,
      language: m.language,
      approvedBy: m.approvedBy,
      createdAt: m.createdAt.toISOString(),
    })),
    checklist: checklist.map((c) => ({ id: c.id, docName: c.docName, status: c.status, rejectionReason: c.rejectionReason })),
  });
}
