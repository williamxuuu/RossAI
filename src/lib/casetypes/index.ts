/**
<<<<<<< HEAD
 * CONTRACT STUB (constants are final; checklist content is filled in by the
 * checklist module). Case types the MVP supports.
=======
 * Case types the MVP supports, and the labels the client sees.
 *
 * The English labels are the clinic's own plain-language names for the forms, not
 * legal descriptions, and the translations are human-written for the same reason as
 * the message templates (src/lib/pipeline/templates.ts): the client's first contact
 * should read like a person wrote it. Falls back to English for any other language.
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
 */
export const CASE_TYPES = ["I-485", "N-400", "I-130", "I-765", "I-90"] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  "I-485": "Adjustment of Status (green card)",
  "N-400": "Naturalization (citizenship)",
  "I-130": "Petition for Alien Relative",
  "I-765": "Employment Authorization (work permit)",
  "I-90": "Replace Green Card",
};

<<<<<<< HEAD
=======
/** What the client is asked to choose between, in their own words. */
export const CASE_TYPE_CLIENT_LABELS: Record<string, Record<CaseType, string>> = {
  en: {
    "I-485": "Applying for a green card from inside the United States",
    "N-400": "Becoming a U.S. citizen",
    "I-130": "Petitioning for a family member",
    "I-765": "Getting or renewing a work permit",
    "I-90": "Replacing or renewing a green card",
  },
  es: {
    "I-485": "Solicitar la residencia (green card) desde dentro de Estados Unidos",
    "N-400": "Hacerse ciudadano de Estados Unidos",
    "I-130": "Pedir a un familiar",
    "I-765": "Obtener o renovar un permiso de trabajo",
    "I-90": "Reemplazar o renovar la green card",
  },
};

>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
export function isCaseType(v: unknown): v is CaseType {
  return typeof v === "string" && (CASE_TYPES as readonly string[]).includes(v);
}

export function caseTypeLabel(v: string | null | undefined): string {
  return v && isCaseType(v) ? `${v} · ${CASE_TYPE_LABELS[v]}` : (v ?? "Unknown case type");
}
<<<<<<< HEAD
=======

export function caseTypeClientLabel(type: CaseType, language = "en"): string {
  return (CASE_TYPE_CLIENT_LABELS[language] ?? CASE_TYPE_CLIENT_LABELS.en)[type];
}

/** The numbered menu sent with `intake.ask_case_type`. Indexes are 1-based. */
export function caseTypeOptions(language = "en"): string {
  return CASE_TYPES.map((t, i) => `${i + 1}. ${caseTypeClientLabel(t, language)}`).join("\n");
}

const KEYWORDS: { type: CaseType; re: RegExp }[] = [
  { type: "N-400", re: /\bn-?400\b|\bcitizen(ship)?\b|\bnaturali[sz]|\bciudadan|\bnaturaliza/i },
  { type: "I-485", re: /\bi-?485\b|\badjust(ment)? of status\b|\bresidenc|\bgreen ?card\b(?!.*\b(replace|renew|lost|stolen|reemplaz|renovar)\b)/i },
  { type: "I-130", re: /\bi-?130\b|\bpetition (for|my)\b|\bfamily member\b|\bfamiliar\b|\bpedir a mi\b|\bpeticion|\bpetición/i },
  { type: "I-765", re: /\bi-?765\b|\bwork permit\b|\bwork authori|\bead\b|\bpermiso de trabajo\b/i },
  { type: "I-90", re: /\bi-?90\b|\breplace .*green ?card\b|\brenew .*green ?card\b|\blost .*green ?card\b|\breemplaz|\brenovar la (green ?card|residencia)\b/i },
];

/**
 * Read a case type out of a client's reply: the menu number, the form number, or a
 * keyword. Returns null when the reply does not clearly pick one — the caller then
 * asks again rather than guessing.
 */
export function parseCaseTypeReply(reply: string): CaseType | null {
  const text = reply.trim();
  if (!text) return null;

  const numberOnly = text.match(/^[^\d]{0,12}?([1-9])\b/);
  if (numberOnly) {
    const idx = Number(numberOnly[1]) - 1;
    if (idx >= 0 && idx < CASE_TYPES.length) return CASE_TYPES[idx];
  }
  // A form number anywhere in the reply is unambiguous, so it is checked before keywords.
  for (const { type, re } of KEYWORDS) {
    if (new RegExp(`\\b${type.toLowerCase().replace("-", "-?")}\\b`, "i").test(text)) return type;
    if (re.test(text)) return type;
  }
  return null;
}
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
