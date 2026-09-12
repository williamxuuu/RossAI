import type { CaseType } from "./index";
import type { CuratedSourceKey } from "@/lib/grounding/catalog";

/**
 * The required-document list the agent texts a client when a case opens (spec §3.3).
 *
 * These lists are CLINIC-CURATED, not generated. Each item names one document, says
 * in plain language what it is, and carries the USCIS source key the paralegal can
 * open to check it (src/lib/grounding/catalog.ts). Nothing here tells the client
 * whether they qualify or what to put on a form — it only says which paper to send.
 *
 * Scope is deliberately the pro bono intake packet: the handful of documents a
 * clinic collects before a paralegal opens the file. It is NOT the complete USCIS
 * filing checklist; `note` on each case type says so, and the checklist message
 * points the client at the official page.
 *
 * `matchHints` are lower-case substrings used to match an inbound attachment to an
 * item by filename or extracted type when vision verification is unavailable
 * (src/lib/pipeline/verify.ts).
 */

export type ChecklistTemplateItem = {
  docName: string;
  description: string;
  citationKey: CuratedSourceKey;
  matchHints: string[];
};

export type ChecklistTemplate = {
  /** One line shown above the list in the console. */
  note: string;
  /** The USCIS page for this form, shown to the client with the list. */
  formUrl: string;
  items: ChecklistTemplateItem[];
};

const PHOTO_ID: ChecklistTemplateItem = {
  docName: "Government photo ID",
  description: "A clear photo or scan of a government-issued ID with your photograph (passport, national ID, consular ID, or driver's license).",
  citationKey: "evidence.identity_document",
  // No bare "id": it is a substring of "resident", "evidence", and half the document
  // types, and a wrong match silently accepts the wrong paper against a checklist item.
  matchHints: ["photo id", "photo-id", "identification", "identity card", "drivers licen", "driver licen", "licencia", "cedula", "cédula", "consular", "matricula", "matrícula", "state id"],
};

const PASSPORT: ChecklistTemplateItem = {
  docName: "Passport",
  description: "The photo page of your passport, including the expiration date. Send every page that has a stamp or visa if you have them.",
  citationKey: "evidence.unexpired_passport",
  matchHints: ["passport", "pasaporte", "passeport", "passaporte"],
};

const BIRTH_CERTIFICATE: ChecklistTemplateItem = {
  docName: "Birth certificate",
  description: "Your birth certificate. If it is not in English, send it anyway — we will tell you what translation is needed.",
  citationKey: "evidence.birth_certificate",
  matchHints: ["birth", "nacimiento", "naissance", "nascimento", "acta", "certidao", "certidão", "batiste", "batistè"],
};

const GREEN_CARD: ChecklistTemplateItem = {
  docName: "Permanent Resident Card (both sides)",
  description: "A copy of the front AND the back of your Green Card.",
  citationKey: "evidence.unexpired_green_card",
  matchHints: ["green card", "greencard", "permanent resident", "residencia", "i-551", "tarjeta verde", "mica"],
};

const NAME_CHANGE: ChecklistTemplateItem = {
  docName: "Proof of legal name change (only if your name has changed)",
  description: "A marriage certificate, divorce decree, or court order if the name on your documents is not the same everywhere.",
  citationKey: "evidence.legal_name_change",
  matchHints: ["name change", "marriage", "matrimonio", "divorce", "divorcio", "court order", "acta de matrimonio"],
};

const I94: ChecklistTemplateItem = {
  docName: "Form I-94 arrival record",
  description: "Your I-94 arrival/departure record — front and back, or the printout from the CBP website.",
  citationKey: "checklist.i-765",
  matchHints: ["i-94", "i94", "arrival", "departure"],
};

const NOTICES: ChecklistTemplateItem = {
  docName: "Any USCIS notices you have received",
  description: "Photos of any letters from USCIS about this case (receipt notices, Form I-797, appointment notices, requests for evidence).",
  citationKey: "filing.current_edition",
  matchHints: ["i-797", "i797", "notice", "receipt", "notificacion", "notificación", "aviso", "request for evidence"],
};

export const CHECKLISTS: Record<CaseType, ChecklistTemplate> = {
  "I-485": {
    note: "Intake packet for an adjustment of status case. The official USCIS initial-evidence checklist is longer; the clinic collects these first.",
    formUrl: "https://www.uscis.gov/i-485",
    items: [PHOTO_ID, BIRTH_CERTIFICATE, PASSPORT, NOTICES, NAME_CHANGE],
  },
  "N-400": {
    note: "Intake packet for a naturalization case. The official USCIS checklist adds documents that depend on the applicant's history.",
    formUrl: "https://www.uscis.gov/n-400",
    items: [GREEN_CARD, PHOTO_ID, NAME_CHANGE, NOTICES],
  },
  "I-130": {
    note: "Intake packet for a family petition. Evidence of the relationship is collected by the paralegal after this first pass.",
    formUrl: "https://www.uscis.gov/i-130",
    items: [PHOTO_ID, BIRTH_CERTIFICATE, NAME_CHANGE, NOTICES],
  },
  "I-765": {
    note: "Intake packet for a work permit application.",
    formUrl: "https://www.uscis.gov/i-765",
    items: [PHOTO_ID, I94, PASSPORT, NOTICES],
  },
  "I-90": {
    note: "Intake packet for replacing a Green Card.",
    formUrl: "https://www.uscis.gov/i-90",
    items: [GREEN_CARD, PHOTO_ID, NOTICES],
  },
};

export function checklistTemplateFor(caseType: CaseType): ChecklistTemplate {
  return CHECKLISTS[caseType];
}

/**
 * Human translations of the document names, keyed by the English `docName` stored on
 * the ChecklistItem row. The console always shows English; only the client's texts are
 * translated. Anything missing falls back to English (see `localizedDocName`).
 */
export const DOC_NAMES_BY_LANGUAGE: Record<string, Record<string, string>> = {
  es: {
    "Government photo ID": "Identificación oficial con foto",
    Passport: "Pasaporte",
    "Birth certificate": "Acta de nacimiento",
    "Permanent Resident Card (both sides)": "Tarjeta de residente permanente (ambos lados)",
    "Proof of legal name change (only if your name has changed)":
      "Prueba de cambio legal de nombre (solo si su nombre cambió)",
    "Form I-94 arrival record": "Registro de entrada Formulario I-94",
    "Any USCIS notices you have received": "Cualquier aviso de USCIS que haya recibido",
  },
};

export function localizedDocName(docName: string, language = "en"): string {
  return DOC_NAMES_BY_LANGUAGE[language]?.[docName] ?? docName;
}

/** Numbered, SMS-friendly rendering of a checklist for the `checklist.sent` template. */
export function renderChecklistList(items: { docName: string }[], language = "en"): string {
  return items.map((item, i) => `${i + 1}. ${localizedDocName(item.docName, language)}`).join("\n");
}

/** Every template item across all case types, for lookups by `docName`. */
export function findTemplateItem(docName: string): ChecklistTemplateItem | undefined {
  for (const template of Object.values(CHECKLISTS)) {
    const hit = template.items.find((i) => i.docName === docName);
    if (hit) return hit;
  }
  return undefined;
}
