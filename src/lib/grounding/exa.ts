import "server-only";
import Exa from "exa-js";
import type { Citation } from "@/db/schema";
import { log } from "@/lib/log";

/**
 * Exa search restricted to USCIS sources. This is the ONLY retrieval path in the
 * app; every Citation in the database originates here.
 */

const logger = log.scope("exa");

/** Domains the agent may cite. Keep this list short and official. */
export const ALLOWED_DOMAINS = ["uscis.gov"];

export type Passage = {
  index: number; // 0-based, referenced by the model as citationIndex
  title: string;
  url: string;
  quote: string; // the highlight actually shown to the model
  score?: number;
};

let exa: Exa | null = null;

export function isExaConfigured(): boolean {
  return Boolean(process.env.EXA_API_KEY);
}

function getExa(): Exa {
  if (!exa) {
    if (!isExaConfigured()) throw new Error("EXA_API_KEY is not set");
    exa = new Exa(process.env.EXA_API_KEY);
  }
  return exa;
}

export type RetrieveOptions = {
  numResults?: number;
  /** Extra query hint, e.g. the form number ("I-485") to bias retrieval. */
  hint?: string;
  highlightsPerUrl?: number;
  numSentences?: number;
};

/**
 * Retrieve candidate passages from uscis.gov for a question or term.
 * Returns [] when Exa is not configured or nothing usable comes back —
 * callers must then refuse to answer (spec §4).
 */
export async function retrievePassages(query: string, opts: RetrieveOptions = {}): Promise<Passage[]> {
  if (!isExaConfigured()) {
    logger.warn("EXA_API_KEY missing; retrieval disabled");
    return [];
  }
  const q = opts.hint ? `${opts.hint} ${query}` : query;
  try {
    const res = await getExa().searchAndContents(q, {
      type: "auto",
      numResults: opts.numResults ?? 5,
      includeDomains: ALLOWED_DOMAINS,
      highlights: {
        query,
        numSentences: opts.numSentences ?? 3,
        highlightsPerUrl: opts.highlightsPerUrl ?? 2,
      },
    });
    const passages: Passage[] = [];
    for (const r of res.results) {
      if (!isAllowedUrl(r.url)) continue;
      const highlights: string[] = Array.isArray(r.highlights) ? r.highlights : [];
      for (const h of highlights) {
        const quote = h.trim();
        if (quote.length < 20) continue;
        passages.push({ index: passages.length, title: r.title ?? r.url, url: r.url, quote, score: r.score });
      }
    }
    logger.info("retrieved", { query: q.slice(0, 80), results: res.results.length, passages: passages.length });
    return passages;
  } catch (err) {
    logger.error("search failed", { err: String(err) });
    return [];
  }
}

export function isAllowedUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function toCitation(p: Passage): Citation {
  return { title: p.title, url: p.url, quote: p.quote, retrievedAt: new Date().toISOString() };
}

/** Render passages for a prompt. The model must reference them by index. */
export function formatPassagesForPrompt(passages: Passage[]): string {
  return passages
    .map((p) => `[${p.index}] ${p.title}\nURL: ${p.url}\nPASSAGE: "${p.quote}"`)
    .join("\n\n");
}
