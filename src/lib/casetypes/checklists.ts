<<<<<<< HEAD
/**
 * Curated required-document lists per case type (spec §3.3).
 *
 * Every item carries a Citation whose `quote` is a verbatim sentence from the
 * official USCIS page or form instructions at `url`, hand-verified against the
 * live page on RETRIEVED_AT. These are the only citations in the app that do not
 * come from Exa; they are never generated. Keep them that way.
 *
 * Conditional items read the intake answers (`cases.intake_state.answers`). The
 * keys below are matched case- and punctuation-insensitively, so the intake
 * module may use `priorNotices`, `prior_notices`, or `Prior Notices`:
 *
 *   married / isMarried / maritalStatus          yes | married
 *   priorNotices / hasPriorNotices               yes
 *   relationship                                 spouse | child | parent | sibling   (I-130)
 *   priorMarriage / previouslyMarried            yes                                 (I-130)
 *   basis / filingBasis / marriedToCitizen       marriage | spouse | yes             (N-400)
 *   residesAbroad / outsideUs                    yes                                 (N-400)
 *   longTrips / absences                         yes                                 (N-400)
 *   priorEad / hadEad                            yes                                 (I-765)
 *   category / eadCategory / pendingI485         (c)(9) | yes                        (I-765)
 *   pendingAsylum / pendingI589                  (c)(8) | yes                        (I-765)
 *   reason / replacementReason                   lost | stolen | destroyed | never received | mutilated | name change | expired (I-90)
 *   nameChanged / legalNameChange                yes                                 (I-90)
 *
 * A missing answer never blocks the case: the predicates default to the most
 * common situation for that case type (see each item's `conditional`).
 */
import type { Citation } from "@/db/schema";
import type { CaseType } from "./index";

export type IntakeAnswers = Record<string, string>;

export type ChecklistTemplateItem = {
  /** Stable identifier inside a case type, e.g. "birth_certificate". */
  key: string;
  /** Short client-facing name. Becomes checklist_items.doc_name. */
  docName: string;
  /** Plain language: what the document is and what it must show. */
  description: string;
  /** Verbatim USCIS sentence backing the requirement. */
  sourceCitation: Citation;
  /** Include the item only when this returns true. Omitted = always required. */
  conditional?: (answers: IntakeAnswers) => boolean;
};

/** When the quotes below were read from uscis.gov. */
export const RETRIEVED_AT = "2026-09-12T17:05:19.000Z";

const TRANSLATION_NOTE =
  "If it is not in English, also send a full English translation and a signed statement from the translator saying the translation is complete and accurate and that they can translate that language.";

// ---------- answer helpers ----------

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getAnswer(answers: IntakeAnswers, keys: string[]): string | undefined {
  const table = new Map<string, string>();
  for (const [k, v] of Object.entries(answers)) {
    const value = String(v ?? "").trim().toLowerCase();
    if (value) table.set(norm(k), value);
  }
  for (const k of keys) {
    const v = table.get(norm(k));
    if (v) return v;
  }
  return undefined;
}

const YES = /^(y|yes|true|1|si|sí|oui|sim)$/i;

function isYes(answers: IntakeAnswers, keys: string[]): boolean {
  const v = getAnswer(answers, keys);
  return v !== undefined && YES.test(v);
}

function has(answers: IntakeAnswers, keys: string[], re: RegExp): boolean {
  const v = getAnswer(answers, keys);
  return v !== undefined && re.test(v);
}

export type I130Relationship = "spouse" | "child" | "parent" | "sibling";
export type I90Reason = "lost" | "never_received" | "mutilated" | "name_change" | "expired";

