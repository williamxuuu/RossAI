import "server-only";
import type { Citation } from "@/db/schema";

/**
 * CONTRACT STUB — implemented by the intake/escalation/reply module (spec §3.5).
 * Creates an Escalation row, tells the client a human is reviewing (template), audits.
 */
export async function createEscalation(_input: {
  caseId: string;
  question: string;
  /**
   * judgment                  – the question needs legal judgment (eligibility, strategy, "what should I do")
   * ungrounded                – no USCIS source supported an answer
   * grounded_pending_approval – a grounded draft exists but AUTO_SEND_GROUNDED_ANSWERS is off
   * client_requested          – the client pressed "still confused — ask the clinic"
   */
  reason: "judgment" | "ungrounded" | "grounded_pending_approval" | "client_requested";
  sourceMessageId?: string;
  draftReply?: string;
  draftCitation?: Citation | null;
}): Promise<{ escalationId: string }> {
  throw new Error("not implemented: createEscalation");
}
