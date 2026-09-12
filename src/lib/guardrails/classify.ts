import "server-only";
import { z } from "zod";
import { completeJson, isLlmConfigured } from "@/lib/llm/client";
import { containsAdvice } from "@/lib/grounding/ground";
import { log } from "@/lib/log";

/**
 * The no-legal-advice gate (spec §4, docs/ARCHITECTURE.md §4).
 *
 *   classifyClientQuestion()  inbound — decides whether the agent may even try to
 *                             answer. "judgment" always escalates to a human.
 *   outboundAdviceCheck()     outbound — last check before model-authored text can
 *                             be queued for a client.
 *
 * Both are deterministic first and only consult the cheap model to *narrow* an
 * answer, never to widen it: a pattern that says "judgment" is final, and when the
 * model is unavailable an unclassifiable question is treated as judgment. The safe
 * direction is always "a person looks at it".
 */

const logger = log.scope("guardrails");

export type QuestionKind = "explain" | "status" | "judgment" | "other";

export type QuestionClassification = {
  kind: QuestionKind;
  /** "pattern" when a deterministic rule decided; "model" when the cheap tier did. */
  by: "pattern" | "model";
  /** Short machine-readable reason, recorded in the audit payload. */
  reason: string;
};

// ---------------------------------------------------------------------------
// deterministic patterns
// ---------------------------------------------------------------------------

/** Asking what to do / whether they qualify. Never answerable by the agent. */
const JUDGMENT_PATTERNS: RegExp[] = [
  /\bwhat should i\b|\bwhat do i do\b|\bwhat can i do\b/i,
  /\bshould i\b|\bdo i have to\b|\bdo i need to\b|\bcan i (still )?(apply|file|qualify|get|use|claim)\b/i,
  /\b(am|are) i (eligible|qualified|allowed|able)\b/i,
  /\bdo i qualify\b|\bwill i (get|be|qualify|lose|be denied|be approved)\b/i,
  /\bis it (ok|okay|safe|a problem|risky)\b/i,
  /\bwhat happens if i\b|\bwill they deport\b|\bcan they deport\b/i,
  /\bhow do i answer\b|\bwhat should i (say|put|write|answer|check|mark)\b/i,
  /\bwhich (option|box|answer) should i\b/i,
  // Spanish
  /\bqu[eé] (debo|tengo que|deber[ií]a) hacer\b|\bqu[eé] hago\b/i,
  /\b(soy|es|ser[ií]a) elegible\b|\bcalifico\b|\bpuedo (aplicar|solicitar|presentar)\b/i,
  /\bdebo (aplicar|solicitar|responder|marcar|firmar|decir)\b/i,
  /\bqu[eé] pasa si\b|\bme van a deportar\b|\bpueden deportarme\b/i,
  /\bc[oó]mo (debo|deber[ií]a) (responder|contestar|llenar)\b/i,
];

/** Asking what a word, field, or form means. Answerable if a USCIS source supports it. */
const EXPLAIN_PATTERNS: RegExp[] = [
  /\bwhat (does|do) .{1,80}\bmean\b/i,
  /\bwhat is (a|an|the)?\s?[a-z0-9-]/i,
  /\bwhat are\b/i,
  /\bmeaning of\b|\bdefinition of\b|\bexplain\b/i,
  /\bqu[eé] (significa|quiere decir)\b/i,
  /\bqu[eé] es (un|una|el|la)?\b|\bqu[eé] son\b/i,
  /\bexplic[ao]\b|\bsignificado de\b/i,
];

