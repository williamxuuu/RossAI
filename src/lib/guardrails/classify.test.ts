import { describe, expect, it, vi } from "vitest";
import { classifyByPattern, looksLikeQuestion, outboundAdviceCheck } from "./classify";

vi.mock("@/lib/llm/client", () => ({ isLlmConfigured: () => false, completeJson: async () => null }));

/**
 * The no-legal-advice gate. These tests are about the rule, not the regexes: the
 * point is that judgment questions can never be answered by the agent and that
 * eligibility or instruction language can never leave the system unreviewed.
 */
describe("classifyByPattern", () => {
  it("sends anything that needs legal judgment to a person", () => {
    const judgment = [
      "Should I check yes on question 23?",
      "Am I eligible for a green card?",
      "What should I do about my old arrest?",
      "Do I qualify if I left the country for 8 months?",
      "What happens if I answer no?",
      "¿Debo marcar que sí estuve fuera del país?",
      "¿Soy elegible para la ciudadanía?",
      "¿Qué hago con mi caso?",
    ];
    for (const text of judgment) {
      expect(classifyByPattern(text), text).toMatchObject({ kind: "judgment" });
    }
  });

  it("treats a request to define a term as explainable", () => {
    for (const text of ["What does adjustment of status mean?", "What is an A-Number?", "¿Qué significa adjustment of status?"]) {
      expect(classifyByPattern(text), text).toMatchObject({ kind: "explain" });
    }
  });

  it("routes progress questions to the clinic's status template", () => {
    for (const text of ["Any update on my case?", "What documents do you still need?", "¿Cómo va mi caso?"]) {
      expect(classifyByPattern(text), text).toMatchObject({ kind: "status" });
    }
  });

  it("does not escalate a greeting", () => {
    for (const text of ["gracias", "Hello", "ok"]) {
      expect(classifyByPattern(text), text).toMatchObject({ kind: "other" });
    }
  });

  it("leaves an ambiguous message for the model, which defaults to judgment", () => {
    // No pattern matches; classifyClientQuestion then falls back to judgment when no
    // model is configured, because "a person reads it" is the safe direction.
    expect(classifyByPattern("The office on Elm Street was closed yesterday afternoon")).toBeNull();
  });
});

describe("looksLikeQuestion", () => {
  it("recognises a cover note on an email of documents", () => {
    for (const text of ["Aqui estan mis documentos.", "Here are my papers", "attached", "Mis documentos"]) {
      expect(looksLikeQuestion(text), text).toBe(false);
    }
  });

  it("still recognises a question sent with an attachment", () => {
    for (const text of ["Is this the right one?", "¿Es este el documento correcto?", "what else do you need"]) {
      expect(looksLikeQuestion(text), text).toBe(true);
    }
  });
});

describe("outboundAdviceCheck", () => {
  it("blocks eligibility statements, instructions and predictions", () => {
    const blocked = [
      "You are eligible to apply for naturalization.",
      "You do not qualify for this benefit.",
      "You should file Form I-485 before the deadline.",
      "I recommend you answer yes to question 12.",
      "Your best option is to wait six months.",
      "You will not be deported.",
      "Usted es elegible para la residencia.",
      "Debes presentar el formulario esta semana.",
      "Te recomiendo que esperes.",
    ];
    for (const text of blocked) {
      expect(outboundAdviceCheck(text), text).toMatchObject({ ok: false });
    }
  });

  it("allows describing a document problem", () => {
    const allowed = [
      "The date of birth on the birth certificate does not match the date on the notice.",
      "We could not read the copy of the passport you sent. Please send a clearer photo.",
      "USCIS instructions say every supporting document in another language needs a certified English translation.",
      "Recibimos su acta de nacimiento. Gracias.",
    ];
    for (const text of allowed) {
      expect(outboundAdviceCheck(text), text).toMatchObject({ ok: true });
    }
  });

  it("refuses empty text", () => {
    expect(outboundAdviceCheck("   ")).toMatchObject({ ok: false, reason: "empty" });
  });
});
