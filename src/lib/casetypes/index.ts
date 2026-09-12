/**
 * CONTRACT STUB (constants are final; checklist content is filled in by the
 * checklist module). Case types the MVP supports.
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

export function isCaseType(v: unknown): v is CaseType {
  return typeof v === "string" && (CASE_TYPES as readonly string[]).includes(v);
}

export function caseTypeLabel(v: string | null | undefined): string {
  return v && isCaseType(v) ? `${v} · ${CASE_TYPE_LABELS[v]}` : (v ?? "Unknown case type");
}
