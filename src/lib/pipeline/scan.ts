import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import type { Citation, Flag, FlagSeverity } from "@/db/schema";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { formatPassagesForPrompt, isExaConfigured, retrievePassages, type Passage } from "@/lib/grounding/exa";
import { completeJson, isLlmConfigured } from "@/lib/llm/client";
import { log } from "@/lib/log";
import { getCase, setCaseStatus } from "./cases";
import { groundModelFinding, groundRuleFinding } from "./scan-grounding";
import {
  docLabel,
  findingKey,
  runScanRules,
  type RuleFinding,
  type ScanDocument,
  type ScanPacket,
} from "./scan-rules";

/**
 * The packet scan (spec §3.4).
 *
 * Runs once the checklist is complete. Two passes over the same packet:
 *
 *   1. deterministic rules (scan-rules.ts) — blank required fields, cross-document
 *      contradictions in name / date of birth / address, expiring identity documents,
 *      untranslated foreign-language documents, illegible copies accepted earlier.
 *      Reproducible, testable, and they work with no API keys at all.
 *   2. strong-tier model pass — only when a model AND Exa are both available. It looks
 *      for the rejection triggers the rules do not encode, and every finding it returns
 *      must cite one of the passages retrieved for this case or it is dropped.
 *
 * Findings become Flags. Open flags are replaced on every scan; flags a paralegal has
 * already decided are never touched.
 */

const logger = log.scope("scan");

/** Upper bound on flags per scan: a wall of flags is the same as no flags. */
const MAX_FLAGS = 12;

export async function scanCase(caseId: string): Promise<{ flags: number; mode: "rules" | "rules+model" }> {
  const kase = await getCase(caseId);
  if (!kase) throw new Error(`case ${caseId} not found`);
  if (kase.status === "closed") return { flags: 0, mode: "rules" };

  await writeAudit({ caseId, actor: AGENT_ACTOR, action: "scan.started", payload: { caseType: kase.caseType, status: kase.status } });

  const packet = await buildPacket(caseId);
  const ruleFindings = runScanRules(packet);
  const seen = new Set(ruleFindings.map((f) => findingKey(f.fieldRef, f.severity)));

  const inserted: Flag[] = [];
  for (const finding of ruleFindings.slice(0, MAX_FLAGS)) {
    const { citation, via } = await groundRuleFinding({
      rule: finding.rule,
      query: finding.groundingQuery,
      hint: packet.caseType ?? undefined,
    });
    inserted.push(await insertFlag(caseId, finding, citation, { origin: "rule", rule: finding.rule, citationVia: via }));
  }

  let mode: "rules" | "rules+model" = "rules";
  if (isLlmConfigured() && isExaConfigured() && inserted.length < MAX_FLAGS) {
    mode = "rules+model";
    const modelFindings = await modelPass(packet, seen, MAX_FLAGS - inserted.length);
    for (const { finding, citation } of modelFindings) {
      inserted.push(await insertFlag(caseId, finding, citation, { origin: "model", citationVia: "exa" }));
    }
  }

  await replaceOpenFlags(caseId, inserted);

  await writeAudit({
    caseId,
    actor: AGENT_ACTOR,
    action: "scan.completed",
    payload: {
      mode,
      documents: packet.documents.length,
      flags: inserted.length,
      bySeverity: countSeverity(inserted),
      llm: isLlmConfigured(),
      exa: isExaConfigured(),
    },
  });

  await setCaseStatus(caseId, "awaiting_review", AGENT_ACTOR, { trigger: "scan_complete", flags: inserted.length });
  return { flags: inserted.length, mode };
}

// ---------------------------------------------------------------------------
// packet
// ---------------------------------------------------------------------------

/**
 * What the scan looks at.
 *
 * Only the CURRENT document for each checklist item, plus anything not linked to an
 * item. A client who re-sends a document after a rejection leaves an older copy on the
 * case, and feeding both to the rules produces findings about a copy nobody will file:
 * the illegible copy that was already replaced, or a name "mismatch" between two
 * readings of the same page. The console's evidence panel still shows every document —
 * this narrowing is for the rules, not for the paralegal.
 */
