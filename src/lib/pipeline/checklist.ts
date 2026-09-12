import "server-only";
/** CONTRACT STUB — implemented by the checklist module. See spec §3.3. */
export async function processInboundAttachment(_documentId: string): Promise<void> {
  throw new Error("not implemented: processInboundAttachment");
}
export async function nudgePending(_caseId?: string): Promise<void> {
  throw new Error("not implemented: nudgePending");
}
/** Generate + persist the required-document list for a case (spec §3.3). Returns the items. */
export async function generateChecklist(_caseId: string): Promise<import("@/db/schema").ChecklistItem[]> {
  throw new Error("not implemented: generateChecklist");
}
