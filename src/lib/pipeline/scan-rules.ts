/**
 * Deterministic scan rules (spec §3.4).
 *
 * Pure functions over the fields the extraction step pulled out of a case's
 * documents — no LLM, no DB, no network — so every finding is reproducible and
 * unit-testable. `scan.ts` attaches a grounding citation to each finding and
 * DROPS any finding it cannot ground (spec §4 "no grounding, no output").
 *
 * Every rule returns `RuleFinding[]`; `runScanRules()` runs them all in a fixed
 * order. Descriptions and fixes are about the documents and forms only — never
 * about what the applicant should legally do.
 */
import type { ChecklistStatus, ExtractedDocument, FlagSeverity } from "@/db/schema";

// ---------- packet shape ----------

export type ScanDocument = {
  id: string;
  /** `docName` of the linked checklist item, when any. */
  checklistItemName: string | null;
  checklistItemStatus: ChecklistStatus | null;
  /** Model-classified type (`extracted.docType`), falling back to `documents.verifiedType`. */
  docType: string | null;
  originalFilename: string | null;
  legibilityOk: boolean | null;
  extracted: ExtractedDocument | null;
};

export type ScanChecklistItem = { id: string; docName: string; status: ChecklistStatus };

/** Everything the scan looks at for one case. Built by `scan.ts`, consumed by the rules and the LLM prompt. */
export type ScanPacket = {
  caseId: string;
  caseType: string | null;
  clientLanguage: string;
  intakeAnswers: Record<string, string>;
  checklistItems: ScanChecklistItem[];
  documents: ScanDocument[];
};

export type RuleId =
  | "name_mismatch"
  | "dob_mismatch"
  | "id_expiration"
  | "blank_required_field"
  | "address_mismatch"
  | "missing_translation"
  | "illegible_document";

export type RuleFinding = {
  rule: RuleId;
  /** Specific field reference, e.g. "Date of Birth — birth certificate vs. passport". */
  fieldRef: string;
  severity: FlagSeverity;
  /** One line: the problem. */
  description: string;
  /** One line: the fix, phrased about the documents/forms. */
  proposedFix: string;
  evidenceDocumentIds: string[];
  /** Keywords `scan.ts` combines with the description to pick a grounding passage. */
  groundingQuery: string;
};

export type RuleOptions = {
  /** "Now" for expiration checks; injectable for tests. */
  now?: Date;
  /** Max blank-required-field findings per scan (spec: cap 5). */
  blankFieldCap?: number;
};

// ---------- field access ----------

const FIELD_ALIASES = {
  fullName: ["fullName", "name", "fullLegalName", "legalName", "currentLegalName", "applicantName", "nameOfApplicant", "completeName", "holderName"],
  dateOfBirth: ["dateOfBirth", "dob", "birthDate", "birthdate", "dateofbirth", "born"],
  address: ["address", "currentAddress", "mailingAddress", "physicalAddress", "residentialAddress", "homeAddress", "streetAddress"],
  expirationDate: ["expirationDate", "expiration", "expiryDate", "expiry", "expires", "expiresOn", "dateOfExpiration", "dateOfExpiry", "validUntil", "expirationdate"],
  language: ["language", "documentLanguage", "lang", "textLanguage", "originalLanguage"],
} as const;

export type FieldName = keyof typeof FIELD_ALIASES;

