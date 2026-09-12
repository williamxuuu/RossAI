import "server-only";
import { z } from "zod";
import { completeJson, isLlmConfigured } from "@/lib/llm/client";
import { normalizeLanguage, SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { log } from "@/lib/log";

/**
 * Which language is the client writing in? (spec §3.1 "The agent detects language,
 * stores it on the Client record".)
 *
 * A script check runs first — it is exact for Arabic, Cyrillic, CJK, Korean, Amharic —
 * then a stop-word vote for the Latin-script languages the clinic supports, then the
 * cheap model for anything still unresolved. Every layer is allowed to say "unknown",
 * and unknown means English, because English is what the templates are written in and
 * an unnecessary translation is worse than none.
 */

const logger = log.scope("language");

export type LanguageGuess = {
  language: string;
  by: "script" | "stopwords" | "model" | "default";
  confident: boolean;
};

// ---------------------------------------------------------------------------
// script detection — unambiguous for non-Latin writing systems
// ---------------------------------------------------------------------------

const SCRIPTS: { language: string; re: RegExp }[] = [
  { language: "ar", re: /[؀-ۿ]/ },
  { language: "fa", re: /[پچژگی]/ }, // Persian-only letters, checked before Arabic
  { language: "am", re: /[ሀ-፿]/ },
  { language: "ko", re: /[가-힯ᄀ-ᇿ]/ },
  { language: "zh", re: /[一-鿿]/ },
  { language: "uk", re: /[ЄІЇҐ]/ }, // Ukrainian-only Cyrillic letters, checked before Russian
  { language: "ru", re: /[Ѐ-ӿ]/ },
];

function byScript(text: string): string | null {
  // Persian before Arabic and Ukrainian before Russian: the narrower test wins.
  for (const { language, re } of SCRIPTS) {
    if (re.test(text)) return language;
  }
  return null;
}

// ---------------------------------------------------------------------------
// stop-word vote — Latin-script languages
// ---------------------------------------------------------------------------

const STOPWORDS: Record<string, string[]> = {
  es: ["que", "de", "la", "el", "los", "las", "por", "para", "con", "una", "mi", "me", "es", "esta", "está", "como", "cuando", "donde", "dónde", "pero", "porque", "gracias", "hola", "necesito", "tengo", "puedo", "quiero", "documentos", "cita", "papeles", "ayuda", "señor", "señora", "buenos", "días"],
  pt: ["que", "de", "da", "do", "os", "as", "para", "com", "uma", "meu", "minha", "é", "está", "como", "quando", "onde", "mas", "porque", "obrigado", "obrigada", "olá", "preciso", "tenho", "posso", "quero", "documentos", "ajuda", "bom", "dia"],
  fr: ["que", "de", "le", "la", "les", "des", "pour", "avec", "une", "mon", "ma", "est", "comme", "quand", "où", "mais", "parce", "merci", "bonjour", "besoin", "j'ai", "je", "peux", "veux", "documents", "aide", "s'il", "vous", "plaît"],
  ht: ["mwen", "ou", "li", "nou", "yo", "pa", "pou", "ak", "nan", "sa", "ki", "gen", "bezwen", "mèsi", "bonjou", "dokiman", "èd", "kijan", "kote", "eske", "èske"],
  vi: ["tôi", "của", "và", "là", "không", "có", "được", "cho", "với", "này", "cảm", "ơn", "chào", "giấy", "tờ", "cần", "hồ", "sơ"],
  tl: ["ang", "ng", "sa", "mga", "ako", "ko", "po", "hindi", "may", "kailangan", "salamat", "kumusta", "dokumento", "papeles"],
  en: ["the", "and", "is", "are", "you", "your", "for", "with", "what", "when", "where", "how", "thanks", "thank", "hello", "need", "have", "can", "documents", "help", "please"],
};

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
}

function byStopwords(text: string): { language: string; score: number } | null {
  const tokens = tokenize(text);
  if (tokens.length < 2) return null;
  const set = new Set(tokens);
  let best: { language: string; score: number } | null = null;
  for (const [language, words] of Object.entries(STOPWORDS)) {
    const hits = words.filter((w) => set.has(w)).length;
    const score = hits / tokens.length;
    if (hits > 0 && (!best || score > best.score)) best = { language, score };
  }
  // Spanish and Portuguese share "que/de/para/como"; require a clear signal.
  if (!best || best.score < 0.15) return null;
  return best;
}

// ---------------------------------------------------------------------------

const DetectSchema = z.object({
  language: z.string().min(2).max(8),
  confident: z.boolean().default(false),
});

const DETECT_SYSTEM = `Identify the language of a short text message.
Return JSON: {"language": "<ISO 639-1 code>", "confident": boolean}.
Use only these codes: ${Object.keys(SUPPORTED_LANGUAGES).join(", ")}.
If the text is too short, is only a number, or you cannot tell, return {"language":"en","confident":false}.`;

/** Detect the language of one inbound message. Never throws. */
export async function detectLanguage(text: string): Promise<LanguageGuess> {
  const trimmed = text.trim();
  if (trimmed.length < 2) return { language: "en", by: "default", confident: false };

  const script = byScript(trimmed);
  if (script) return { language: script, by: "script", confident: true };

  const stop = byStopwords(trimmed);
  if (stop && stop.score >= 0.25) return { language: normalizeLanguage(stop.language), by: "stopwords", confident: true };

  if (isLlmConfigured()) {
    const result = await completeJson({
      tier: "cheap",
      schema: DetectSchema,
      system: DETECT_SYSTEM,
      user: trimmed.slice(0, 500),
      temperature: 0,
      maxTokens: 60,
    });
    if (result) return { language: normalizeLanguage(result.language), by: "model", confident: result.confident };
    logger.warn("language detection unavailable");
  }

  if (stop) return { language: normalizeLanguage(stop.language), by: "stopwords", confident: false };
  return { language: "en", by: "default", confident: false };
}
