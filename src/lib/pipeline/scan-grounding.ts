import "server-only";
import type { Citation } from "@/db/schema";
import { curatedCitation, type CuratedSourceKey } from "@/lib/grounding/catalog";
import { isExaConfigured, retrievePassages, toCitation, type Passage } from "@/lib/grounding/exa";
import { log } from "@/lib/log";
import type { RuleId } from "./scan-rules";

/**
 * Attaching a source to a scan finding (spec §4 "no grounding, no output").
 *
 * There are two kinds of finding and they are grounded by different rules:
 *
 *   DETERMINISTIC — produced by `runScanRules()`, which is code a person wrote and
 *   reviewed. Live retrieval is tried first; if Exa is unavailable or returns nothing,
 *   the rule falls back to the curated USCIS passage it was written against
 *   (`RULE_SOURCES` below). That passage is pinned to the rule at authoring time, so
 *   the citation is still something a human checked — it just was not fetched today.
 *
 *   MODEL — discovered by the strong-tier pass over the packet. NO fallback. The model
 *   must point at a passage that was actually retrieved for that finding, and a finding
 *   whose citation index does not resolve is dropped. A model claim with a citation
 *   nobody retrieved is exactly the failure the grounding rule exists to prevent.
 */

const logger = log.scope("scan:ground");

/** The USCIS passage each deterministic rule was written against. */
export const RULE_SOURCES: Record<RuleId, CuratedSourceKey> = {
  name_mismatch: "evidence.legal_name_change",
  dob_mismatch: "evidence.birth_certificate",
  id_expiration: "evidence.unexpired_green_card",
  blank_required_field: "filing.complete_all_fields",
  address_mismatch: "filing.complete_all_fields",
  missing_translation: "filing.translation",
  illegible_document: "filing.legible_copies",
};

export type GroundedCitation = { citation: Citation; via: "exa" | "curated" };

/**
 * A citation for a deterministic rule finding: freshly retrieved when possible,
 * the rule's curated source otherwise. Never null — every rule has a source.
 */
export async function groundRuleFinding(input: { rule: RuleId; query: string; hint?: string }): Promise<GroundedCitation> {
  if (isExaConfigured()) {
    const passages = await retrievePassages(input.query, { hint: input.hint, numResults: 3, highlightsPerUrl: 1 });
    if (passages.length > 0) return { citation: toCitation(passages[0]), via: "exa" };
    logger.info("no live passage for rule; using curated source", { rule: input.rule });
  }
  return { citation: curatedCitation(RULE_SOURCES[input.rule]), via: "curated" };
}

/**
 * A citation for a model-discovered finding. Returns null — and the caller drops the
 * finding — when the index does not point at a passage that was actually retrieved.
 */
export function groundModelFinding(passages: Passage[], citationIndex: number | null | undefined): Citation | null {
  if (citationIndex === null || citationIndex === undefined) return null;
  const passage = passages.find((p) => p.index === citationIndex);
  if (!passage) {
    logger.warn("model finding cited a passage that was not retrieved", { citationIndex });
    return null;
  }
  return toCitation(passage);
}
