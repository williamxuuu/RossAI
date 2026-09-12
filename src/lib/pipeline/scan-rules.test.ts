import { describe, expect, it } from "vitest";
import {
  datesMatch,
  normalizeAddress,
  normalizeName,
  parseDateCandidates,
  runScanRules,
  ruleDobMismatch,
  type ScanDocument,
  type ScanPacket,
} from "./scan-rules";

/**
 * The deterministic scan. These rules decide what a paralegal sees, so the tests are
 * mostly about what must NOT be flagged: a wrong flag costs more than a missing one,
 * because it teaches people to skim the list.
 */

function doc(id: string, fields: Record<string, string>, extra: Partial<ScanDocument> = {}): ScanDocument {
  return {
    id,
    checklistItemName: extra.checklistItemName ?? id,
    checklistItemStatus: extra.checklistItemStatus ?? "received",
    docType: extra.docType ?? null,
    originalFilename: extra.originalFilename ?? `${id}.pdf`,
    legibilityOk: extra.legibilityOk ?? true,
    extracted: { docType: extra.docType ?? "unknown", summary: "", fields, ...(extra.extracted ?? {}) },
  };
}

function packet(documents: ScanDocument[]): ScanPacket {
  return {
    caseId: "case",
    caseType: "I-485",
    clientLanguage: "es",
    intakeAnswers: {},
    checklistItems: documents.map((d) => ({ id: d.id, docName: d.checklistItemName ?? d.id, status: "received" })),
    documents,
  };
}

describe("normalizeName", () => {
  it("treats accents, case, punctuation and word order as the same name", () => {
    expect(normalizeName("María Elena García López")).toBe(normalizeName("GARCIA LOPEZ MARIA ELENA"));
    expect(normalizeName("Jean-Luc O'Brien")).toBe(normalizeName("obrien jean luc"));
  });

  it("keeps a genuinely different name different", () => {
    expect(normalizeName("Maria Elena Garcia Lopez")).not.toBe(normalizeName("Maria E. Garcia"));
  });
});

describe("normalizeAddress", () => {
  it("treats abbreviations, unit markers and state codes as the same address", () => {
    expect(normalizeAddress("412 W Main Street Apt 3, Houston, TX 77002")).toBe(
      normalizeAddress("412 West Main St. #3, Houston, Texas 77002"),
    );
  });

  it("keeps a different street number different", () => {
    expect(normalizeAddress("412 W Main St, Houston TX")).not.toBe(normalizeAddress("214 W Main St, Houston TX"));
  });
});

describe("parseDateCandidates / datesMatch", () => {
  it("reads a day/month date and a month/day date as possibly the same", () => {
    expect(datesMatch("14/03/1988", "03/14/1988")).toBe(true);
  });

  it("reports a genuine disagreement", () => {
    expect(datesMatch("14/03/1988", "03/04/1988")).toBe(false);
  });

  it("refuses to compare what it cannot parse", () => {
    expect(parseDateCandidates("sometime in 88")).toEqual([]);
    expect(datesMatch("14/03/1988", "unknown")).toBeNull();
  });

  it("reads a written month in English and Spanish", () => {
    expect(parseDateCandidates("14 MAR 1988")).toContain("1988-03-14");
    expect(parseDateCandidates("14 de marzo de 1988")).toContain("1988-03-14");
  });
});

describe("ruleDobMismatch", () => {
  it("names one document per distinct date, not every document", () => {
    // Two documents agree and one disagrees: the finding must describe two dates.
    const findings = ruleDobMismatch(
      packet([
        doc("birth certificate", { dateOfBirth: "14/03/1988" }),
        doc("marriage certificate", { dateOfBirth: "14/03/1988" }),
        doc("notice", { dateOfBirth: "03/04/1988" }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toContain("14/03/1988");
    expect(findings[0].description).toContain("03/04/1988");
    expect(findings[0].description.match(/vs\./g)).toHaveLength(1);
    // Every document carrying a date of birth is still attached as evidence.
    expect(findings[0].evidenceDocumentIds).toHaveLength(3);
  });

  it("says nothing when every document agrees", () => {
    expect(
      ruleDobMismatch(packet([doc("a", { dateOfBirth: "14/03/1988" }), doc("b", { dateOfBirth: "14 MAR 1988" })])),
    ).toEqual([]);
  });
});

describe("runScanRules", () => {
  it("finds the contradictions and gaps in a packet, and nothing else", () => {
    const findings = runScanRules(
      packet([
        doc("Birth certificate", { fullName: "Maria Elena Garcia Lopez", dateOfBirth: "14/03/1988", language: "Espanol" }),
        doc("Passport", { fullName: "GARCIA LOPEZ MARIA ELENA", dateOfBirth: "14 MAR 1988", expirationDate: "2026-11-30" }),
        {
          ...doc("Notice", { fullName: "MARIA E. GARCIA", dateOfBirth: "03/04/1988" }),
          extracted: {
            docType: "uscis_notice",
            summary: "",
            fields: { fullName: "MARIA E. GARCIA", dateOfBirth: "03/04/1988" },
            blankRequiredFields: ["Receipt Number"],
          },
        },
      ]),
      { now: new Date("2026-09-12T00:00:00Z") },
    );
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual(["blank_required_field", "dob_mismatch", "id_expiration", "missing_translation", "name_mismatch"]);
  });

  it("flags nothing about a clean, consistent packet", () => {
    const findings = runScanRules(
      packet([
        doc("Birth certificate", { fullName: "Maria Elena Garcia Lopez", dateOfBirth: "14/03/1988", language: "English" }),
        doc("Passport", { fullName: "GARCIA LOPEZ MARIA ELENA", dateOfBirth: "14 MAR 1988", expirationDate: "2031-01-01" }),
      ]),
      { now: new Date("2026-09-12T00:00:00Z") },
    );
    expect(findings).toEqual([]);
  });

  it("does not report an expiring document as expired", () => {
    const findings = runScanRules(packet([doc("Passport", { expirationDate: "2026-11-30" })]), {
      now: new Date("2026-09-12T00:00:00Z"),
    });
    expect(findings[0].description).toContain("expires on 2026-11-30");
    expect(findings[0].description).not.toContain("expired");
  });
});