export async function buildPacket(caseId: string): Promise<ScanPacket> {
  const db = await getDb();
  const kase = await getCase(caseId);
  if (!kase) throw new Error(`case ${caseId} not found`);
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, kase.clientId) });
  const checklistItems = await db.query.checklistItems.findMany({ where: eq(schema.checklistItems.caseId, caseId) });
  const documents = await db.query.documents.findMany({
    where: eq(schema.documents.caseId, caseId),
    orderBy: [asc(schema.documents.createdAt)],
  });
  const byItemId = new Map(checklistItems.map((i) => [i.id, i]));

  // Later documents win, so the map ends up holding the newest per checklist item.
  const currentForItem = new Map<string, string>();
  for (const d of documents) {
    if (d.checklistItemId) currentForItem.set(d.checklistItemId, d.id);
  }

  const scanDocuments: ScanDocument[] = documents
    .filter((d) => !d.checklistItemId || currentForItem.get(d.checklistItemId) === d.id)
    .map((d) => {
      const item = d.checklistItemId ? byItemId.get(d.checklistItemId) : undefined;
      return {
        id: d.id,
        checklistItemName: item?.docName ?? null,
        checklistItemStatus: item?.status ?? null,
        docType: d.extracted?.docType && d.extracted.docType !== "unknown" ? d.extracted.docType : d.verifiedType,
        originalFilename: d.originalFilename,
        legibilityOk: d.legibilityOk,
        extracted: d.extracted,
      };
    });

  return {
    caseId,
    caseType: kase.caseType,
    clientLanguage: client?.preferredLanguage ?? "en",
    intakeAnswers: kase.intakeState?.answers ?? {},
    checklistItems: checklistItems.map((i) => ({ id: i.id, docName: i.docName, status: i.status })),
    documents: scanDocuments,
  };
}

// ---------------------------------------------------------------------------
// model pass
// ---------------------------------------------------------------------------

const ModelFindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        fieldRef: z.string().min(3).max(160),
        severity: z.enum(["high", "medium", "low"]),
        description: z.string().min(5).max(300),
        proposedFix: z.string().min(5).max(300),
        citationIndex: z.number().int().nullable(),
        evidenceDocumentIds: z.array(z.string()).max(6).default([]),
      }),
    )
    .max(8)
    .default([]),
});

const MODEL_SYSTEM = `You review a document packet a pro bono immigration clinic has collected, looking for
problems that would get the filing rejected or delayed.

STRICT RULES:
1. Use ONLY the numbered USCIS passages provided. Every finding must cite exactly one of them by index.
2. Report only problems you can see in the packet summary: a missing document, a value that contradicts
   another document, a field left blank, a copy that cannot be read.
3. Never state whether the person is eligible, what they should do, or what to put on a form. Describe the
   document problem and the document-level fix.
4. Do not repeat findings already listed as ALREADY FOUND.
5. If you find nothing supported by a passage, return {"findings": []}. An empty list is a good answer.

Return JSON: {"findings": [{"fieldRef", "severity": "high"|"medium"|"low", "description", "proposedFix",
"citationIndex", "evidenceDocumentIds": []}]}. Keep description and proposedFix to one sentence each.`;

