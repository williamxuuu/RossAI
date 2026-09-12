import "server-only";
import { z } from "zod";
import type { ChecklistItem, Document, ExtractedDocument } from "@/db/schema";
import { completeJson, isLlmConfigured } from "@/lib/llm/client";
import { findTemplateItem } from "@/lib/casetypes/checklists";
import { getDocumentStore } from "@/lib/storage";
import { log } from "@/lib/log";
import { extractDeterministically, type LegibilityCheck, type RejectionCode } from "./extract";

/**
 * "Is this the right document, and can we read it?" (spec §3.3 step 2).
 *
 * Two layers, in this order:
 *   1. deterministic (extract.ts) — dimensions, PDF text, labelled fields, printed
 *      document type. Always runs, needs no key, and is what the audit log records
 *      as `verifiedBy: "heuristic"`.
 *   2. vision model — only when OPENROUTER_API_KEY is set. It may overrule the
 *      deterministic type and legibility call, and its answer is recorded as
 *      `verifiedBy: "vision"`.
 *
 * When neither layer can name the document type, the file is NOT quietly accepted
 * against a checklist item: it is matched by filename only if the match is
 * unambiguous, and otherwise it is rejected with "we could not tell what this is",
 * which is the honest answer and puts the client back in the loop.
 */

const logger = log.scope("verify");

export type VerifyVerdict = {
  accept: boolean;
  /** Checklist item this document satisfies, when one was matched. */
  checklistItemId: string | null;
  docType: string | null;
  legibilityOk: boolean | null;
  extracted: ExtractedDocument;
  /** Why it was rejected, for the audit log and the console. */
  reason?: string;
  /** Why it was rejected, as a code translated for the client at send time. */
  reasonCode?: RejectionCode;
  verifiedBy: "vision" | "heuristic";
  originalFilename: string | null;
};

const VisionSchema = z.object({
  docType: z.string().max(60),
  legible: z.boolean(),
  legibilityNotes: z.string().max(300).default(""),
  summary: z.string().max(400).default(""),
  fields: z.record(z.string().nullable()).default({}),
  blankRequiredFields: z.array(z.string().max(80)).max(10).default([]),
  matchesChecklistItem: z.string().max(120).nullable().default(null),
});

const VISION_SYSTEM = `You inspect a document a client sent to a pro bono immigration clinic.
Report only what you can SEE on the page. Do not infer, do not fill in likely values, and never
say what the client should do.
- docType: a short snake_case type, e.g. birth_certificate, passport, permanent_resident_card,
  employment_authorization, i-94, uscis_notice, drivers_license, marriage_certificate, translation.
  Use "unknown" if you cannot tell.
- legible: false only if a person could not read the printed text (blurry, cut off, too dark, too small).
- fields: values exactly as printed. Use null for anything not visible. Useful keys: fullName,
  dateOfBirth, placeOfBirth, address, expirationDate, documentNumber, issuingAuthority, language, nationality.
- blankRequiredFields: labels on the page that have no value filled in.
- matchesChecklistItem: the exact name of the checklist item this document satisfies, or null.
Return JSON only.`;

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|heic|heif)$/i;