function keyNorm(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Look a field up under any of its known spellings. Returns a trimmed non-empty value or null. */
export function getField(fields: Record<string, string | null> | undefined, name: FieldName): string | null {
  if (!fields) return null;
  const wanted = new Set(FIELD_ALIASES[name].map(keyNorm));
  for (const [k, v] of Object.entries(fields)) {
    if (!wanted.has(keyNorm(k))) continue;
    const value = (v ?? "").trim();
    if (value) return value;
  }
  return null;
}

// ---------- normalizers (exported for tests) ----------

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

<<<<<<< HEAD
/** Case-, diacritic-, punctuation- and order-insensitive name key. */
export function normalizeName(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
=======
/**
 * Case-, diacritic-, punctuation- and order-insensitive name key.
 *
 * Apostrophes are DELETED rather than turned into spaces. "O'Brien", "OBrien" and
 * "O Brien" are one name written three ways, and a system that raises a high-severity
 * name mismatch over an apostrophe is wrong about a large share of Irish, Italian and
 * West African names. Hyphens do become spaces, because "Jean-Luc" and "Jean Luc" are
 * two words either way.
 */
export function normalizeName(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/['’`´]/g, "")
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

<<<<<<< HEAD
=======
/** US state names and postal codes collapse to the same token. */
const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", ma: "massachusetts", md: "maryland", me: "maine",
  mi: "michigan", mn: "minnesota", mo: "missouri", ms: "mississippi", mt: "montana", nc: "north carolina",
  nd: "north dakota", ne: "nebraska", nh: "new hampshire", nj: "new jersey", nm: "new mexico", nv: "nevada",
  ny: "new york", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania", pr: "puerto rico",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas", ut: "utah",
  va: "virginia", vt: "vermont", wa: "washington", wi: "wisconsin", wv: "west virginia", wy: "wyoming",
  dc: "district of columbia", id: "idaho", il: "illinois", in: "indiana",
};

>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  st: "street",
  str: "street",
  ave: "avenue",
  av: "avenue",
  rd: "road",
  dr: "drive",
  blvd: "boulevard",
  ln: "lane",
  ct: "court",
  pl: "place",
  hwy: "highway",
  pkwy: "parkway",
  apt: "apartment",
  ste: "suite",
  fl: "floor",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  no: "",
  usa: "",
  us: "",
  united: "",
  states: "",
  america: "",
};

<<<<<<< HEAD
/** Case-, punctuation- and abbreviation-insensitive address key. */
export function normalizeAddress(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t in ADDRESS_ABBREVIATIONS ? ADDRESS_ABBREVIATIONS[t] : t))
=======
/**
 * Case-, punctuation- and abbreviation-insensitive address key.
 *
 * "412 W Main Street Apt 3, Houston, TX 77002" and "412 West Main St. #3, Houston,
 * Texas 77002" are the same address, and a low-severity flag saying otherwise is the
 * kind of noise that teaches a paralegal to stop reading flags. So "#" becomes the
 * unit marker it stands for BEFORE punctuation is stripped, and state codes expand to
 * state names.
 *
 * Note the ambiguity this accepts: "in", "or", "id" and "la" are both state codes and
 * ordinary words. Expanding them can only make two addresses look MORE alike, and this
 * key is used solely to decide whether to raise a mismatch — so the error it can cause
 * is a missed low-severity flag, never a false one.
 */
export function normalizeAddress(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/#\s*/g, "apartment ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ADDRESS_ABBREVIATIONS[t] ?? US_STATES[t] ?? t)
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
    .filter(Boolean)
    .join(" ");
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, enero: 1, janvier: 1, janeiro: 1,
  feb: 2, february: 2, febrero: 2, fevrier: 2, fevereiro: 2,
  mar: 3, march: 3, marzo: 3, mars: 3, marco: 3,
  apr: 4, april: 4, abril: 4, avril: 4,
  may: 5, mayo: 5, mai: 5, maio: 5,
  jun: 6, june: 6, junio: 6, juin: 6, junho: 6,
  jul: 7, july: 7, julio: 7, juillet: 7, julho: 7,
  aug: 8, august: 8, agosto: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9, septembre: 9, setembro: 9,
  oct: 10, october: 10, octubre: 10, octobre: 10, outubro: 10,
  nov: 11, november: 11, noviembre: 11, novembre: 11, novembro: 11,
  dec: 12, december: 12, diciembre: 12, decembre: 12, dezembro: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1850 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Parse a date string into every plausible ISO (YYYY-MM-DD) reading.
 * "01/02/1990" yields both Jan 2 and Feb 1 — foreign documents often use
 * day/month — so two dates only mismatch when NO readings agree. Unparseable
 * input (including 2-digit years) returns [] and is never compared.
 */
export function parseDateCandidates(raw: string): string[] {
  const s = stripDiacritics(raw).toLowerCase().trim();
  const out = new Set<string>();

  const iso = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const v = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (v) out.add(v);
    return [...out];
  }

  const numeric = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = Number(numeric[3]);
    const mdy = isoDate(y, a, b);
    const dmy = isoDate(y, b, a);
    if (mdy) out.add(mdy);
    if (dmy) out.add(dmy);
    return [...out];
  }

  const monthWord = s.match(/[a-z]{3,}/g)?.find((w) => w in MONTHS);
  const nums = (s.match(/\d+/g) ?? []).map(Number);
  const year = nums.find((n) => n >= 1000);
  const day = nums.find((n) => n < 1000);
  if (monthWord && year !== undefined && day !== undefined) {
    const v = isoDate(year, MONTHS[monthWord], day);
    if (v) out.add(v);
  }
  return [...out];
}