async function modelPass(
  packet: ScanPacket,
  alreadyFound: Set<string>,
  limit: number,
): Promise<{ finding: RuleFinding; citation: Citation }[]> {
  const query = [
    packet.caseType ?? "USCIS form",
    "common reasons for rejection incomplete evidence missing required documents",
  ].join(" ");
  const passages = await retrievePassages(query, { hint: packet.caseType ?? undefined, numResults: 6, highlightsPerUrl: 2 });
  if (passages.length === 0) {
    logger.info("model pass skipped: nothing retrieved");
    return [];
  }

  const result = await completeJson({
    tier: "strong",
    schema: ModelFindingsSchema,
    system: MODEL_SYSTEM,
    user: [
      `CASE TYPE: ${packet.caseType ?? "unknown"}`,
      "",
      "PACKET:",
      describePacket(packet),
      "",
      alreadyFound.size > 0 ? `ALREADY FOUND (do not repeat):\n${[...alreadyFound].join("\n")}` : "",
      "",
      "PASSAGES:",
      formatPassagesForPrompt(passages),
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0,
    maxTokens: 2000,
  });
  if (!result) return [];

  const documentIds = new Set(packet.documents.map((d) => d.id));
  const out: { finding: RuleFinding; citation: Citation }[] = [];
  for (const f of result.findings) {
    if (out.length >= limit) break;
    if (alreadyFound.has(findingKey(f.fieldRef, f.severity))) continue;
    const citation = groundModelFinding(passages, f.citationIndex);
    if (!citation) continue; // no grounding, no output
    alreadyFound.add(findingKey(f.fieldRef, f.severity));
    out.push({
      finding: {
        rule: "blank_required_field", // origin is recorded in the audit payload, not the rule id
        fieldRef: f.fieldRef,
        severity: f.severity,
        description: f.description,
        proposedFix: f.proposedFix,
        evidenceDocumentIds: f.evidenceDocumentIds.filter((id) => documentIds.has(id)),
        groundingQuery: query,
      },
      citation,
    });
  }
  logger.info("model pass", { returned: result.findings.length, kept: out.length });
  return out;
}

function describePacket(packet: ScanPacket): string {
  const lines: string[] = [];
  lines.push("Checklist:");
  for (const item of packet.checklistItems) lines.push(`- ${item.docName}: ${item.status}`);
  lines.push("", "Documents:");
  packet.documents.forEach((doc, i) => {
    const fields = Object.entries(doc.extracted?.fields ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `- [id ${doc.id}] ${docLabel(doc, i)} (type: ${doc.docType ?? "unknown"}, legible: ${doc.legibilityOk ?? "unknown"})` +
        (fields ? `\n    fields: ${fields}` : "") +
        (doc.extracted?.blankRequiredFields?.length ? `\n    blank: ${doc.extracted.blankRequiredFields.join(", ")}` : ""),
    );
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------

async function insertFlag(
  caseId: string,
  finding: RuleFinding,
  citation: Citation,
  meta: { origin: "rule" | "model"; rule?: string; citationVia: "exa" | "curated" },
): Promise<Flag> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.flags)
    .values({
      caseId,
      fieldRef: finding.fieldRef,
      severity: finding.severity,
      description: finding.description,
      proposedFix: finding.proposedFix,
      sourceCitation: citation,
      evidenceDocumentIds: finding.evidenceDocumentIds,
      status: "open",
    })
    .returning();
  await writeAudit({
    caseId,
    actor: AGENT_ACTOR,
    action: "flag.created",
    payload: {
      flagId: row.id,
      fieldRef: row.fieldRef,
      severity: row.severity,
      origin: meta.origin,
      rule: meta.rule ?? null,
      citationVia: meta.citationVia,
      citationUrl: citation.url,
    },
  });
  return row;
}

/**
 * Replace the previous scan's open flags with this scan's. Flags a paralegal has
 * approved, edited or rejected are evidence of a decision and are never deleted.
 */
async function replaceOpenFlags(caseId: string, keep: Flag[]): Promise<void> {
  const db = await getDb();
  const keepIds = new Set(keep.map((f) => f.id));
  const open = await db.query.flags.findMany({
    where: and(eq(schema.flags.caseId, caseId), eq(schema.flags.status, "open")),
    columns: { id: true },
  });
  const stale = open.filter((f) => !keepIds.has(f.id)).map((f) => f.id);
  for (const id of stale) {
    await db.delete(schema.flags).where(eq(schema.flags.id, id));
  }
  if (stale.length > 0) logger.info("cleared stale open flags", { caseId, removed: stale.length });
}

function countSeverity(flags: Flag[]): Record<FlagSeverity, number> {
  return flags.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0 } as Record<FlagSeverity, number>,
  );
}

export type { Passage };
