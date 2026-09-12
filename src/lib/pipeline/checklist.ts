import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Case, ChecklistItem } from "@/db/schema";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { checklistTemplateFor, localizedDocName, renderChecklistList } from "@/lib/casetypes/checklists";
import { isCaseType } from "@/lib/casetypes";
import { curatedCitation } from "@/lib/grounding/catalog";
import { enqueue } from "@/lib/jobs";
import { log } from "@/lib/log";
import { getCase, setCaseStatus } from "./cases";
import { rejectionReason } from "./rejections";
import { sendTemplate } from "./reply";
import { verifyDocument } from "./verify";

/**
 * The document-collection loop (spec §3.3).
 *
 *   generateChecklist()         curated list for the case type, each item cited
 *   processInboundAttachment()  verify one attachment, accept or re-request it
 *   nudgePending()              remind about anything still pending
 *   maybeCompleteChecklist()    the gate: collecting_docs → scanning
 *
 * THE CORE PROMISE (spec §3.3): a case reaches the paralegal queue only once every
 * checklist item is in. That transition happens in exactly one place —
 * `maybeCompleteChecklist()` — and nothing else in the codebase may set a case to
 * `scanning` or `awaiting_review` while an item is still pending.
 */

const logger = log.scope("checklist");

/** Statuses that count as "we have this document". */
const SATISFIED: ChecklistItem["status"][] = ["received", "accepted"];

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

/**
 * Create the required-document list for a case. Idempotent: a case that already has
 * items keeps them, so re-running intake never duplicates the checklist.
 */
export async function generateChecklist(caseId: string): Promise<ChecklistItem[]> {
  const db = await getDb();
  const kase = await getCase(caseId);
  if (!kase) throw new Error(`case ${caseId} not found`);
  if (!kase.caseType || !isCaseType(kase.caseType)) {
    throw new Error(`case ${caseId} has no case type; cannot build a checklist`);
  }

  const existing = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.caseId, caseId) });
  if (existing.length > 0) return existing;

  const template = checklistTemplateFor(kase.caseType);
  const rows = await db
    .insert(schema.checklistItems)
    .values(
      template.items.map((item) => ({
        caseId,
        docName: item.docName,
        description: item.description,
        sourceCitation: curatedCitation(item.citationKey),
      })),
    )
    .returning();

  await writeAudit({
    caseId,
    actor: AGENT_ACTOR,
    action: "checklist.generated",
    payload: { caseType: kase.caseType, items: rows.map((r) => r.docName), source: "curated" },
  });
  return rows;
}

/** Text the client the list and tell them where to email it. */
export async function sendChecklistToClient(caseId: string, language: string): Promise<void> {
  const db = await getDb();
  const items = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.caseId, caseId) });
  const kase = await getCase(caseId);
  await sendTemplate({
    caseId,
    template: "checklist.sent",
    vars: { caseType: kase?.caseType ?? "", list: renderChecklistList(items, language) },
  });
}

// ---------------------------------------------------------------------------
// one attachment
// ---------------------------------------------------------------------------

/**
 * Verify one uploaded document, then accept it or tell the client what was wrong
 * (spec §3.3 step 2-3). Runs as the `process-inbound-attachment` job.
 */
export async function processInboundAttachment(documentId: string): Promise<void> {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
  if (!doc) {
    logger.warn("document vanished before verification", { documentId });
    return;
  }
  const kase = await getCase(doc.caseId);
  if (!kase) return;

  const items = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.caseId, doc.caseId) });
  const verdict = await verifyDocument(doc, items);

  await db
    .update(schema.documents)
    .set({
      legibilityOk: verdict.legibilityOk,
      verifiedType: verdict.docType,
      checklistItemId: verdict.checklistItemId,
      extracted: verdict.extracted,
    })
    .where(eq(schema.documents.id, documentId));

  const language = await clientLanguage(kase.clientId);
  if (verdict.accept && verdict.checklistItemId) {
    await acceptDocument(kase, documentId, verdict.checklistItemId, verdict, language);
  } else {
    await rejectDocument(kase, documentId, verdict, language);
  }

  await maybeCompleteChecklist(doc.caseId);
}

type Verdict = Awaited<ReturnType<typeof verifyDocument>>;

async function acceptDocument(kase: Case, documentId: string, checklistItemId: string, verdict: Verdict, language: string): Promise<void> {
  const db = await getDb();
  const [item] = await db
    .update(schema.checklistItems)
    .set({ status: "received", rejectionReason: null, updatedAt: new Date() })
    .where(eq(schema.checklistItems.id, checklistItemId))
    .returning();
  await writeAudit({
    caseId: kase.id,
    actor: AGENT_ACTOR,
    action: "document.accepted",
    payload: {
      documentId,
      checklistItemId,
      docName: item?.docName,
      verifiedType: verdict.docType,
      verifiedBy: verdict.verifiedBy,
      legibilityOk: verdict.legibilityOk,
    },
  });
  if (item) {
    await sendTemplate({
      caseId: kase.id,
      template: "document.received",
      vars: { docName: localizedDocName(item.docName, language) },
    });
  }
}

