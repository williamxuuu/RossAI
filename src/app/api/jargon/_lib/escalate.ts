import "server-only";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { writeAudit, AGENT_ACTOR } from "@/lib/audit";
import { createEscalation } from "@/lib/pipeline/escalation";
import { log } from "@/lib/log";
import type { IntakeState } from "@/db/schema";
import { safePageRef } from "./common";

/**
 * "Still confused — ask the clinic" from the extension (spec §3.2 / §3.5).
 *
 * Finds or creates the client + case the escalation hangs off, then hands the
 * escalation to the pipeline's `createEscalation()` (which tells the client a
 * human is reviewing). If that contract is not implemented yet, or throws, the
 * escalation row is inserted directly so the paralegal still sees it.
 *
 * Case creation policy (documented deviation): a case created from the
 * extension gets status "awaiting_review" so it shows up in the queue
 * immediately, with `intakeState = { step: "case_type", answers: { source: "extension" } }`
 * so intake knows nothing has been asked yet. If the client already has an open
 * (non-closed) case, the escalation attaches to that case and its status is untouched.
 */

const logger = log.scope("jargon:escalate");

/** How far back to look for an escalation row that `createEscalation()` may have inserted before throwing. */
const DEDUPE_WINDOW_MS = 15_000;

export type JargonEscalationInput = {
  text: string;
  pageUrl?: string;
  language: string;
  question?: string;
  phone?: string;
};

export type JargonEscalationResult = {
  escalationId: string;
  caseId: string;
  clientId: string;
  createdClient: boolean;
  createdCase: boolean;
  /** true when the pipeline contract handled it; false when the row was inserted directly. */
  viaContract: boolean;
};

export async function fileJargonEscalation(input: JargonEscalationInput): Promise<JargonEscalationResult> {
  const { clientId, createdClient } = await findOrCreateClient(input.phone, input.language);
  const { caseId, createdCase } = await findOrCreateCase(clientId, input.phone === undefined);
  const question = composeQuestion(input);
  const { escalationId, viaContract } = await fileEscalation(caseId, question);
  return { escalationId, caseId, clientId, createdClient, createdCase, viaContract };
}

/** The paralegal needs the term the client was stuck on, not just their free-text question. */
export function composeQuestion(input: Pick<JargonEscalationInput, "text" | "question" | "pageUrl">): string {
  const term = input.text.replace(/\s+/g, " ").trim();
  const where = safePageRef(input.pageUrl);
  const q = input.question?.trim();
  const head = q ? `${q}\n\nSelected text: "${term}"` : `Client asked for help understanding: "${term}"`;
  return where ? `${head}\nPage: ${where}` : head;
}

async function findOrCreateClient(phone: string | undefined, language: string): Promise<{ clientId: string; createdClient: boolean }> {
  const db = await getDb();
  if (phone) {
    const existing = await db.query.clients.findFirst({ where: eq(schema.clients.phone, phone) });
    if (existing) return { clientId: existing.id, createdClient: false };
    // Race-safe: a concurrent insert for the same phone loses on the unique index; re-read.
    const inserted = await db
      .insert(schema.clients)
      .values({ phone, preferredLanguage: language })
      .onConflictDoNothing({ target: schema.clients.phone })
      .returning({ id: schema.clients.id });
    if (inserted.length === 0) {
      const again = await db.query.clients.findFirst({ where: eq(schema.clients.phone, phone) });
      if (!again) throw new Error("client upsert failed");
      return { clientId: again.id, createdClient: false };
    }
    await writeAudit({ caseId: null, actor: AGENT_ACTOR, action: "client.created", payload: { clientId: inserted[0].id, source: "extension", language } });
    return { clientId: inserted[0].id, createdClient: true };
  }
  // Anonymous: no phone, no email. The paralegal sees the question; nobody can be texted back.
  const [anon] = await db.insert(schema.clients).values({ phone: null, email: null, preferredLanguage: language }).returning({ id: schema.clients.id });
  await writeAudit({ caseId: null, actor: AGENT_ACTOR, action: "client.created", payload: { clientId: anon.id, source: "extension", anonymous: true, language } });
  return { clientId: anon.id, createdClient: true };
}

async function findOrCreateCase(clientId: string, anonymous: boolean): Promise<{ caseId: string; createdCase: boolean }> {
  const db = await getDb();
  const open = await db.query.cases.findFirst({
    where: and(eq(schema.cases.clientId, clientId), ne(schema.cases.status, "closed")),
    orderBy: [desc(schema.cases.updatedAt)],
  });
  if (open) return { caseId: open.id, createdCase: false };

  const intakeState: IntakeState = { step: "case_type", answers: anonymous ? { source: "extension", anonymous: "true" } : { source: "extension" } };
  const [created] = await db
    .insert(schema.cases)
    .values({ clientId, caseType: null, status: "awaiting_review", intakeState })
    .returning({ id: schema.cases.id });
  await writeAudit({
    caseId: created.id,
    actor: AGENT_ACTOR,
    action: "case.created",
    payload: { clientId, source: "extension", status: "awaiting_review", anonymous },
  });
  return { caseId: created.id, createdCase: true };
}

async function fileEscalation(caseId: string, question: string): Promise<{ escalationId: string; viaContract: boolean }> {
  try {
    const { escalationId } = await createEscalation({ caseId, question, reason: "client_requested", draftCitation: null });
    return { escalationId, viaContract: true };
  } catch (err) {
    logger.warn("createEscalation contract failed; inserting escalation directly", { caseId, err: String(err) });
  }
  const db = await getDb();
  // The contract may have inserted the row before failing later (e.g. while texting the client).
  const recent = await db.query.escalations.findFirst({
    where: and(
      eq(schema.escalations.caseId, caseId),
      eq(schema.escalations.question, question),
      gt(schema.escalations.createdAt, new Date(Date.now() - DEDUPE_WINDOW_MS)),
    ),
    orderBy: [desc(schema.escalations.createdAt)],
  });
  if (recent) return { escalationId: recent.id, viaContract: false };

  const [row] = await db
    .insert(schema.escalations)
    .values({ caseId, question, reason: "client_requested", draftReply: null, draftCitation: null })
    .returning({ id: schema.escalations.id });
  await writeAudit({
    caseId,
    actor: AGENT_ACTOR,
    action: "escalation.created",
    payload: { escalationId: row.id, reason: "client_requested", source: "extension", direct: true },
  });
  return { escalationId: row.id, viaContract: false };
}