/** true = agree, false = disagree, null = at least one side is unparseable (never flag). */
export function datesMatch(a: string, b: string): boolean | null {
  const ca = parseDateCandidates(a);
  const cb = parseDateCandidates(b);
  if (ca.length === 0 || cb.length === 0) return null;
  return ca.some((x) => cb.includes(x));
}

// ---------- language heuristics ----------

const FOREIGN_FUNCTION_WORDS = new Set([
  // Spanish
  "de", "del", "la", "el", "los", "las", "una", "uno", "para", "por", "con", "que", "nacimiento", "certificado", "acta", "nacido", "nacida", "hijo", "hija", "fecha", "nombre", "registro", "civil",
  // French
  "le", "les", "des", "une", "et", "est", "naissance", "acte", "republique", "extrait", "prenom", "nom",
  // Portuguese
  "do", "da", "dos", "das", "uma", "certidao", "nascimento", "registro", "nome", "filho", "filha",
  // Haitian Creole
  "ak", "nan", "yo", "pou", "batistè", "batiste", "nesans",
]);

/** Ratio of non-ASCII letters among all letters — catches Cyrillic, Arabic, CJK, Vietnamese, etc. */
function nonAsciiLetterRatio(text: string): number {
  let letters = 0;
  let nonAscii = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    letters += 1;
    if (ch.charCodeAt(0) > 0x7f) nonAscii += 1;
  }
  return letters === 0 ? 0 : nonAscii / letters;
}

function foreignWordRatio(text: string): number {
  const words = stripDiacritics(text).toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length < 8) return 0;
  const hits = words.filter((w) => FOREIGN_FUNCTION_WORDS.has(w)).length;
  return hits / words.length;
}

function languageIsEnglish(lang: string): boolean {
  const l = lang.toLowerCase().trim();
  return l === "en" || l.startsWith("en-") || l.startsWith("en_") || l === "eng" || l === "english" || l === "ingles" || l === "inglés";
}

/** Heuristic: extracted language field, else non-ASCII ratio, else foreign function-word density in rawText. */
export function looksNonEnglish(extracted: ExtractedDocument | null): boolean {
  if (!extracted) return false;
  const lang = getField(extracted.fields, "language");
  if (lang) return !languageIsEnglish(lang);
  const text = (extracted.rawText ?? "").trim();
  if (text.length < 40) return false;
  if (nonAsciiLetterRatio(text) >= 0.05) return true;
  return foreignWordRatio(text) >= 0.08;
}

const TRANSLATION_RE = /translat|traducc|traduc/i;

export function isTranslationDocument(doc: ScanDocument): boolean {
  return [doc.docType, doc.checklistItemName, doc.originalFilename, doc.extracted?.summary].some(
    (s) => typeof s === "string" && TRANSLATION_RE.test(s),
  );
}

// ---------- labels ----------

/** Human label for a document: checklist item name, else doc type, else filename. */
export function docLabel(doc: ScanDocument, index: number): string {
  return doc.checklistItemName ?? doc.docType ?? doc.originalFilename ?? `document ${index + 1}`;
}

function labelFor(packet: ScanPacket, doc: ScanDocument): string {
  return docLabel(doc, packet.documents.indexOf(doc));
}

type Variant = { doc: ScanDocument; raw: string; key: string };

function collectVariants(packet: ScanPacket, field: FieldName, normalize: (s: string) => string): Variant[] {
  const out: Variant[] = [];
  for (const doc of packet.documents) {
    const raw = getField(doc.extracted?.fields, field);
    if (raw) out.push({ doc, raw, key: normalize(raw) });
  }
  return out;
}

/** First occurrence of each distinct key, in document order. */
function distinctByKey(variants: Variant[]): Variant[] {
  const seen = new Set<string>();
  return variants.filter((v) => (seen.has(v.key) ? false : (seen.add(v.key), true)));
}

function describeVariants(packet: ScanPacket, variants: Variant[], cap = 3): string {
  return variants
    .slice(0, cap)
    .map((v) => `"${v.raw}" (${labelFor(packet, v.doc)})`)
    .join(" vs. ");
}

function fieldRefFor(packet: ScanPacket, label: string, variants: Variant[]): string {
  const docs = variants.slice(0, 3).map((v) => labelFor(packet, v.doc));
  return `${label} — ${docs.join(" vs. ")}`;
}

// ---------- rules ----------

