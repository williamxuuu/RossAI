import "server-only";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Case } from "@/db/schema";

/**
 * The code that links a client's email to their case.
 *
 * The problem it solves: intake happens over SMS, keyed by phone number, but
 * documents arrive by email (docs/ARCHITECTURE.md §8) — and a client emails from
 * whatever address they have, which the clinic has never seen. Without a link, a
 * packet of documents opens a second, empty case and the real one sits waiting.
 *
 * So the checklist text gives the client a short code and asks them to keep it in the
 * subject line. Email intake looks for it in the subject and the body, and once an
 * address has been matched once it is stored on the client, so later emails need no
 * code at all.
 *
 * The code is the first six hex characters of the case id rather than a new column:
 * it needs no migration, it cannot drift out of sync with the case, and it is
 * verifiable by eye against the URL a paralegal is looking at. Two cases could in
 * principle share a prefix (1 in 16.7 million); `findCaseByCode` resolves that by
 * preferring the open case, and worst case a paralegal sees a document on a case that
 * is about to be closed rather than losing it.
 */

const PREFIX = "RA";
const CODE_LENGTH = 6;

export function caseCode(caseId: string): string {
  return `${PREFIX}-${caseId.replace(/-/g, "").slice(0, CODE_LENGTH).toUpperCase()}`;
}

// Case-insensitive: a client retyping the code, or a mail client lower-casing a
// subject line, must not lose their documents.
const CODE_RE = new RegExp(`\\b${PREFIX}[-\\s]?([0-9a-fA-F]{${CODE_LENGTH}})\\b`, "i");

/** Find a case code anywhere in a subject line or message body. */
export function extractCaseCode(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const m = CODE_RE.exec(text);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** The case a code points at: the open one if several share the prefix, else the newest. */
export async function findCaseByCode(hexPrefix: string): Promise<Case | undefined> {
  const db = await getDb();
  const pattern = `${hexPrefix.toLowerCase()}%`;
  const open = await db.query.cases.findFirst({
    where: and(sql`replace(${schema.cases.id}::text, '-', '') like ${pattern}`, ne(schema.cases.status, "closed")),
    orderBy: [desc(schema.cases.updatedAt)],
  });
  if (open) return open;
  return db.query.cases.findFirst({
    where: sql`replace(${schema.cases.id}::text, '-', '') like ${pattern}`,
    orderBy: [desc(schema.cases.updatedAt)],
  });
}

/** Remember the address a matched email came from, so the next one needs no code. */
export async function rememberClientEmail(clientId: string, email: string): Promise<void> {
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client || client.email) return;
  await db.update(schema.clients).set({ email: email.trim().toLowerCase() }).where(eq(schema.clients.id, clientId));
}
