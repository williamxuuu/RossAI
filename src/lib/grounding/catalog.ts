import type { Citation } from "@/db/schema";

/**
 * Clinic-curated USCIS sources.
 *
 * WHY THIS EXISTS. Spec §4 says "no grounding, no output": every factual statement
 * must carry a real citation. Live retrieval (Exa, src/lib/grounding/exa.ts) is the
 * primary path. But two kinds of output are authored by the clinic rather than by a
 * model, and still need a source the paralegal can check:
 *
 *   1. the required-document checklist for each case type (src/lib/casetypes/checklists.ts)
 *   2. the deterministic scan rules (src/lib/pipeline/scan-rules.ts)
 *
 * Both are written by hand, reviewed once, and never generated. Pinning them to a
 * hand-verified passage is what a clinic actually does with its intake sheets, and it
 * means the checklist and the deterministic flags keep working when Exa is down.
 *
 * HOW THESE WERE MADE. Every `quote` below was copied verbatim from the `url` above
 * it on 2026-09-12. Nothing here is model-authored, and nothing may be added without
 * opening the page and copying the sentence. `retrievedAt` is the day it was read.
 *
 * WHAT THIS IS NOT. This is not a fallback for model output. Anything a model wrote
 * — a jargon explanation, a drafted reply, a finding the strong-tier scan discovered —
 * must cite a passage that was actually retrieved for it. See `groundFinding()` in
 * src/lib/pipeline/scan-grounding.ts, which allows the catalog for deterministic rules
 * only.
 */

const RETRIEVED_AT = "2026-09-12T00:00:00.000Z";

export type CuratedSourceKey =
  | "filing.legible_copies"
  | "filing.complete_all_fields"
  | "filing.signature"
  | "filing.translation"
  | "filing.current_edition"
  | "evidence.birth_certificate"
  | "evidence.identity_document"
  | "evidence.legal_name_change"
  | "evidence.unexpired_passport"
  | "evidence.unexpired_green_card"
  | "checklist.i-485"
  | "checklist.n-400"
  | "checklist.i-130"
  | "checklist.i-765"
  | "checklist.i-90";

type CuratedSource = { title: string; url: string; quote: string };

