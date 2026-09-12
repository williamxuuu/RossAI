/**
 * Short, clinic-owned strings the overlay shows when there is no grounded
 * explanation (spec §3.2: "If the model can't ground an explanation in a
 * retrieved source, it says so and offers escalation instead").
 *
 * These are fixed strings, not model output. Languages without a translation
 * fall back to English. Keep them under ~140 characters so they fit the overlay.
 */
export type UngroundedKind = "not_found" | "needs_human";

type MessageSet = { not_found: string; needs_human?: string };

const MESSAGES: Record<string, MessageSet> = {
  en: {
    not_found: "We couldn't find an official USCIS source for this — ask the clinic.",
    needs_human: "This looks like a question about your situation rather than a term we can explain. A clinic staff member should answer it — ask the clinic.",
  },
  es: {
    not_found: "No encontramos una fuente oficial de USCIS para esto — pregunte a la clínica.",
    needs_human: "Esto parece una pregunta sobre su situación, no un término que podamos explicar. Una persona de la clínica debe responderla — pregunte a la clínica.",
  },
  fr: { not_found: "Nous n'avons pas trouvé de source officielle de l'USCIS à ce sujet — demandez à la clinique." },
  pt: { not_found: "Não encontramos uma fonte oficial do USCIS sobre isso — pergunte à clínica." },
  ht: { not_found: "Nou pa t jwenn yon sous ofisyèl USCIS pou sa — mande klinik la." },
  zh: { not_found: "我们找不到关于此内容的 USCIS 官方来源——请向法律诊所咨询。" },
  ar: { not_found: "لم نعثر على مصدر رسمي من USCIS لهذا الموضوع — يرجى سؤال العيادة القانونية." },
  vi: { not_found: "Chúng tôi không tìm thấy nguồn chính thức của USCIS cho nội dung này — hãy hỏi văn phòng hỗ trợ pháp lý." },
  ru: { not_found: "Мы не нашли официальный источник USCIS по этому вопросу — обратитесь в юридическую клинику." },
  uk: { not_found: "Ми не знайшли офіційного джерела USCIS з цього питання — зверніться до юридичної клініки." },
  tl: { not_found: "Hindi kami nakahanap ng opisyal na pinagmulan mula sa USCIS para dito — magtanong sa klinika." },
  ko: { not_found: "이 내용에 대한 USCIS 공식 출처를 찾지 못했습니다 — 법률 클리닉에 문의하세요." },
};

/** Map a `ground()` refusal reason to the kind of message the client should see. */
export function ungroundedKind(reason: string): UngroundedKind {
  return reason === "model_declined" || reason === "advice_detected" ? "needs_human" : "not_found";
}

/** Localized "no grounded source" message. Falls back to English. */
export function ungroundedMessage(language: string, kind: UngroundedKind = "not_found"): string {
  const set = MESSAGES[language] ?? MESSAGES.en;
  return set[kind] ?? set.not_found;
}

export const UNGROUNDED_MESSAGE_LANGUAGES: readonly string[] = Object.keys(MESSAGES);
