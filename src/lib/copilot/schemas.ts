/**
 * Zod schemas and JSON shapes shared by the copilot's server tools, the
 * frontend renderers, and the HITL gates. This file has no "server-only"
 * import on purpose: the client passes the same schemas to useRenderTool /
 * useHumanInTheLoop so the tool-call arguments are typed identically on both
 * sides.
 */
import { z } from "zod";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const SEVERITIES = ["high", "medium", "low"] as const;
export const FLAG_STATUSES = ["open", "approved", "edited", "rejected"] as const;
export const ESCALATION_STATUSES = ["open", "replied", "dismissed"] as const;

// ---------- server tool parameters ----------

const caseId = z.string().describe("Case id (uuid) — take it from the case context");
const flagId = z.string().describe("Flag id (uuid) from listFlags or the case context");
const escalationId = z.string().describe("Escalation id (uuid) from listEscalations or the case context");
const documentId = z.string().describe("Document id (uuid) from the case context");

export const CaseIdParams = z.object({ caseId });
export const ListFlagsParams = z.object({
  caseId,
  severity: z.enum(SEVERITIES).optional().describe("Only return flags of this severity"),
});
export const FlagIdParams = z.object({ flagId });
export const EscalationIdParams = z.object({ escalationId });
export const DocumentIdParams = z.object({ documentId });

// ---------- frontend (HITL) tool parameters ----------

export const FLAG_DECISIONS = ["approve", "edit", "reject", "request_more_info"] as const;
export type FlagDecision = (typeof FLAG_DECISIONS)[number];

export const ProposeFlagDecisionParams = z.object({
  flagId,
  decision: z.enum(FLAG_DECISIONS).describe("The decision you propose; the paralegal confirms or changes it"),
  editedText: z.string().optional().describe("Replacement fix text when decision is 'edit'"),
  requestText: z.string().optional().describe("What to ask the client for when decision is 'request_more_info'"),
  rationale: z.string().optional().describe("One sentence on why, shown to the paralegal"),
});
export type ProposeFlagDecisionArgs = z.infer<typeof ProposeFlagDecisionParams>;

export const ProposeReplyParams = z.object({
  escalationId,
  englishText: z
    .string()
    .describe("Plain-English draft reply for the paralegal to approve. Explain only; no eligibility or strategy."),
});
export type ProposeReplyArgs = z.infer<typeof ProposeReplyParams>;

export const FocusFlagParams = z.object({ flagId });
export type FocusFlagArgs = z.infer<typeof FocusFlagParams>;

// ---------- tool result shapes (JSON only; the client re-parses them) ----------

export const CitationSchema = z.object({
  title: z.string(),
  url: z.string(),
  quote: z.string(),
  retrievedAt: z.string(),
});
export type CitationJson = z.infer<typeof CitationSchema>;

export const FlagSummarySchema = z.object({
  id: z.string(),
  caseId: z.string(),
  fieldRef: z.string(),
  severity: z.enum(SEVERITIES),
  description: z.string(),
  proposedFix: z.string(),
  citation: CitationSchema,
  status: z.enum(FLAG_STATUSES),
  editedText: z.string().nullable(),
  evidenceDocumentIds: z.array(z.string()),
});
export type FlagSummary = z.infer<typeof FlagSummarySchema>;

export const ToolErrorSchema = z.object({ error: z.string(), message: z.string() });
export type ToolError = z.infer<typeof ToolErrorSchema>;

export const ListFlagsResultSchema = z.union([
  ToolErrorSchema,
  z.object({
    caseId: z.string(),
    severity: z.enum(SEVERITIES).nullable(),
    count: z.number(),
    flags: z.array(FlagSummarySchema),
  }),
]);
export type ListFlagsResult = z.infer<typeof ListFlagsResultSchema>;

// ---------- case context registered with useAgentContext ----------
// Plain `type` aliases (not interfaces) so they satisfy CopilotKit's JsonSerializable.

export type ContextFlag = {
  id: string;
  fieldRef: string;
  severity: (typeof SEVERITIES)[number];
  status: (typeof FLAG_STATUSES)[number];
  description: string;
  proposedFix: string;
  citationTitle: string;
  citationUrl: string;
};

export type ContextEscalation = {
  id: string;
  question: string;
  reason: string;
  status: (typeof ESCALATION_STATUSES)[number];
  hasDraft: boolean;
  createdAt: string;
};

export type ContextDocument = {
  id: string;
  name: string;
  checklistItemId: string | null;
  verifiedType: string | null;
  legibilityOk: boolean | null;
  docType: string | null;
};

export type ContextChecklistItem = {
  id: string;
  docName: string;
  status: "pending" | "received" | "rejected" | "accepted";
};

export type CaseContext = {
  caseId: string;
  caseType: string | null;
  caseTypeLabel: string;
  status: string;
  clientLanguage: string;
  clientLanguageName: string;
  checklist: {
    total: number;
    received: number;
    accepted: number;
    pending: number;
    rejected: number;
    items: ContextChecklistItem[];
  };
  counts: {
    openFlags: number;
    highFlags: number;
    openEscalations: number;
    documents: number;
  };
  flags: ContextFlag[];
  escalations: ContextEscalation[];
  documents: ContextDocument[];
  generatedAt: string;
};
