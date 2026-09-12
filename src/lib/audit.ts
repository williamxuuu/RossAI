import "server-only";
import { getDb, schema } from "@/db/client";
import { log } from "@/lib/log";

/**
 * Every state change in RossAI is recorded here (spec §3.6 "Every action writes an
 * AuditEntry", §4 "Human gate ... recorded in the audit log").
 *
 * `actor` is "agent" for autonomous pipeline steps or the paralegal id (Auth0 `sub`
 * or the dev user id) for human decisions.
 */
export const AGENT_ACTOR = "agent";

export type AuditAction =
  | "client.created"
  | "case.created"
  | "case.status_changed"
  | "intake.language_detected"
  | "intake.case_type_set"
  | "checklist.generated"
  | "document.received"
  | "document.accepted"
  | "document.rejected"
  | "checklist.complete"
  | "scan.started"
  | "scan.completed"
  | "flag.created"
  | "flag.approved"
  | "flag.edited"
  | "flag.rejected"
  | "flag.more_info_requested"
  | "escalation.created"
  | "escalation.draft_generated"
  | "escalation.replied"
  | "escalation.dismissed"
  | "message.received"
  | "message.sent"
  | "message.blocked"
  | "nudge.sent"
  | "jargon.explained"
  | "jargon.ungrounded"
  | "jargon.escalated";

export async function writeAudit(input: {
  caseId: string | null;
  actor: string;
  action: AuditAction;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  await db.insert(schema.auditEntries).values({
    caseId: input.caseId,
    actor: input.actor,
    action: input.action,
    payload: input.payload ?? {},
  });
  log.scope("audit").info(input.action, { caseId: input.caseId, actor: input.actor });
}
