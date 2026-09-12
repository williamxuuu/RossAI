import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import type { Case, Escalation, Flag } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { enqueue, type JobPayloads } from "@/lib/jobs";
import { log } from "@/lib/log";
import { sendApproved } from "@/lib/pipeline/reply";

/**
 * Paralegal console actions (spec §3.6). Route handlers under src/app/api/cases are
 * thin wrappers over these functions so the business rules live in one place:
 *
 *  - every state change writes an audit entry with the paralegal as actor
 *  - free text reaches the client only through sendApproved() (human gate, spec §4)
 *  - unknown ids → 404, illegal transitions → 400 (as ConsoleActionError)
 */

const logger = log.scope("console");

export class ConsoleActionError extends Error {
  constructor(
    public readonly status: 400 | 404 | 502,
    message: string,
  ) {
    super(message);
    this.name = "ConsoleActionError";
  }
}

// ---------- request schemas (shared with the route handlers) ----------

export const flagDecisionSchema = z
  .object({
    decision: z.enum(["approve", "edit", "reject", "request_more_info"]),
    editedText: z.string().trim().min(1).max(4000).optional(),
    requestText: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "edit" && !v.editedText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["editedText"], message: "editedText is required for edit" });
    }
    if (v.decision === "request_more_info" && !v.requestText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["requestText"], message: "requestText is required for request_more_info" });
    }
  });

export type FlagDecision = z.infer<typeof flagDecisionSchema>;

export const escalationReplySchema = z.object({
  englishText: z.string().trim().min(1).max(4000),
});

// ---------- lookups ----------

async function requireCase(caseId: string): Promise<Case> {
  const db = await getDb();
  const row = await db.query.cases.findFirst({ where: eq(schema.cases.id, caseId) });
  if (!row) throw new ConsoleActionError(404, "case not found");
  return row;
}

async function requireFlag(flagId: string, caseId?: string): Promise<Flag> {
  const db = await getDb();
  const row = await db.query.flags.findFirst({ where: eq(schema.flags.id, flagId) });
  if (!row || (caseId && row.caseId !== caseId)) throw new ConsoleActionError(404, "flag not found");
  return row;
}

async function requireEscalation(escalationId: string, caseId?: string): Promise<Escalation> {
  const db = await getDb();
  const row = await db.query.escalations.findFirst({ where: eq(schema.escalations.id, escalationId) });
  if (!row || (caseId && row.caseId !== caseId)) throw new ConsoleActionError(404, "escalation not found");
  return row;
}

