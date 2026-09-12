import { describe, expect, it } from "vitest";
import { CURATED_KEYS, curatedCitation } from "./catalog";
import { isAllowedUrl } from "./exa";
import { RULE_SOURCES } from "@/lib/pipeline/scan-grounding";
import { CHECKLISTS } from "@/lib/casetypes/checklists";
import type { RuleId } from "@/lib/pipeline/scan-rules";

/**
 * The curated sources are the one place a citation is not fetched live, so they need
 * the same guarantees a retrieved one has: a real uscis.gov URL, a quote long enough
 * to mean something, and a date. A quote nobody can check is not a citation.
 */
describe("curated USCIS sources", () => {
  it("all point at uscis.gov", () => {
    for (const key of CURATED_KEYS) {
      expect(isAllowedUrl(curatedCitation(key).url), key).toBe(true);
    }
  });

  it("all carry a substantial quote and a retrieval date", () => {
    for (const key of CURATED_KEYS) {
      const citation = curatedCitation(key);
      expect(citation.quote.length, key).toBeGreaterThan(40);
      expect(citation.title.length, key).toBeGreaterThan(4);
      expect(Number.isNaN(Date.parse(citation.retrievedAt)), key).toBe(false);
    }
  });

  it("cover every deterministic scan rule, so no rule can produce an uncited flag", () => {
    const rules: RuleId[] = [
      "name_mismatch",
      "dob_mismatch",
      "id_expiration",
      "blank_required_field",
      "address_mismatch",
      "missing_translation",
      "illegible_document",
    ];
    for (const rule of rules) {
      expect(RULE_SOURCES[rule], rule).toBeTruthy();
      expect(isAllowedUrl(curatedCitation(RULE_SOURCES[rule]).url), rule).toBe(true);
    }
  });

  it("cover every checklist item of every case type", () => {
    for (const [caseType, template] of Object.entries(CHECKLISTS)) {
      expect(template.items.length, caseType).toBeGreaterThan(0);
      for (const item of template.items) {
        expect(isAllowedUrl(curatedCitation(item.citationKey).url), `${caseType}/${item.docName}`).toBe(true);
        expect(item.matchHints.length, `${caseType}/${item.docName}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Match hints are substring tests against a document's type and filename, so a
   * short one silently accepts the wrong paper: "id" is inside "resident" and
   * "evidence". Anything under four characters has to be a form number ("i94"),
   * which cannot appear inside an ordinary word.
   */
  it("never use a match hint so short it would match unrelated documents", () => {
    for (const template of Object.values(CHECKLISTS)) {
      for (const item of template.items) {
        for (const hint of item.matchHints) {
          const label = `${item.docName}: "${hint}"`;
          expect(hint.length, label).toBeGreaterThanOrEqual(3);
          if (hint.length < 4) expect(/\d/.test(hint), label).toBe(true);
        }
      }
    }
  });
});