/** Readers for the intake answers each checklist depends on. Exported so intake can reuse them. */
export const intakeAnswers = {
  married: (a: IntakeAnswers): boolean =>
    isYes(a, ["married", "isMarried"]) || has(a, ["maritalStatus", "marital"], /married|casad/),
  priorNotices: (a: IntakeAnswers): boolean =>
    isYes(a, ["priorNotices", "hasPriorNotices", "priorUscisNotices", "receivedNotices", "uscisNotices"]),
  priorMarriage: (a: IntakeAnswers): boolean => isYes(a, ["priorMarriage", "previouslyMarried", "priorMarriages"]),
  relationship: (a: IntakeAnswers): I130Relationship | undefined => {
    const v = getAnswer(a, ["relationship", "relative", "beneficiaryRelationship", "petitionFor"]);
    if (!v) return undefined;
    if (/spouse|husband|wife|espos|cónyuge|conyuge|marri/.test(v)) return "spouse";
    if (/child|son|daughter|hij/.test(v)) return "child";
    if (/parent|mother|father|madre|padre/.test(v)) return "parent";
    if (/sibling|brother|sister|herman/.test(v)) return "sibling";
    return undefined;
  },
  marriageBasis: (a: IntakeAnswers): boolean =>
    isYes(a, ["marriedToCitizen", "marriedToUsCitizen", "spouseIsCitizen"]) ||
    has(a, ["basis", "filingBasis", "eligibilityBasis"], /marri|spouse|319|matrimon|cónyuge|conyuge|espos/),
  residesAbroad: (a: IntakeAnswers): boolean =>
    isYes(a, ["residesAbroad", "outsideUs", "livesAbroad", "residesOutsideUs", "livingOutsideUs"]),
  longTrips: (a: IntakeAnswers): boolean =>
    isYes(a, ["longTrips", "tripsOver6Months", "absences", "longAbsences", "extendedTravel"]),
  priorEad: (a: IntakeAnswers): boolean => isYes(a, ["priorEad", "hadEad", "previousEad", "hasEad"]),
  eadCategory: (a: IntakeAnswers): string | undefined => {
    const v = getAnswer(a, ["category", "eadCategory", "eligibilityCategory"]);
    return v ? norm(v) : undefined;
  },
  pendingI485: (a: IntakeAnswers): boolean =>
    isYes(a, ["pendingI485", "hasPendingI485", "i485Pending"]) || intakeAnswers.eadCategory(a) === "c9",
  pendingAsylum: (a: IntakeAnswers): boolean =>
    isYes(a, ["pendingAsylum", "pendingI589", "asylumPending"]) || intakeAnswers.eadCategory(a) === "c8",
  cardReason: (a: IntakeAnswers): I90Reason | undefined => {
    const v = getAnswer(a, ["reason", "replacementReason", "i90Reason", "whyReplace"]);
    if (!v) return undefined;
    if (/never|not receiv|nunca|no lleg/.test(v)) return "never_received";
    if (/lost|stolen|destroy|perd|rob|missing/.test(v)) return "lost";
    if (/mutilat|damag|dañad|broken/.test(v)) return "mutilated";
    if (/name|biograph|nombre|incorrect|wrong|error|typo/.test(v)) return "name_change";
    if (/expir|venc|renew/.test(v)) return "expired";
    return undefined;
  },
  nameChanged: (a: IntakeAnswers): boolean =>
    isYes(a, ["nameChanged", "legalNameChange", "hasNameChanged", "nameChange"]) ||
    intakeAnswers.cardReason(a) === "name_change",
};

// ---------- sources ----------

const I485_SRC = {
  title: "Checklist of Required Initial Evidence for Form I-485 (for informational purposes only)",
  url: "https://www.uscis.gov/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-i-485-for-informational-purposes-only",
};
const N400_SRC = { title: "N-400, Application for Naturalization", url: "https://www.uscis.gov/n-400" };
const I130_SRC = { title: "I-130, Petition for Alien Relative", url: "https://www.uscis.gov/i-130" };
const I765_SRC = {
  title: "Checklist of Required Initial Evidence for Form I-765 (for informational purposes only)",
  url: "https://www.uscis.gov/forms/filing-guidance/checklist-of-required-initial-evidence-for-form-i-765-for-informational-purposes-only",
};
const I90_SRC = {
  title: "Form I-90 Instructions — Instructions for Application to Replace Permanent Resident Card",
  url: "https://www.uscis.gov/sites/default/files/document/forms/i-90instr.pdf",
};