async function rejectDocument(kase: Case, documentId: string, verdict: Verdict, language: string): Promise<void> {
  const db = await getDb();
  const reason = verdict.reason ?? "the document could not be verified";
  if (verdict.checklistItemId) {
    await db
      .update(schema.checklistItems)
      .set({ status: "rejected", rejectionReason: reason, updatedAt: new Date() })
      .where(eq(schema.checklistItems.id, verdict.checklistItemId));
  }
  await writeAudit({
    caseId: kase.id,
    actor: AGENT_ACTOR,
    action: "document.rejected",
    payload: { documentId, checklistItemId: verdict.checklistItemId, reason, verifiedBy: verdict.verifiedBy },
  });
  const docName = verdict.checklistItemId
    ? (await db.query.checklistItems.findFirst({ where: eq(schema.checklistItems.id, verdict.checklistItemId) }))?.docName
    : undefined;
  await sendTemplate({
    caseId: kase.id,
    template: "document.rejected",
    vars: {
      docName: localizedDocName(docName ?? verdict.originalFilename ?? "document", language),
      reason: rejectionReason(verdict.reasonCode ?? "unreadable_file", language),
    },
  });
}

// ---------------------------------------------------------------------------
// nudges
// ---------------------------------------------------------------------------

/**
 * Remind clients about documents still pending (spec §3.3 step 4). With a caseId it
 * nudges that one case (the console button); without one it nudges every case still
 * collecting documents (the daily Trigger.dev schedule).
 */
export async function nudgePending(caseId?: string, paralegalId?: string): Promise<void> {
  const db = await getDb();
  const cases = caseId
    ? await db.query.cases.findMany({ where: eq(schema.cases.id, caseId) })
    : await db.query.cases.findMany({ where: eq(schema.cases.status, "collecting_docs") });

  for (const kase of cases) {
    const outstanding = await db.query.checklistItems.findMany({
      where: and(eq(schema.checklistItems.caseId, kase.id), notInArray(schema.checklistItems.status, SATISFIED)),
    });
    const language = await clientLanguage(kase.clientId);
    try {
      if (outstanding.length === 0 && paralegalId) {
        await sendTemplate({
          caseId: kase.id,
          template: "status.update",
          vars: { status: "We have everything we need right now. We will keep you updated." },
        });
        await writeAudit({
          caseId: kase.id,
          actor: paralegalId,
          action: "nudge.sent",
          payload: { pending: [], initiatedBy: paralegalId, message: "no documents pending" },
        });
        continue;
      }
      if (outstanding.length === 0) continue;
      await sendTemplate({
        caseId: kase.id,
        template: "document.nudge",
        vars: { list: renderChecklistList(outstanding, language) },
      });
      await writeAudit({
        caseId: kase.id,
        actor: paralegalId ?? AGENT_ACTOR,
        action: "nudge.sent",
        payload: { pending: outstanding.map((i) => i.docName), initiatedBy: paralegalId ?? "schedule" },
      });
    } catch (err) {
      logger.warn("nudge failed", { caseId: kase.id, err: String(err) });
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

export type ChecklistProgress = { total: number; done: number; complete: boolean; pending: ChecklistItem[] };

export async function checklistProgress(caseId: string): Promise<ChecklistProgress> {
  const db = await getDb();
  const items = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.caseId, caseId) });
  const pending = items.filter((i) => !SATISFIED.includes(i.status));
  return { total: items.length, done: items.length - pending.length, complete: items.length > 0 && pending.length === 0, pending };
}

/**
 * THE GATE. When (and only when) every checklist item is in, the case moves
 * collecting_docs → scanning and the scan is enqueued. Idempotent and safe to call
 * after every accepted document.
 */
export async function maybeCompleteChecklist(caseId: string): Promise<boolean> {
  const kase = await getCase(caseId);
  if (!kase) return false;
  if (kase.status !== "collecting_docs") return false;

  const progress = await checklistProgress(caseId);
  if (!progress.complete) return false;

  await writeAudit({ caseId, actor: AGENT_ACTOR, action: "checklist.complete", payload: { items: progress.total } });
  await setCaseStatus(caseId, "scanning", AGENT_ACTOR, { trigger: "checklist_complete" });
  await sendTemplate({ caseId, template: "checklist.complete" });
  await enqueue("scan-case", { caseId });
  return true;
}

async function clientLanguage(clientId: string): Promise<string> {
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  return client?.preferredLanguage ?? "en";
}
