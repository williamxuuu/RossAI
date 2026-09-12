import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type {
  AuditEntry,
  Case,
  CaseStatus,
  ChecklistItem,
  Client,
  Document,
  Escalation,
  Flag,
  FlagSeverity,
  Message,
} from "@/db/schema";

/**
 * Read-side queries for the paralegal console (spec §3.6). Everything returned here
 * is plain JSON (dates as ISO strings) so the same shape feeds server components,
 * client components, and the /api/cases route handlers.
 */

/** Row type with every Date column turned into an ISO string. */
export type Iso<T> = {
  [K in keyof T]: T[K] extends Date ? string : T[K] extends Date | null ? string | null : T[K];
};

export function serializeDates<T extends object>(row: T): Iso<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as Iso<T>;
}

/** Statuses that make a case visible in the review queue (ARCHITECTURE §3). */
export const QUEUE_STATUSES: readonly CaseStatus[] = ["awaiting_review", "replied"];
/** Statuses shown in the muted "In progress" panel — never in the queue. */
export const IN_PROGRESS_STATUSES: readonly CaseStatus[] = ["intake", "collecting_docs", "scanning"];

export type SeverityCounts = Record<FlagSeverity, number>;

export type QueueCase = {
  id: string;
  caseType: string | null;
  status: CaseStatus;
  /** Client's preferred language code (ISO 639-1). */
  language: string;
  openFlags: SeverityCounts;
  openEscalations: number;
  checklist: { total: number; done: number; complete: boolean };
  createdAt: string;
  updatedAt: string;
};

export type CaseDetail = {
  case: Iso<Case>;
  client: Iso<Client>;
  checklistItems: Iso<ChecklistItem>[];
  /** Bytes are never included; fetch them from GET /api/documents/:id. */
  documents: Iso<Omit<Document, "storageUrl">>[];
  flags: Iso<Flag>[];
  escalations: Iso<Escalation>[];
  messages: Iso<Message>[];
  auditEntries: Iso<AuditEntry>[];
};

type QueueRow = Case & {
  client: Client;
  flags: Pick<Flag, "severity">[];
  escalations: Pick<Escalation, "id">[];
  checklistItems: Pick<ChecklistItem, "status">[];
};

function emptyCounts(): SeverityCounts {
  return { high: 0, medium: 0, low: 0 };
}

function toQueueCase(row: QueueRow): QueueCase {
  const openFlags = row.flags.reduce((acc, f) => {
    acc[f.severity] += 1;
    return acc;
  }, emptyCounts());
  const total = row.checklistItems.length;
  const done = row.checklistItems.filter((i) => i.status === "received" || i.status === "accepted").length;
  return {
    id: row.id,
    caseType: row.caseType,
    status: row.status,
    language: row.client.preferredLanguage,
    openFlags,
    openEscalations: row.escalations.length,
    checklist: { total, done, complete: total > 0 && done === total },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listCasesByStatus(statuses: readonly CaseStatus[], order: "oldest" | "newest"): Promise<QueueCase[]> {
  const db = await getDb();
  const rows = await db.query.cases.findMany({
    where: inArray(schema.cases.status, [...statuses]),
    with: {
      client: true,
      flags: { columns: { severity: true }, where: eq(schema.flags.status, "open") },
      escalations: { columns: { id: true }, where: eq(schema.escalations.status, "open") },
      checklistItems: { columns: { status: true } },
    },
    orderBy: order === "oldest" ? [asc(schema.cases.updatedAt), asc(schema.cases.createdAt)] : [desc(schema.cases.updatedAt)],
  });
  return rows.map(toQueueCase);
}

/** Cases ready for review (checklist complete, scanned), oldest first. */
export function getQueue(): Promise<QueueCase[]> {
  return listCasesByStatus(QUEUE_STATUSES, "oldest");
}

/** Cases still in intake / collecting documents / scanning — shown outside the queue. */
export function getInProgress(): Promise<QueueCase[]> {
  return listCasesByStatus(IN_PROGRESS_STATUSES, "newest");
}

/** Everything the review view needs for one case, or null when the id is unknown. */
export async function getCaseDetail(caseId: string): Promise<CaseDetail | null> {
  const db = await getDb();
  const row = await db.query.cases.findFirst({
    where: eq(schema.cases.id, caseId),
    with: {
      client: true,
      checklistItems: { orderBy: [asc(schema.checklistItems.updatedAt)] },
      documents: { columns: { storageUrl: false }, orderBy: [asc(schema.documents.createdAt)] },
      flags: { orderBy: [asc(schema.flags.createdAt)] },
      escalations: { orderBy: [asc(schema.escalations.createdAt)] },
      messages: { orderBy: [asc(schema.messages.createdAt)] },
      auditEntries: { orderBy: [desc(schema.auditEntries.timestamp)] },
    },
  });
  if (!row) return null;
  const { client, checklistItems, documents, flags, escalations, messages, auditEntries, ...caseRow } = row;
  return {
    case: serializeDates(caseRow),
    client: serializeDates(client),
    checklistItems: checklistItems.map(serializeDates),
    documents: documents.map(serializeDates),
    flags: flags.map(serializeDates),
    escalations: escalations.map(serializeDates),
    messages: messages.map(serializeDates),
    auditEntries: auditEntries.map(serializeDates),
  };
}

/** Small helper for the copilot / other modules: a case's open flags by severity. */
export async function getOpenFlagCounts(caseId: string): Promise<SeverityCounts> {
  const db = await getDb();
  const rows = await db
    .select({ severity: schema.flags.severity })
    .from(schema.flags)
    .where(and(eq(schema.flags.caseId, caseId), eq(schema.flags.status, "open")));
  return rows.reduce((acc, r) => {
    acc[r.severity] += 1;
    return acc;
  }, emptyCounts());
}