function cite(src: { title: string; url: string }, quote: string): Citation {
  return { title: src.title, url: src.url, quote, retrievedAt: RETRIEVED_AT };
}

/** USCIS's own translation rule for each form, for templates and the console. */
export const TRANSLATION_REQUIREMENTS: Record<CaseType, Citation> = {
  "I-485": cite(
    I485_SRC,
    "If you submit any documents (copies or original documents, if requested) in a foreign language, you must include a full English translation along with a certification from the translator verifying that the translation is complete and accurate, and that they are competent to translate from the foreign language to English.",
  ),
  "N-400": cite(
    N400_SRC,
    "If you submit any documents (copies or original documents, if requested) in a foreign language, you must include a full English translation along with a certification from the translator verifying that the translation is complete and accurate, and that the translator is competent to translate from the foreign language into English.",
  ),
  "I-130": cite(
    I130_SRC,
    "If you submit any documents (copies or original documents, if requested) in a foreign language, you must include a full English translation along with a certification from the translator verifying that the translation is complete and accurate, and that they are competent to translate from the foreign language into English.",
  ),
  "I-765": cite(
    I765_SRC,
    "If you submit any documents (copies or original documents, if requested) in a foreign language, you must include a full English translation along with a certification from the translator verifying that the translation is complete and accurate, and that they are competent to translate from the foreign language to English.",
  ),
  "I-90": cite(
    I90_SRC,
    "If you submit a document with information in a foreign language, you must also submit a full English translation. The translator must sign a certification that the English language translation is complete and accurate, and that he or she is competent to translate from the foreign language into English.",
  ),
};

// ---------- I-485 · Adjustment of Status ----------