const SOURCES: Record<CuratedSourceKey, CuratedSource> = {
  // ---- general filing requirements -------------------------------------------------
  "filing.legible_copies": {
    title: "Tips for Filing Forms by Mail | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/tips-for-filing-forms-by-mail",
    quote:
      "Submit legible copies of official documents. We may scan them in black and white or in grayscale. Legible copies are copies that: Are not blurry or faded; Do not have streaks or toner lines; Are not upside down, lopsided, skewed, or distorted; Do not have text or images that are obscured, partially cut off, or missing due to folded pages or improper copying; and Do not have pages that are completely illegible.",
  },
  "filing.complete_all_fields": {
    title: "Tips for Filing Forms by Mail | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/tips-for-filing-forms-by-mail",
    quote:
      "Complete the entire form, unless the form directs you to skip 1 or more items. If you do not complete all parts of the form, we may reject your submission for missing information.",
  },
  "filing.signature": {
    title: "Tips for Filing Forms by Mail | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/tips-for-filing-forms-by-mail",
    quote:
      "Remember to sign your form in the space provided for your signature. We will reject or deny any improperly signed form.",
  },
  "filing.translation": {
    title: "Tips for Filing Forms by Mail | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/tips-for-filing-forms-by-mail",
    quote:
      "Supporting documents must be in English or accompanied by a complete English translation that the translator has certified as complete and accurate. The English translation must be accompanied by the translator's certification that they are competent to translate the foreign language into English.",
  },
  "filing.current_edition": {
    title: "Tips for Filing Forms by Mail | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/tips-for-filing-forms-by-mail",
    quote:
      "Ensure that the form edition date and page numbers are visible at the bottom of the printed pages and that you complete all pages with the same edition of the form. If any of the form's pages are missing or are completed with a different edition of the form, we may reject your application.",
  },

  // ---- identity / relationship evidence --------------------------------------------
  "evidence.birth_certificate": {
    title: "Checklist of Required Initial Evidence for Form I-485 | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-i-485-for-informational-purposes-only",
    quote:
      "A copy of your birth certificate (if your birth certificate is unavailable or does not exist, provide other acceptable evidence of birth such as church, school, or medical records, and proof of unavailability or nonexistence, if applicable);",
  },
  "evidence.identity_document": {
    title: "Checklist of Required Initial Evidence for Form I-485 | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-i-485-for-informational-purposes-only",
    quote: "A copy of your government-issued identity document with photograph;",
  },
  "evidence.legal_name_change": {
    title: "I-130, Petition for Alien Relative | USCIS",
    url: "https://www.uscis.gov/i-130",
    quote: "Proof of legal name change (if applicable); and 2 passport-style photographs (if applicable).",
  },
  "evidence.unexpired_passport": {
    title: "I-130, Petition for Alien Relative | USCIS",
    url: "https://www.uscis.gov/i-130",
    quote:
      "A copy of Form FS-240, Consular Report of Birth Abroad (CRBA), issued by a U.S. Embassy or U.S. Consulate; A copy of your unexpired U.S. passport;",
  },
  "evidence.unexpired_green_card": {
    title: "I-90, Application to Replace Permanent Resident Card | USCIS",
    url: "https://www.uscis.gov/i-90",
    quote:
      "As a lawful permanent resident, you must have a valid, unexpired Green Card or equivalent documentation with you at all times. Applying for naturalization does not change this requirement.",
  },

  // ---- per-form checklists ---------------------------------------------------------
  "checklist.i-485": {
    title: "Checklist of Required Initial Evidence for Form I-485 | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-i-485-for-informational-purposes-only",
    quote:
      "Did you provide the following? Two passport-style photographs; A copy of your government-issued identity document with photograph; A copy of your birth certificate; Inspection and admission, or inspection and parole documentation; Documentation of immigrant category, such as a copy of the approval or receipt notice (Form I-797, Notice of Action), for the Form I-130 filed on your behalf",
  },
  "checklist.n-400": {
    title: "N-400, Application for Naturalization | USCIS",
    url: "https://www.uscis.gov/n-400",
    quote:
      "All applicants must provide (if applicable) LPR Card (Green Card): A copy of your Permanent Resident Card (also known as a Green Card) (both sides)",
  },
  "checklist.i-130": {
    title: "I-130, Petition for Alien Relative | USCIS",
    url: "https://www.uscis.gov/i-130",
    quote:
      "Evidence of U.S. citizenship, lawful permanent residence, or U.S. national status: A copy of your birth certificate, issued by a civil registrar, vital statistics office, or other civil authority showing you were born in the United States;",
  },
  "checklist.i-765": {
    title: "Checklist of Required Initial Evidence for Form I-765 | USCIS",
    url: "https://www.uscis.gov/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-i-765-for-informational-purposes-only",
    quote:
      "Did you provide the following? A copy of your Form I-94, Arrival/Departure Record (front and back), a printout of your electronic Form I-94, your passport or other travel document; A copy of your last Employment Authorization Document (EAD) (if applicable); Two identical passport-style photographs;",
  },
  "checklist.i-90": {
    title: "I-90, Application to Replace Permanent Resident Card | USCIS",
    url: "https://www.uscis.gov/i-90",
    quote:
      "If you complete and print this form to mail it, make sure that the form edition date and page numbers are visible at the bottom of all pages and that all pages are from the same form edition. If any of the form's pages are missing or are from a different form edition, we may reject your form.",
  },
};

/** A curated Citation. Always returns the same object shape as an Exa-derived one. */
export function curatedCitation(key: CuratedSourceKey): Citation {
  const src = SOURCES[key];
  return { title: src.title, url: src.url, quote: src.quote, retrievedAt: RETRIEVED_AT };
}

export function isCuratedKey(key: string): key is CuratedSourceKey {
  return key in SOURCES;
}

export const CURATED_KEYS = Object.keys(SOURCES) as CuratedSourceKey[];