/** (a) Full name differs across documents (after normalizing case, diacritics, punctuation, word order). */
export function ruleNameMismatch(packet: ScanPacket): RuleFinding[] {
  const distinct = distinctByKey(collectVariants(packet, "fullName", normalizeName));
  if (distinct.length < 2) return [];
  return [
    {
      rule: "name_mismatch",
      fieldRef: fieldRefFor(packet, "Full Name", distinct),
      severity: "high",
      description: `Full name differs across documents: ${describeVariants(packet, distinct)}.`,
      proposedFix: "Confirm the legal name with the client and make every form entry and supporting document match it exactly.",
      evidenceDocumentIds: distinct.map((v) => v.doc.id),
      groundingQuery: "name must match supporting documents birth certificate passport legal name",
    },
  ];
}

<<<<<<< HEAD
/** (b) Date of birth differs across documents (no plausible reading of the dates agrees). */
export function ruleDobMismatch(packet: ScanPacket): RuleFinding[] {
  const variants = collectVariants(packet, "dateOfBirth", (s) => s);
  const conflicting: Variant[] = [];
  for (const v of variants) {
    const agreesWithAll = conflicting.every((c) => datesMatch(c.raw, v.raw) !== false);
    const parseable = parseDateCandidates(v.raw).length > 0;
    if (parseable && (conflicting.length === 0 || !agreesWithAll)) conflicting.push(v);
  }
  if (conflicting.length < 2) return [];
  return [
    {
      rule: "dob_mismatch",
      fieldRef: fieldRefFor(packet, "Date of Birth", conflicting),
      severity: "high",
      description: `Date of birth differs across documents: ${describeVariants(packet, conflicting)}.`,
      proposedFix: "Confirm the date of birth against the birth certificate and correct the form entry or document that disagrees.",
      evidenceDocumentIds: conflicting.map((v) => v.doc.id),
=======
/**
 * (b) Date of birth differs across documents (no plausible reading of the dates agrees).
 *
 * Dates are grouped into agreeing sets rather than compared pairwise against a running
 * list: with a birth certificate and a marriage certificate that both say 14/03/1988
 * and a notice that says 03/04/1988, the finding must name two dates, not three
 * documents. Only one representative per group is described, and every document that
 * carries a date of birth is attached as evidence so the paralegal can compare them.
 */
export function ruleDobMismatch(packet: ScanPacket): RuleFinding[] {
  const variants = collectVariants(packet, "dateOfBirth", (s) => s).filter((v) => parseDateCandidates(v.raw).length > 0);
  const groups: Variant[][] = [];
  for (const v of variants) {
    const group = groups.find((g) => datesMatch(g[0].raw, v.raw) !== false);
    if (group) group.push(v);
    else groups.push([v]);
  }
  if (groups.length < 2) return [];
  const representatives = groups.map((g) => g[0]);
  return [
    {
      rule: "dob_mismatch",
      fieldRef: fieldRefFor(packet, "Date of Birth", representatives),
      severity: "high",
      description: `Date of birth differs across documents: ${describeVariants(packet, representatives)}.`,
      proposedFix: "Confirm the date of birth against the birth certificate and correct the form entry or document that disagrees.",
      evidenceDocumentIds: variants.map((v) => v.doc.id),
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
      groundingQuery: "date of birth must match supporting documents birth certificate",
    },
  ];
}

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

/** (c) A document's expiration date is in the past or within six months. */
export function ruleIdExpiration(packet: ScanPacket, opts: RuleOptions = {}): RuleFinding[] {
  const now = opts.now ?? new Date();
  const out: RuleFinding[] = [];
  for (const doc of packet.documents) {
    const raw = getField(doc.extracted?.fields, "expirationDate");
    if (!raw) continue;
    // Ambiguous day/month readings: take the latest so we never flag a date that could still be valid.
    const latest = parseDateCandidates(raw).sort().at(-1);
    if (!latest) continue;
    const expiresAt = new Date(`${latest}T00:00:00Z`).getTime();
    const label = labelFor(packet, doc);
    if (expiresAt < now.getTime()) {
      out.push(expirationFinding(doc, label, `${label} expired on ${latest}.`));
    } else if (expiresAt - now.getTime() < SIX_MONTHS_MS) {
      out.push(expirationFinding(doc, label, `${label} expires on ${latest}, less than six months from now.`));
    }
  }
  return out;
}

function expirationFinding(doc: ScanDocument, label: string, description: string): RuleFinding {
  return {
    rule: "id_expiration",
    fieldRef: `${label} — Expiration Date`,
    severity: "medium",
    description,
    proposedFix: `Obtain a copy of a current, unexpired ${label} and replace the expired or expiring copy in the packet.`,
    evidenceDocumentIds: [doc.id],
    groundingQuery: "valid unexpired passport identity document expiration date copy",
  };
}

/** (d) Extraction reported blank required fields. One high finding per field, capped. */
export function ruleBlankRequiredFields(packet: ScanPacket, opts: RuleOptions = {}): RuleFinding[] {
  const cap = opts.blankFieldCap ?? 5;
  const out: RuleFinding[] = [];
  for (const doc of packet.documents) {
    const label = labelFor(packet, doc);
    const fields = [...new Set((doc.extracted?.blankRequiredFields ?? []).map((f) => f.trim()).filter(Boolean))];
    for (const field of fields) {
      if (out.length >= cap) return out;
      out.push({
        rule: "blank_required_field",
        fieldRef: `${label} — ${field}`,
        severity: "high",
        description: `Required field "${field}" is blank on ${label}.`,
        proposedFix: `Complete "${field}" on ${label} so no required field is left blank.`,
        evidenceDocumentIds: [doc.id],
        groundingQuery: "complete all required fields blank missing information incomplete rejected",
      });
    }
  }
  return out;
}

/** (e) Address differs across documents (after normalizing abbreviations and punctuation). */
export function ruleAddressMismatch(packet: ScanPacket): RuleFinding[] {
  const distinct = distinctByKey(collectVariants(packet, "address", normalizeAddress));
  if (distinct.length < 2) return [];
  return [
    {
      rule: "address_mismatch",
      fieldRef: fieldRefFor(packet, "Address", distinct),
      severity: "low",
      description: `Address differs across documents: ${describeVariants(packet, distinct)}.`,
      proposedFix: "Confirm the current mailing and physical address and make the form entries consistent.",
      evidenceDocumentIds: distinct.map((v) => v.doc.id),
      groundingQuery: "mailing address physical address must match current address",
    },
  ];
}

/** (f) A non-English document with no translation document anywhere in the packet. */
export function ruleMissingTranslation(packet: ScanPacket): RuleFinding[] {
  const hasTranslation = packet.documents.some(isTranslationDocument);
  if (hasTranslation) return [];
  const out: RuleFinding[] = [];
  for (const doc of packet.documents) {
    if (isTranslationDocument(doc) || !looksNonEnglish(doc.extracted)) continue;
    const label = labelFor(packet, doc);
    out.push({
      rule: "missing_translation",
      fieldRef: `${label} — English translation`,
      severity: "medium",
      description: `${label} appears to be in a language other than English and no translation document is in the packet.`,
      proposedFix: `Obtain a full English translation of ${label} with the translator's certification of competence and accuracy.`,
      evidenceDocumentIds: [doc.id],
      groundingQuery: "certified English translation foreign language document translator certification",
    });
  }
  return out;
}

/** (g) A checklist item is received/accepted but the document is marked illegible. */
export function ruleIllegibleReceived(packet: ScanPacket): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const doc of packet.documents) {
    const received = doc.checklistItemStatus === "received" || doc.checklistItemStatus === "accepted";
    if (!received || doc.legibilityOk !== false) continue;
    const label = labelFor(packet, doc);
    const notes = doc.extracted?.legibilityNotes?.trim();
    out.push({
      rule: "illegible_document",
      fieldRef: `${label} — legibility`,
      severity: "medium",
      description: `${label} was marked received but the copy is not legible${notes ? `: ${notes}` : ""}.`,
      proposedFix: `Request a clear, complete copy of ${label} from the client and replace the illegible copy.`,
      evidenceDocumentIds: [doc.id],
      groundingQuery: "legible copy photocopy clear readable copies of documents",
    });
  }
  return out;
}

/** Run every deterministic rule in a fixed order. */
export function runScanRules(packet: ScanPacket, opts: RuleOptions = {}): RuleFinding[] {
  return [
    ...ruleNameMismatch(packet),
    ...ruleDobMismatch(packet),
    ...ruleIdExpiration(packet, opts),
    ...ruleBlankRequiredFields(packet, opts),
    ...ruleAddressMismatch(packet),
    ...ruleMissingTranslation(packet),
    ...ruleIllegibleReceived(packet),
  ];
}

/** Key used to detect an LLM finding that duplicates a deterministic one (same fieldRef + severity). */
export function findingKey(fieldRef: string, severity: FlagSeverity): string {
  return `${severity}|${stripDiacritics(fieldRef).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}