const I485: ChecklistTemplateItem[] = [
  {
    key: "passport_photos",
    docName: "Two passport-style photographs",
    description:
      "Two identical color photos of you, 2 x 2 inches, taken within the last 30 days, with a plain white background and your full face showing. Send a clear picture or scan of both photos together.",
    sourceCitation: cite(I485_SRC, "Two passport-style photographs;"),
  },
  {
    key: "government_id",
    docName: "Passport biographic page (government-issued photo ID)",
    description:
      "A copy of the page of your passport with your photo, full name, date of birth, and passport number. If you have no passport, a copy of another government-issued identity document that has your photograph.",
    sourceCitation: cite(I485_SRC, "A copy of your government-issued identity document with photograph;"),
  },
  {
    key: "birth_certificate",
    docName: "Birth certificate (with certified English translation)",
    description: `A copy of your birth certificate issued by the civil registry of the country where you were born, showing your full name, date and place of birth, and your parents' names. ${TRANSLATION_NOTE} If no birth certificate exists, send other proof of birth (church, school, or medical records) and proof that the certificate is unavailable.`,
    sourceCitation: cite(
      I485_SRC,
      "A copy of your birth certificate (if your birth certificate is unavailable or does not exist, provide other acceptable evidence of birth such as church, school, or medical records, and proof of unavailability or nonexistence, if applicable);",
    ),
  },
  {
    key: "entry_record",
    docName: "Form I-94 or other record of your last entry",
    description:
      "A copy of your Form I-94 Arrival/Departure Record (front and back, or the printout from the CBP I-94 website), or the passport page with the admission or parole stamp, showing the date and the way you last entered the United States.",
    sourceCitation: cite(
      I485_SRC,
      "Inspection and admission, or inspection and parole documentation (unless applying for adjustment under section 245(i) of the Immigration and Nationality Act [INA])",
    ),
  },
  {
    key: "i693_medical",
    docName: "Form I-693, Report of Immigration Medical Examination and Vaccination Record",
    description:
      "The medical exam form completed and signed by a USCIS-designated civil surgeon. It must show the doctor's signature and the exam date. Keep the sealed envelope the doctor gave you; send us a copy of the receipt or the front page, and do not open the sealed envelope.",
    sourceCitation: cite(
      I485_SRC,
      "Form I-693, Report of Immigration Medical Examination and Vaccination Record, or a partial Form I-693 (if applicable). If you are required to submit a Form I-693 or a partial Form I-693, you must submit it with your Form I-485. Otherwise, your Form I-485 may be rejected.",
    ),
  },
  {
    key: "marriage_certificate",
    docName: "Marriage certificate (with certified English translation)",
    description: `A copy of your civil marriage certificate showing both spouses' full names and the date and place of the marriage. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(
      I485_SRC,
      "A copy of your marriage certificate to the principal applicant or proof of relationship as a child to the principal applicant.",
    ),
    conditional: intakeAnswers.married,
  },
  {
    key: "prior_uscis_notices",
    docName: "Prior USCIS notices (Form I-797, Notice of Action)",
    description:
      "Copies of any receipt or approval notices USCIS has already mailed you, especially the notice for the Form I-130 petition filed for you. Each notice shows a receipt number that starts with three letters.",
    sourceCitation: cite(
      I485_SRC,
      "Documentation of immigrant category, such as a copy of the approval or receipt notice (Form I-797, Notice of Action), for the Form I-130 filed on your behalf (unless you are filing your Form I-485 with the Form I-130 filed on your behalf);",
    ),
    conditional: intakeAnswers.priorNotices,
  },
];

// ---------- N-400 · Naturalization ----------

const N400: ChecklistTemplateItem[] = [
  {
    key: "green_card",
    docName: "Permanent Resident Card (Green Card), front and back",
    description:
      "A copy of both sides of your current Green Card (Form I-551). It must show your photo, name, A-Number, and the card expiration date clearly.",
    sourceCitation: cite(N400_SRC, "A copy of your Permanent Resident Card (also known as a Green Card) (both sides)"),
  },
  {
    key: "marriage_certificate",
    docName: "Marriage certificate (with certified English translation)",
    description: `A copy of your civil marriage certificate to your U.S. citizen spouse, showing both full names and the date and place of the marriage. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(N400_SRC, "A copy of your marriage certificate;"),
    conditional: intakeAnswers.marriageBasis,
  },
  {
    key: "spouse_citizenship",
    docName: "Proof of your spouse's U.S. citizenship",
    description:
      "A copy of one document showing your spouse has been a U.S. citizen for at least the last 3 years: their U.S. birth certificate, Certificate of Naturalization, Certificate of Citizenship, the photo page of their current U.S. passport, or Form FS-240.",
    sourceCitation: cite(
      N400_SRC,
      "Evidence of U.S. citizenship for spouse for the last 3 years, generally a copy of your spouse’s: U.S. birth certificate; Certificate of Naturalization; Certificate of Citizenship; Biographical page of their current U.S. passport; or Report of Birth Abroad of a Citizen of the United States of America (Form FS-240).",
    ),
    conditional: intakeAnswers.marriageBasis,
  },
  {
    key: "prior_marriage_termination",
    docName: "Proof that all earlier marriages ended (yours and your spouse's)",
    description: `A copy of the divorce decree, annulment, or death certificate for every earlier marriage of you or your spouse. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(
      N400_SRC,
      "Evidence of termination of all prior marriages for you and your spouse, such as divorce decree(s), annulment(s), and death certificate(s).",
    ),
    conditional: intakeAnswers.marriageBasis,
  },
  {
    key: "passport_entry_exit",
    docName: "Passport pages showing your entry and exit stamps",
    description:
      "Copies of the photo page of your passport and every page with a stamp from entering or leaving the United States, so each trip's dates can be read.",
    sourceCitation: cite(N400_SRC, "Your passport showing entry and exit stamps;"),
    conditional: intakeAnswers.longTrips,
  },
  {
    key: "tax_transcripts",
    docName: "IRS tax transcripts",
    description:
      "IRS tax return transcripts for the last 3 years (or 5 years if not applying based on marriage). Each transcript must show the tax year and your name.",
    sourceCitation: cite(
      N400_SRC,
      "IRS tax transcripts; and Any other document that shows that you maintained your residence in the United States.",
    ),
    conditional: (a) => intakeAnswers.marriageBasis(a) || intakeAnswers.longTrips(a),
  },
  {
    key: "passport_photos",
    docName: "Two passport-style photographs",
    description:
      "Two identical color photos of you, 2 x 2 inches, taken within the last 30 days, plain white background, full face showing. Only needed because you live outside the United States.",
    sourceCitation: cite(N400_SRC, "Two passport-style photographs (if you reside outside the United States)"),
    conditional: intakeAnswers.residesAbroad,
  },
];

// ---------- I-130 · Petition for Alien Relative ----------

const isSpouse = (a: IntakeAnswers) => intakeAnswers.relationship(a) === "spouse";
const isBloodRelative = (a: IntakeAnswers) => {
  const r = intakeAnswers.relationship(a);
  return r === "child" || r === "parent" || r === "sibling";
};

const I130: ChecklistTemplateItem[] = [
  {
    key: "petitioner_status",
    docName: "Proof the petitioner is a U.S. citizen or permanent resident",
    description:
      "A copy of one document for the person filing the petition: their U.S. birth certificate, Certificate of Naturalization or Citizenship, unexpired U.S. passport, Form FS-240, or the front and back of their Green Card (Form I-551).",
    sourceCitation: cite(
      I130_SRC,
      "A copy of your birth certificate, issued by a civil registrar, vital statistics office, or other civil authority showing you were born in the United States; A copy of your naturalization or citizenship certificate issued by USCIS or the former Immigration and Naturalization Service (INS); A copy of Form FS-240, Consular Report of Birth Abroad (CRBA), issued by a U.S. Embassy or U.S. Consulate; A copy of your unexpired U.S. passport; An original statement from a U.S. consular officer verifying you are a U.S. citizen with a valid passport; or A copy of the front and back of your Permanent Resident Card (also known as a Green Card or a Form I-551).",
    ),
  },
  {
    key: "marriage_certificate",
    docName: "Marriage certificate (with certified English translation)",
    description: `A copy of the civil marriage certificate showing both spouses' full names and the date and place of the marriage. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(I130_SRC, "Spouse: A copy of your marriage certificate"),
    conditional: isSpouse,
  },
  {
    key: "prior_marriage_termination",
    docName: "Proof that all earlier marriages ended",
    description: `A copy of the divorce decree, annulment, or death certificate for every earlier marriage of either spouse. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(I130_SRC, "Evidence you or your spouse terminated any prior marriages (if applicable)"),
    conditional: (a) => isSpouse(a) && intakeAnswers.priorMarriage(a),
  },
  {
    key: "bona_fides",
    docName: "Proof the marriage is genuine",
    description:
      "Documents showing you share a life together: a lease or deed with both names, joint bank or credit card statements, birth certificates of children you have together, or signed statements from people who know you as a couple (with their full name, address, date and place of birth, and how they know you).",
    sourceCitation: cite(
      I130_SRC,
      "Documentation showing joint ownership of property; A lease showing joint tenancy of a common residence, meaning you both live at the same address together; Documentation showing that you and your spouse have combined your financial resources; Birth certificates of children born to you and your spouse together; Affidavits sworn to or affirmed by third parties having personal knowledge of the bona fides of the marital relationship.",
    ),
    conditional: isSpouse,
  },
  {
    key: "relationship_birth_certificate",
    docName: "Birth certificate showing the family relationship (with certified English translation)",
    description: `The birth certificate that links you and your relative: the child's certificate naming the parent, your own certificate naming your parent, or both certificates showing you and your sibling share a parent. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(
      I130_SRC,
      "Child: A copy of your child’s birth certificate(s). Parent: A copy of your birth certificate. Brother/Sister: A copy of the birth certificate for you and your sibling.",
    ),
    conditional: isBloodRelative,
  },
  {
    key: "relationship_evidence",
    docName: "Proof of the family relationship",
    description: `The document that proves how you are related: a marriage certificate for a spouse, or the birth certificate(s) naming the shared parent for a child, parent, or sibling. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(
      I130_SRC,
      "Evidence of family relationship with 1 of the following (see form instructions for more detailed guidance): Spouse: A copy of your marriage certificate Evidence you or your spouse terminated any prior marriages (if applicable) Child: A copy of your child’s birth certificate(s). Parent: A copy of your birth certificate. Brother/Sister: A copy of the birth certificate for you and your sibling.",
    ),
    conditional: (a) => intakeAnswers.relationship(a) === undefined,
  },
  {
    key: "passport_photos",
    docName: "Passport-style photographs of the petitioner and the spouse",
    description:
      "One identical color photo of each spouse, 2 x 2 inches, taken within the last 30 days, plain white background, full face showing.",
    sourceCitation: cite(I130_SRC, "2 passport-style photographs (if applicable)."),
    conditional: isSpouse,
  },
];

// ---------- I-765 · Employment Authorization ----------

const I765: ChecklistTemplateItem[] = [
  {
    key: "entry_record",
    docName: "Form I-94 (front and back) or passport / travel document",
    description:
      "A copy of your Form I-94 Arrival/Departure Record, front and back (or the printout from the CBP I-94 website), or the photo page of your passport or other travel document showing your name and the date you last entered.",
    sourceCitation: cite(
      I765_SRC,
      "A copy of your Form I-94, Arrival/Departure Record (front and back), a printout of your electronic Form I-94, your passport or other travel document;",
    ),
  },
  {
    key: "passport_photos",
    docName: "Two identical passport-style photographs",
    description:
      "Two identical color photos of you, 2 x 2 inches, taken within the last 30 days, plain white background, full face showing. Send a clear picture or scan of both photos together.",
    sourceCitation: cite(I765_SRC, "Two identical passport-style photographs;"),
  },
  {
    key: "prior_ead",
    docName: "Your last Employment Authorization Document (EAD card), front and back",
    description:
      "A copy of both sides of the most recent work permit card USCIS issued you. It must show your photo, name, card number, and the expiration date.",
    sourceCitation: cite(I765_SRC, "A copy of your last Employment Authorization Document (EAD) (if applicable);"),
    conditional: intakeAnswers.priorEad,
  },
  {
    key: "government_id",
    docName: "Government-issued photo ID (passport biographic page or national ID)",
    description:
      "Because you have not had a work permit before: a copy of a government-issued identity document with your photo, such as your passport biographic page, national ID card, or a birth certificate together with a photo ID.",
    sourceCitation: cite(I765_SRC, "If you were not previously issued an EAD, a copy of a government-issued identity document."),
    conditional: (a) => !intakeAnswers.priorEad(a),
  },
  {
    key: "pending_i485_receipt",
    docName: "Form I-485 receipt notice (Form I-797C)",
    description:
      "A copy of the receipt notice USCIS mailed you for your pending green card application (Form I-485). It shows a receipt number that starts with three letters and the date the application was received.",
    sourceCitation: cite(
      I765_SRC,
      "Evidence of a pending I-485 under INA 245 (for example, a copy of your Form I-485 receipt notice or other evidence).",
    ),
    conditional: intakeAnswers.pendingI485,
  },
  {
    key: "pending_asylum_receipt",
    docName: "Proof your asylum application (Form I-589) was filed",
    description:
      "A copy of the USCIS Acknowledgment of Receipt and interview notice, the Form I-797C biometrics appointment notice, or the first page of your Form I-589 stamped with the received date by the immigration court.",
    sourceCitation: cite(
      I765_SRC,
      "Evidence of a lodged or filed Form I-589 with USCIS or EOIR: If filed with USCIS, provide a copy of your USCIS Acknowledgment of Receipt and USCIS Asylum Interview Notice; or your Form I-797C application support center appointment notice; any other evidence of a filed Form I-589;",
    ),
    conditional: intakeAnswers.pendingAsylum,
  },
];

// ---------- I-90 · Replace Green Card ----------

const cardGone = (a: IntakeAnswers) => {
  const r = intakeAnswers.cardReason(a);
  return r === "lost" || r === "never_received";
};
const I90_ID_QUOTE =
  "Submit a copy of your Permanent Resident Card, if you have one, or a government-issued form of identification that contains your name, date of birth, photograph, and signature (for example, passport, driver’s license, or military identification document).";

const I90: ChecklistTemplateItem[] = [
  {
    key: "green_card",
    docName: "Current Permanent Resident Card (Green Card), front and back",
    description:
      "A copy of both sides of the Green Card you have now, even if it is expired or damaged. It must show your photo, name, A-Number, and the expiration date.",
    sourceCitation: cite(I90_SRC, I90_ID_QUOTE),
    conditional: (a) => !cardGone(a),
  },
  {
    key: "government_id",
    docName: "Government-issued photo ID with your signature (passport or driver's license)",
    description:
      "A copy of an identity document issued by a government that shows your name, date of birth, photograph, and signature, for example your passport biographic page, driver's license, or military ID.",
    sourceCitation: cite(I90_SRC, I90_ID_QUOTE),
    conditional: (a) => cardGone(a) || intakeAnswers.cardReason(a) === "mutilated" || intakeAnswers.cardReason(a) === undefined,
  },
  {
    key: "i797_notice",
    docName: "Latest Form I-797, Notice of Action, for the application that approved your green card",
    description:
      "A copy of the most recent USCIS notice (Form I-797) for the form that should have led to your card, usually the Form I-485 approval notice. It shows a receipt number that starts with three letters.",
    sourceCitation: cite(
      I90_SRC,
      "Submit a copy of the latest Form I-797, Notice of Action, for any of the following forms that should have resulted in issuance of your Permanent Resident Card: Form I-485, Application to Register Permanent Residence or Adjust Status; Form I-751, Petition to Remove the Conditions of Residence; Form I-829, Petition by Entrepreneur to Remove Conditions; Form I-698, Application to Adjust Status from Temporary to Permanent Resident; Form I-881, Application for Suspension of Deportation or Special Rule Cancellation of Removal (Pursuant to Section 203 of Public Law 105-100 (NACARA)); EOIR-42B, Application for Cancellation and Adjustment of Status for Certain Nonpermanent Residents; or Form I-90.",
    ),
    conditional: (a) => intakeAnswers.cardReason(a) === "never_received",
  },
  {
    key: "name_change_docs",
    docName: "Legal name change document (marriage certificate, divorce decree, or court order)",
    description: `A copy of the registered document that legally changed your name or corrected your personal details: a marriage certificate, divorce decree, adoption decree, or court order. It must be registered with the civil authority that issued it. ${TRANSLATION_NOTE}`,
    sourceCitation: cite(
      I90_SRC,
      "If your name has been legally changed to another name, you must submit appropriate legal documents that reflect the name change (for example, a registered copy of your marriage certificate, divorce decree, adoption decree, or other court-issued document showing your name was legally changed). A marriage certificate or court documents submitted as evidence of name change must have been registered with the proper civil authority.",
    ),
    conditional: intakeAnswers.nameChanged,
  },
];

// ---------- public API ----------

export const CHECKLISTS: Record<CaseType, ChecklistTemplateItem[]> = {
  "I-485": I485,
  "N-400": N400,
  "I-130": I130,
  "I-765": I765,
  "I-90": I90,
};

/** The full curated template for a case type (conditionals not applied). */
export function getChecklistTemplate(caseType: CaseType): ChecklistTemplateItem[] {
  return CHECKLISTS[caseType];
}

/** The items a specific case needs, given its intake answers. Order is preserved. */
export function selectChecklistItems(caseType: CaseType, answers: IntakeAnswers = {}): ChecklistTemplateItem[] {
  return CHECKLISTS[caseType].filter((item) => item.conditional?.(answers) ?? true);
=======
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
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
}