export async function verifyDocument(doc: Document, checklistItems: ChecklistItem[]): Promise<VerifyVerdict> {
  const stored = await getDocumentStore().get(doc.storageUrl);
  if (!stored) {
    logger.error("document bytes missing", { documentId: doc.id, key: doc.storageUrl });
    return {
      accept: false,
      checklistItemId: null,
      docType: null,
      legibilityOk: null,
      extracted: { docType: "unknown", summary: "The stored file could not be read.", fields: {} },
      reason: "stored file could not be read",
      reasonCode: "file_missing",
      verifiedBy: "heuristic",
      originalFilename: doc.originalFilename,
    };
  }

  const mimeType = doc.mimeType ?? stored.mimeType;
  const base = await extractDeterministically({ bytes: stored.bytes, mimeType, filename: doc.originalFilename });

  let extracted = base.extracted;
  let legibility: LegibilityCheck = base.legibility;
  let verifiedBy: VerifyVerdict["verifiedBy"] = "heuristic";
  let suggestedItemName: string | null = null;

  if (isLlmConfigured() && (IMAGE_TYPES.test(mimeType) || mimeType === "application/pdf")) {
    const vision = await askVisionModel({ bytes: stored.bytes, mimeType, filename: doc.originalFilename, checklistItems });
    if (vision) {
      verifiedBy = "vision";
      suggestedItemName = vision.matchesChecklistItem;
      extracted = {
        docType: vision.docType || extracted.docType,
        summary: vision.summary || extracted.summary,
        fields: { ...extracted.fields, ...vision.fields },
        blankRequiredFields: vision.blankRequiredFields.length ? vision.blankRequiredFields : extracted.blankRequiredFields,
        rawText: extracted.rawText,
        legibilityNotes: vision.legibilityNotes || extracted.legibilityNotes,
      };
      // A deterministic "definitely unreadable" stands: the model reads scaled-up images.
      legibility =
        legibility.legible === false
          ? legibility
          : { legible: vision.legible, notes: vision.legibilityNotes || legibility.notes, reasonCode: vision.legible ? undefined : "unreadable_file" };
    }
  }

  const docType = extracted.docType === "unknown" ? null : extracted.docType;
  const match = matchChecklistItem({ checklistItems, docType, filename: doc.originalFilename, suggestedItemName });

  if (legibility.legible === false) {
    return {
      accept: false,
      checklistItemId: match?.id ?? null,
      docType,
      legibilityOk: false,
      extracted,
      reason: legibility.notes,
      reasonCode: legibility.reasonCode ?? "unreadable_file",
      verifiedBy,
      originalFilename: doc.originalFilename,
    };
  }

  if (!match) {
    return {
      accept: false,
      checklistItemId: null,
      docType,
      legibilityOk: legibility.legible,
      extracted,
      reason: docType
        ? `Recognized as ${docType} but no checklist item is waiting for that document.`
        : "Could not tell what this document is.",
      reasonCode: docType ? "not_requested" : "unknown_document",
      verifiedBy,
      originalFilename: doc.originalFilename,
    };
  }

  return {
    accept: true,
    checklistItemId: match.id,
    docType,
    legibilityOk: legibility.legible,
    extracted,
    verifiedBy,
    originalFilename: doc.originalFilename,
  };
}

// ---------------------------------------------------------------------------
// matching a file to a checklist item
// ---------------------------------------------------------------------------

/** Items still waiting come first; an already-received item can still be replaced. */
function rank(item: ChecklistItem): number {
  if (item.status === "pending") return 0;
  if (item.status === "rejected") return 1;
  return 2;
}

export function matchChecklistItem(input: {
  checklistItems: ChecklistItem[];
  docType: string | null;
  filename: string | null;
  suggestedItemName?: string | null;
}): ChecklistItem | null {
  const items = [...input.checklistItems].sort((a, b) => rank(a) - rank(b));
  if (items.length === 0) return null;

  if (input.suggestedItemName) {
    const named = items.find((i) => i.docName.toLowerCase() === input.suggestedItemName!.toLowerCase());
    if (named) return named;
  }

  // Both sides are flattened the same way, or a hint like "i-797" could never match a
  // file named "i_797.pdf" — and worse, would look like it should.
  const flatten = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const haystack = flatten(`${input.docType ?? ""} ${input.filename ?? ""}`);
  const hits = items.filter((item) => {
    const template = findTemplateItem(item.docName);
    const hints = template?.matchHints ?? [item.docName];
    return hints.some((h) => haystack.includes(flatten(h)));
  });
  if (hits.length === 1) return hits[0];
  // Several items could take this file: prefer the one still pending, but only if
  // exactly one is. Ambiguity is reported, never resolved by coin flip.
  const pendingHits = hits.filter((i) => i.status === "pending" || i.status === "rejected");
  return pendingHits.length === 1 ? pendingHits[0] : null;
}

// ---------------------------------------------------------------------------
// vision
// ---------------------------------------------------------------------------

async function askVisionModel(input: {
  bytes: Buffer;
  mimeType: string;
  filename: string | null;
  checklistItems: ChecklistItem[];
}): Promise<z.infer<typeof VisionSchema> | null> {
  const base64 = input.bytes.toString("base64");
  const user = [
    `FILENAME: ${input.filename ?? "(none)"}`,
    "CHECKLIST ITEMS THIS CASE IS WAITING FOR:",
    ...input.checklistItems.map((i) => `- ${i.docName} (${i.status}): ${i.description}`),
  ].join("\n");

  return completeJson({
    tier: "vision",
    schema: VisionSchema,
    system: VISION_SYSTEM,
    user,
    images: input.mimeType === "application/pdf" ? undefined : [{ mimeType: input.mimeType, base64 }],
    files:
      input.mimeType === "application/pdf"
        ? [{ filename: input.filename ?? "document.pdf", mimeType: "application/pdf", base64 }]
        : undefined,
    temperature: 0,
    maxTokens: 1200,
  });
}
