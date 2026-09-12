import "server-only";
import { z } from "zod";
import { defineTool } from "@copilotkit/runtime/v2";
import { getCaseDetail, getQueue } from "@/lib/queries";
import { ground } from "@/lib/grounding";
import { caseTypeLabel } from "@/lib/casetypes";
import { languageName } from "@/lib/i18n";
import { log } from "@/lib/log";

/**
 * What the paralegal's copilot is allowed to do on the server.
 *
 * READ-ONLY, on purpose. The copilot can look up a case, summarise flags, and explain
 * a term against a retrieved USCIS passage. It cannot approve a flag, cannot edit one,
 * and cannot send a client anything — those are the paralegal's clicks, gated in
 * `src/lib/console-actions.ts` and `src/lib/pipeline/reply.ts`.
 *
 * `explainTerm` returns `{ grounded: false }` rather than an answer when nothing was
 * retrieved, so the copilot has nothing to paraphrase (spec §4).
 */

const logger = log.scope("copilot:tools");

const listQueue = defineTool({
  name: "listQueue",
  description: "List the cases that are ready for review: checklist complete and scanned. Use this when the paralegal asks what is waiting.",
  parameters: z.object({}),
  execute: async () => {
    const queue = await getQueue();
    return {
      count: queue.length,
      cases: queue.map((c) => ({
        caseId: c.id,
        caseType: c.caseType,
        language: languageName(c.language),
        openFlags: c.openFlags,
        openEscalations: c.openEscalations,
        updatedAt: c.updatedAt,
      })),
    };
  },
});

const getCaseSummary = defineTool({
  name: "getCaseSummary",
  description: "Summarise one case: its status, the document checklist, how many flags are open at each severity, and any client questions waiting for a person.",
  parameters: z.object({ caseId: z.string().describe("The case id shown in the URL") }),
  execute: async ({ caseId }) => {
    const detail = await getCaseDetail(caseId);
    if (!detail) return { error: "case not found" };
    const open = detail.flags.filter((f) => f.status === "open");
    return {
      caseId,
      caseType: caseTypeLabel(detail.case.caseType),
      status: detail.case.status,
      clientLanguage: languageName(detail.client.preferredLanguage),
      checklist: detail.checklistItems.map((i) => ({ docName: i.docName, status: i.status })),
      documents: detail.documents.length,
      openFlags: { high: open.filter((f) => f.severity === "high").length, medium: open.filter((f) => f.severity === "medium").length, low: open.filter((f) => f.severity === "low").length },
      openEscalations: detail.escalations.filter((e) => e.status === "open").map((e) => ({ id: e.id, reason: e.reason, question: e.question })),
    };
  },
});

const listFlags = defineTool({
  name: "listFlags",
  description: "List the flags on a case with their severity, the problem, the proposed fix, and the USCIS source behind each. Use this before answering any question about what is wrong with a packet.",
  parameters: z.object({
    caseId: z.string(),
    status: z.enum(["open", "all"]).default("open"),
  }),
  execute: async ({ caseId, status }) => {
    const detail = await getCaseDetail(caseId);
    if (!detail) return { error: "case not found" };
    const flags = status === "open" ? detail.flags.filter((f) => f.status === "open") : detail.flags;
    return {
      caseId,
      flags: flags.map((f) => ({
        flagId: f.id,
        severity: f.severity,
        fieldRef: f.fieldRef,
        description: f.description,
        proposedFix: f.editedText ?? f.proposedFix,
        status: f.status,
        citation: { title: f.sourceCitation.title, url: f.sourceCitation.url, quote: f.sourceCitation.quote },
      })),
    };
  },
});

const explainTerm = defineTool({
  name: "explainTerm",
  description: "Explain what a USCIS term or form field means, grounded in a passage retrieved from uscis.gov. Returns grounded:false when no source supports an explanation — say so instead of answering from memory.",
  parameters: z.object({
    term: z.string().describe("The term, field, or form number to explain"),
    formNumber: z.string().optional().describe("e.g. I-485, to bias retrieval toward that form's instructions"),
  }),
  execute: async ({ term, formNumber }) => {
    const result = await ground(term, { mode: "explain", hint: formNumber, language: "en" });
    if (!result.grounded) {
      logger.info("copilot explain refused", { reason: result.reason });
      return { grounded: false, reason: result.reason };
    }
    return {
      grounded: true,
      explanation: result.text,
      citation: { title: result.citation.title, url: result.citation.url, quote: result.citation.quote },
    };
  },
});

export const copilotTools = [listQueue, getCaseSummary, listFlags, explainTerm];

export const COPILOT_SYSTEM_PROMPT = `You are the review assistant inside RossAI, a pro bono immigration clinic's paralegal console.
You are talking to a paralegal, not to a client.

WHAT YOU DO
- Look things up with your tools and summarise them. Always call a tool before stating a fact about a case;
  never answer from memory about a case, a flag, or a document.
- When you mention a flag, give its severity, the field it is about, and the source URL behind it.
- Keep answers short. A paralegal is clearing a queue.

WHAT YOU DO NOT DO
- You do not give legal advice, state whether anyone is eligible, or say what a client should do. You describe
  what the documents show and what the USCIS source says.
- You do not approve, edit, or reject flags, and you do not send messages. Those are the paralegal's decisions;
  when asked, point at the buttons on the flag card.
- If \`explainTerm\` returns grounded:false, say that no USCIS source was found. Do not fill the gap yourself.`;
