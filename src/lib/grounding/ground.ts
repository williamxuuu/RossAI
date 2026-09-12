import "server-only";
import { z } from "zod";
import type { Citation } from "@/db/schema";
import { completeJson } from "@/lib/llm/client";
import { retrievePassages, toCitation, formatPassagesForPrompt, type Passage, type RetrieveOptions } from "./exa";
import { log } from "@/lib/log";

/**
 * The grounding gate (spec §4 "No grounding, no output").
 *
 *   ground(question) →
 *     { grounded: true,  text, citation }   the model answered strictly from a retrieved passage
 *     { grounded: false, reason }           nothing retrieved, model declined, or citation invalid
 *
 * The model only ever sees retrieved passages. It must return a citationIndex that
 * points at one of them, and we re-validate that index in code. Anything else is
 * treated as "no output" so the caller escalates instead of guessing.
 */

const logger = log.scope("ground");

export type Grounded =
  | { grounded: true; text: string; citation: Citation; passages: Passage[] }
  | { grounded: false; reason: "no_passages" | "model_declined" | "invalid_citation" | "llm_unavailable" | "advice_detected"; passages: Passage[] };

const AnswerSchema = z.object({
  canAnswer: z.boolean(),
  answer: z.string().default(""),
  citationIndex: z.number().int().nullable().default(null),
});

export type GroundOptions = RetrieveOptions & {
  /** ISO 639-1 code for the reply language, e.g. "es". Defaults to English. */
  language?: string;
  /** What the caller wants: an explanation of a term/field (default) or an answer to a question. */
  mode?: "explain" | "answer";
  /** Extra context the model may use for disambiguation (e.g. page URL, form number). Never cited. */
  context?: string;
};

export const NO_ADVICE_RULES = `You are helping a client of a pro bono immigration clinic understand official USCIS material.
STRICT RULES:
1. Use ONLY the numbered passages provided. Do not use outside knowledge.
2. Explain what a term, field, or instruction MEANS. NEVER say what the person should do, whether they qualify or are eligible, how they should answer a question, or what strategy to take. If the question asks for any of those, set canAnswer=false.
3. If no passage directly supports the explanation, set canAnswer=false.
4. Keep it under 90 words, plain language, no legal jargon without explaining it.
5. Return JSON: {"canAnswer": boolean, "answer": string, "citationIndex": number|null}. citationIndex must be the index of the single passage your answer is based on.`;

export async function ground(query: string, opts: GroundOptions = {}): Promise<Grounded> {
  const passages = await retrievePassages(query, opts);
  if (passages.length === 0) return { grounded: false, reason: "no_passages", passages };

  const language = opts.language ?? "en";
  const mode = opts.mode ?? "explain";
  const result = await completeJson({
    tier: "cheap",
    schema: AnswerSchema,
    system: `${NO_ADVICE_RULES}\nWrite the answer in the language with ISO code "${language}".`,
    user: [
      mode === "explain" ? `TERM OR FIELD TO EXPLAIN: ${query}` : `CLIENT QUESTION: ${query}`,
      opts.context ? `CONTEXT (not a source, do not cite): ${opts.context}` : "",
      "",
      "PASSAGES:",
      formatPassagesForPrompt(passages),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (!result) return { grounded: false, reason: "llm_unavailable", passages };
  if (!result.canAnswer || !result.answer.trim()) return { grounded: false, reason: "model_declined", passages };
  const idx = result.citationIndex;
  const passage = idx !== null ? passages.find((p) => p.index === idx) : undefined;
  if (!passage) {
    logger.warn("model returned invalid citationIndex", { idx });
    return { grounded: false, reason: "invalid_citation", passages };
  }
  if (containsAdvice(result.answer)) {
    logger.warn("advice language detected in grounded answer");
    return { grounded: false, reason: "advice_detected", passages };
  }
  return { grounded: true, text: result.answer.trim(), citation: toCitation(passage), passages };
}

/**
 * Cheap lexical backstop for the no-legal-advice rule. The prompt is the first
 * line of defense; this catches the obvious slips in English and Spanish.
 */
const ADVICE_PATTERNS: RegExp[] = [
  /\byou (should|must|need to|ought to|have to) (apply|file|answer|say|claim|choose|select|check|mark)\b/i,
  /\byou (are|aren't|are not|may be|might be) (eligible|ineligible|qualified)\b/i,
  /\byou (do|don't|do not) qualify\b/i,
  /\bI (recommend|advise|suggest) (that )?you\b/i,
  /\bmy advice\b/i,
  /\b(debes|deberías|tienes que|debe|debería|tiene que) (solicitar|presentar|responder|marcar|elegir|seleccionar)\b/i,
  /\b(eres|es|usted es|no eres|no es) elegible\b/i,
  /\bte recomiendo\b|\ble recomiendo\b/i,
];

export function containsAdvice(text: string): boolean {
  return ADVICE_PATTERNS.some((re) => re.test(text));
}