async function touchCase(caseId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.cases).set({ updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
}

/**
 * After a paralegal's approved text goes out, the case moves awaiting_review → replied
 * (spec §2). Idempotent: if reply.ts already advanced the status nothing happens.
 */
async function markRepliedIfAwaiting(caseId: string, paralegalId: string): Promise<void> {
  const db = await getDb();
  const current = await requireCase(caseId);
  if (current.status !== "awaiting_review") return;
  await db.update(schema.cases).set({ status: "replied", updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
  await writeAudit({
    caseId,
    actor: paralegalId,
    action: "case.status_changed",
    payload: { from: "awaiting_review", to: "replied" },
  });
}

// ---------- flags ----------

export type DecideFlagInput = FlagDecision & {
  flagId: string;
  paralegalId: string;
  /** When given, the flag must belong to this case (route-level consistency check). */
  caseId?: string;
};

export type DecideFlagResult = {
  flag: Flag;
  /** Present for request_more_info when the message went out. */
  messageId?: string;
  /** Present for request_more_info when sending failed; the flag stays open. */
  sendError?: string;
};

/** Approve / edit / reject a flag, or ask the client for more information. */
export async function decideFlag(input: DecideFlagInput): Promise<DecideFlagResult> {
  const flag = await requireFlag(input.flagId, input.caseId);
  const kase = await requireCase(flag.caseId);
  if (kase.status === "closed") throw new ConsoleActionError(400, "case is closed");
  if (flag.status !== "open") throw new ConsoleActionError(400, `flag is already ${flag.status}`);

  if (input.decision === "request_more_info") return requestMoreInfo(flag, input);
  return resolveFlag(flag, input);
}

async function resolveFlag(flag: Flag, input: DecideFlagInput): Promise<DecideFlagResult> {
  const db = await getDb();
  const status = input.decision === "approve" ? "approved" : input.decision === "edit" ? "edited" : "rejected";
  const editedText = input.decision === "edit" ? (input.editedText ?? null) : null;
  const [updated] = await db
    .update(schema.flags)
    .set({ status, editedText, resolvedBy: input.paralegalId, resolvedAt: new Date() })
    .where(eq(schema.flags.id, flag.id))
    .returning();
  await touchCase(flag.caseId);
  await writeAudit({
    caseId: flag.caseId,
    actor: input.paralegalId,
    action: status === "approved" ? "flag.approved" : status === "edited" ? "flag.edited" : "flag.rejected",
    payload: { flagId: flag.id, fieldRef: flag.fieldRef, severity: flag.severity, ...(editedText ? { editedText } : {}) },
  });
  return { flag: updated };
}

async function requestMoreInfo(flag: Flag, input: DecideFlagInput): Promise<DecideFlagResult> {
  const requestText = input.requestText ?? "";
  let messageId: string | undefined;
  let sendError: string | undefined;
  try {
    const sent = await sendApproved({
      caseId: flag.caseId,
      paralegalId: input.paralegalId,
      englishText: requestText,
      flagId: flag.id,
    });
    messageId = sent.messageId;
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err);
    logger.warn("request_more_info send failed", { flagId: flag.id, error: sendError });
  }
  await writeAudit({
    caseId: flag.caseId,
    actor: input.paralegalId,
    action: "flag.more_info_requested",
    payload: {
      flagId: flag.id,
      fieldRef: flag.fieldRef,
      requestText,
      sent: Boolean(messageId),
      ...(messageId ? { messageId } : {}),
      ...(sendError ? { error: sendError } : {}),
    },
  });
  if (messageId) {
    await touchCase(flag.caseId);
    await markRepliedIfAwaiting(flag.caseId, input.paralegalId);
  }
  return { flag, messageId, sendError };
}

// ---------- escalations ----------

/** Send the paralegal's approved English reply to the client (translated by reply.ts). */
export async function replyEscalation(input: {
  escalationId: string;
  paralegalId: string;
  englishText: string;
  caseId?: string;
}): Promise<{ messageId: string; escalation: Escalation }> {
  const escalation = await requireEscalation(input.escalationId, input.caseId);
  const kase = await requireCase(escalation.caseId);
  if (kase.status === "closed") throw new ConsoleActionError(400, "case is closed");
  if (escalation.status !== "open") throw new ConsoleActionError(400, `escalation is already ${escalation.status}`);

  let messageId: string;
  try {
    ({ messageId } = await sendApproved({
      caseId: escalation.caseId,
      paralegalId: input.paralegalId,
      englishText: input.englishText,
      escalationId: escalation.id,
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("escalation reply send failed", { escalationId: escalation.id, error: message });
    throw new ConsoleActionError(502, `could not send reply: ${message}`);
  }

  const db = await getDb();
  const [updated] = await db
    .update(schema.escalations)
    .set({ status: "replied", replyMessageId: messageId })
    .where(eq(schema.escalations.id, escalation.id))
    .returning();
  await writeAudit({
    caseId: escalation.caseId,
    actor: input.paralegalId,
    action: "escalation.replied",
    payload: { escalationId: escalation.id, messageId, englishText: input.englishText },
  });
  await touchCase(escalation.caseId);
  await markRepliedIfAwaiting(escalation.caseId, input.paralegalId);
  return { messageId, escalation: updated };
}

/** Close an escalation without replying (e.g. the question was answered elsewhere). */
export async function dismissEscalation(input: {
  escalationId: string;
  paralegalId: string;
  caseId?: string;
}): Promise<{ escalation: Escalation }> {
  const escalation = await requireEscalation(input.escalationId, input.caseId);
  if (escalation.status !== "open") throw new ConsoleActionError(400, `escalation is already ${escalation.status}`);
  const db = await getDb();
  const [updated] = await db
    .update(schema.escalations)
    .set({ status: "dismissed" })
    .where(eq(schema.escalations.id, escalation.id))
    .returning();
  await writeAudit({
    caseId: escalation.caseId,
    actor: input.paralegalId,
    action: "escalation.dismissed",
    payload: { escalationId: escalation.id },
  });
  await touchCase(escalation.caseId);
  return { escalation: updated };
}

// ---------- case-level actions ----------

export async function closeCase(input: { caseId: string; paralegalId: string }): Promise<{ case: Case }> {
  const kase = await requireCase(input.caseId);
  if (kase.status === "closed") throw new ConsoleActionError(400, "case is already closed");
  const db = await getDb();
  const [updated] = await db
    .update(schema.cases)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(schema.cases.id, kase.id))
    .returning();
  await writeAudit({
    caseId: kase.id,
    actor: input.paralegalId,
    action: "case.status_changed",
    payload: { from: kase.status, to: "closed" },
  });
  return { case: updated };
}

/** Ask the checklist pipeline to remind the client about anything still pending. */
export async function nudgeCase(input: { caseId: string; paralegalId: string }): Promise<void> {
  const kase = await requireCase(input.caseId);
  if (kase.status === "closed") throw new ConsoleActionError(400, "case is closed");
  await runJob("nudge-pending", { caseId: kase.id });
}

/** Re-run the packet scan. Only meaningful once the checklist is complete. */
export async function rescanCase(input: { caseId: string; paralegalId: string }): Promise<void> {
  const kase = await requireCase(input.caseId);
  if (kase.status === "closed") throw new ConsoleActionError(400, "case is closed");
  if (kase.status === "intake" || kase.status === "collecting_docs") {
    throw new ConsoleActionError(400, "checklist is not complete yet");
  }
  await writeAudit({
    caseId: kase.id,
    actor: input.paralegalId,
    action: "scan.started",
    payload: { source: "console", previousStatus: kase.status },
  });
  await runJob("scan-case", { caseId: kase.id });
}

async function runJob<N extends "nudge-pending" | "scan-case">(name: N, payload: JobPayloads[N]): Promise<void> {
  try {
    await enqueue(name, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("job failed", { name, error: message });
    throw new ConsoleActionError(502, `${name} failed: ${message}`);
  }
}
