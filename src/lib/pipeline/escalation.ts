import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Citation, Escalation } from "@/db/schema";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { log } from "@/lib/log";
import { sendTemplate } from "./reply";

/**
 * Escalations (spec §3.5).
 *
 * Anything the agent may not answer becomes a row a paralegal sees in the console.
 * Creating one is deliberately cheap and never fails the caller: the row is written
 * first, and only then does the client get the clinic's "a human is reviewing"
 * text. If that text cannot be sent, the escalation still exists.
 */

const logger = log.scope("escalation");

export type EscalationReason = "judgment" | "ungrounded" | "grounded_pending_approval" | "client_requested";

export type CreateEscalationInput = {
  caseId: string;
  question: string;
  /**
   * judgment                  – the question needs legal judgment (eligibility, strategy, "what should I do")
   * ungrounded                – no USCIS source supported an answer
   * grounded_pending_approval – a grounded draft exists but AUTO_SEND_GROUNDED_ANSWERS is off
   * client_requested          – the client pressed "still confused — ask the clinic"
   */
  reason: EscalationReason;
  sourceMessageId?: string;
  draftReply?: string;
  draftCitation?: Citation | null;
  /** Skip the "a human is reviewing" text (the caller already replied, or there is no channel). */
  notifyClient?: boolean;
};

/** How close together two identical questions count as the same escalation. */
const DEDUPE_WINDOW_MS = 5 * 60_000;

export async function createEscalation(input: CreateEscalationInput): Promise<{ escalationId: string; deduped: boolean }> {
  const db = await getDb();
  const question = input.question.trim();
  if (!question) throw new Error("createEscalation requires a question");

  const existing = await findRecentDuplicate(input.caseId, question);
  if (existing) {
    logger.info("duplicate escalation ignored", { caseId: input.caseId, escalationId: existing.id });
    return { escalationId: existing.id, deduped: true };
  }

  const [row] = await db
    .insert(schema.escalations)
    .values({
      caseId: input.caseId,
      sourceMessageId: input.sourceMessageId ?? null,
      question,
      reason: input.reason,
      draftReply: input.draftReply ?? null,
      draftCitation: input.draftCitation ?? null,
    })
    .returning({ id: schema.escalations.id });

  await writeAudit({
    caseId: input.caseId,
    actor: AGENT_ACTOR,
    action: "escalation.created",
    payload: {
      escalationId: row.id,
      reason: input.reason,
      sourceMessageId: input.sourceMessageId ?? null,
      hasDraft: Boolean(input.draftReply),
      citationUrl: input.draftCitation?.url ?? null,
    },
  });

  if (input.draftReply) {
    await writeAudit({
      caseId: input.caseId,
      actor: AGENT_ACTOR,
      action: "escalation.draft_generated",
      payload: { escalationId: row.id, citationUrl: input.draftCitation?.url ?? null },
    });
  }

  if (input.notifyClient !== false) {
    try {
      await sendTemplate({ caseId: input.caseId, template: "escalation.human_reviewing" });
    } catch (err) {
      // The escalation is what matters; a texting failure must not lose the question.
      logger.warn("could not tell the client a human is reviewing", { caseId: input.caseId, err: String(err) });
    }
  }

  return { escalationId: row.id, deduped: false };
}

async function findRecentDuplicate(caseId: string, question: string): Promise<Escalation | undefined> {
  const db = await getDb();
  const recent = await db.query.escalations.findFirst({
    where: and(eq(schema.escalations.caseId, caseId), eq(schema.escalations.question, question), eq(schema.escalations.status, "open")),
    orderBy: [desc(schema.escalations.createdAt)],
  });
  if (!recent) return undefined;
  return Date.now() - recent.createdAt.getTime() < DEDUPE_WINDOW_MS ? recent : undefined;
}