/** Asking where their case stands. Answered with a clinic-owned status template. */
const STATUS_PATTERNS: RegExp[] = [
  /\b(status|update) (of|on) my (case|application|papers)\b/i,
  /\bwhere (is|are) my\b|\bany (news|update)\b/i,
  /\bhow long (will|does) (it|this) take\b/i,
  /\bdid you (get|receive)\b|\bhave you (got|received)\b/i,
  /\bwhat (do|documents do) you still need\b|\bwhat('| i)?s (left|missing)\b/i,
  /\bc[oó]mo va mi (caso|solicitud)\b|\bhay (alguna )?noticia\b/i,
  /\brecibieron\b|\bles lleg[oó]\b|\bqu[eé] (falta|documentos faltan)\b/i,
];

/** Short acknowledgements and greetings — nothing to answer. */
const SMALLTALK = /^(hi|hello|hey|thanks?|thank you|ok(ay)?|yes|no|got it|hola|gracias|buenos d[ií]as|buenas tardes|s[ií]|bueno|vale)[\s!.,]*$/i;

/**
 * A question word only counts where a question would start it: at the beginning of
 * the text or of a sentence. English questions invert ("Are you…", "Do you…"), so
 * "Here are my papers" is a statement and "are" in the middle of it means nothing.
 */
const QUESTION_OPENER = /(^|[.!?¿\n]\s*)(what|when|where|which|who|why|how|can|could|should|do|does|did|is|are|will|would|qu[eé]|cu[aá]ndo|d[oó]nde|cu[aá]l|qui[eé]n|c[oó]mo|puedo|debo|tengo que|hay)\b/i;

/**
 * Is this text asking something?
 *
 * Used to tell a question from a cover note. An email that carries documents usually
 * says something like "here are my papers" — routing that through question handling
 * creates an escalation a paralegal has to clear for no reason, and the safe default
 * (anything unclassifiable is judgment) makes it happen every single time. A message
 * with no question mark, no question word, and attachments alongside it is a note.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[?¿]/.test(t)) return true;
  if (matchesAny(JUDGMENT_PATTERNS, t) || matchesAny(EXPLAIN_PATTERNS, t) || matchesAny(STATUS_PATTERNS, t)) return true;
  return QUESTION_OPENER.test(t);
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((re) => re.test(text));
}

/** Deterministic pass. Returns null when nothing matched and the model should decide. */
export function classifyByPattern(text: string): QuestionClassification | null {
  const t = text.trim();
  if (!t) return { kind: "other", by: "pattern", reason: "empty" };
  if (SMALLTALK.test(t)) return { kind: "other", by: "pattern", reason: "smalltalk" };
  if (matchesAny(JUDGMENT_PATTERNS, t)) return { kind: "judgment", by: "pattern", reason: "judgment_phrase" };
  if (matchesAny(STATUS_PATTERNS, t)) return { kind: "status", by: "pattern", reason: "status_phrase" };
  if (matchesAny(EXPLAIN_PATTERNS, t)) return { kind: "explain", by: "pattern", reason: "explain_phrase" };
  return null;
}

const ClassificationSchema = z.object({
  kind: z.enum(["explain", "status", "judgment", "other"]),
  reason: z.string().max(200).default(""),
});

const CLASSIFY_SYSTEM = `You sort text messages sent to a pro bono immigration clinic's intake assistant.
Choose exactly one label:
- "explain"  the person asks what a word, form field, or immigration term MEANS.
- "status"   the person asks about their own case progress, what the clinic still needs, or timing.
- "judgment" the person asks what they should do, whether they qualify or are eligible, how to answer a
             question on a form, what will happen to them, or anything needing a lawyer's judgment.
- "other"    greeting, thanks, an answer to a question the assistant asked, or anything else.
When a message mixes several of these, or you are unsure, choose "judgment" — a person will then read it.
Return JSON: {"kind": "...", "reason": "<max 12 words>"}.`;

/**
 * Classify one inbound client message.
 *
 * Deterministic patterns decide first. Only when nothing matches does the cheap
 * model get a say, and if it is unavailable the message is treated as needing
 * judgment so a paralegal sees it.
 */
export async function classifyClientQuestion(text: string): Promise<QuestionClassification> {
  const byPattern = classifyByPattern(text);
  if (byPattern) return byPattern;

  if (!isLlmConfigured()) {
    return { kind: "judgment", by: "pattern", reason: "unclassified_no_model" };
  }
  const result = await completeJson({
    tier: "cheap",
    schema: ClassificationSchema,
    system: CLASSIFY_SYSTEM,
    user: text.slice(0, 1500),
    temperature: 0,
    maxTokens: 200,
  });
  if (!result) {
    logger.warn("classification unavailable; treating as judgment");
    return { kind: "judgment", by: "pattern", reason: "model_unavailable" };
  }
  return { kind: result.kind, by: "model", reason: result.reason || "model" };
}

// ---------------------------------------------------------------------------
// outbound gate
// ---------------------------------------------------------------------------

export type AdviceCheck = { ok: true } | { ok: false; reason: string };

/** Eligibility / strategy language that must never leave the system unreviewed. */
const OUTBOUND_BLOCK_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\byou (are|aren't|are not|may be|might be|would be|will be) (eligible|ineligible|qualified|approved|denied)\b/i, reason: "eligibility_statement" },
  { re: /\byou (do|don't|do not|may|might|will) (not )?qualify\b/i, reason: "eligibility_statement" },
  { re: /\byou (should|must|need to|ought to|have to) (apply|file|answer|say|claim|choose|select|check|mark|sign|write|submit)\b/i, reason: "instruction_to_act" },
  { re: /\bI (recommend|advise|suggest) (that )?you\b|\bmy advice\b|\bin my opinion you\b/i, reason: "advice" },
  { re: /\byour best option\b|\bthe best (thing|option) (for you )?(is|would be)\b/i, reason: "strategy" },
  { re: /\byou (will|won't|will not) be deported\b|\bthere is no risk\b/i, reason: "outcome_prediction" },
  { re: /\b(eres|es usted|usted es|no eres|no es usted) elegible\b|\b(no )?califica\b/i, reason: "eligibility_statement" },
  { re: /\b(debes|deber[ií]as|tienes que|debe|deber[ií]a|tiene que) (solicitar|presentar|responder|marcar|elegir|seleccionar|firmar|escribir)\b/i, reason: "instruction_to_act" },
  { re: /\b(te|le) recomiendo\b|\bmi consejo\b/i, reason: "advice" },
];

/**
 * Last gate before model-authored text can be queued for a client.
 * Reuses the grounding module's backstop so the two can never drift apart.
 */
export function outboundAdviceCheck(text: string): AdviceCheck {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty" };
  for (const { re, reason } of OUTBOUND_BLOCK_PATTERNS) {
    if (re.test(t)) return { ok: false, reason };
  }
  if (containsAdvice(t)) return { ok: false, reason: "advice_language" };
  return { ok: true };
}
