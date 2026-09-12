import "server-only";
import type { InboundMessage } from "@/lib/channel/types";

/**
 * CONTRACT STUB — implemented by the checklist/documents module.
 * Stores each attachment, creates Document rows, and enqueues verification.
 * Returns the created document ids.
 */
export async function ingestInboundAttachments(_caseId: string, _message: InboundMessage): Promise<string[]> {
  throw new Error("not implemented: ingestInboundAttachments");
}
