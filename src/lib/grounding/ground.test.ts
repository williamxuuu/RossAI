import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./exa", async () => {
  const actual = await vi.importActual<typeof import("./exa")>("./exa");
  return { ...actual, retrievePassages: vi.fn() };
});
vi.mock("@/lib/llm/client", () => ({ completeJson: vi.fn(), isLlmConfigured: () => true }));

import { ground, containsAdvice } from "./ground";
import { retrievePassages, type Passage } from "./exa";
import { completeJson } from "@/lib/llm/client";

const passage: Passage = {
  index: 0,
  title: "Instructions for Form I-485",
  url: "https://www.uscis.gov/sites/default/files/document/forms/i-485instr.pdf",
  quote: "Alien Registration Number (A-Number) is the number USCIS assigns to you when a file is created.",
};

describe("ground()", () => {
  beforeEach(() => {
    vi.mocked(retrievePassages).mockReset();
    vi.mocked(completeJson).mockReset();
  });

  it("refuses when nothing is retrieved (no grounding, no output)", async () => {
    vi.mocked(retrievePassages).mockResolvedValue([]);
    const r = await ground("A-Number");
    expect(r.grounded).toBe(false);
    expect(r.grounded === false && r.reason).toBe("no_passages");
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("returns the citation of the passage the model pointed at", async () => {
    vi.mocked(retrievePassages).mockResolvedValue([passage]);
    vi.mocked(completeJson).mockResolvedValue({ canAnswer: true, answer: "Your A-Number is the file number USCIS assigned to you.", citationIndex: 0 });
    const r = await ground("A-Number");
    expect(r.grounded).toBe(true);
    if (r.grounded) {
      expect(r.citation.url).toBe(passage.url);
      expect(r.citation.quote).toBe(passage.quote);
    }
  });

  it("rejects an answer whose citation index does not exist", async () => {
    vi.mocked(retrievePassages).mockResolvedValue([passage]);
    vi.mocked(completeJson).mockResolvedValue({ canAnswer: true, answer: "Something", citationIndex: 7 });
    const r = await ground("A-Number");
    expect(r.grounded).toBe(false);
    expect(r.grounded === false && r.reason).toBe("invalid_citation");
  });

  it("rejects when the model declines", async () => {
    vi.mocked(retrievePassages).mockResolvedValue([passage]);
    vi.mocked(completeJson).mockResolvedValue({ canAnswer: false, answer: "", citationIndex: null });
    const r = await ground("Should I file now?");
    expect(r.grounded).toBe(false);
    expect(r.grounded === false && r.reason).toBe("model_declined");
  });

  it("blocks advice language even when cited", async () => {
    vi.mocked(retrievePassages).mockResolvedValue([passage]);
    vi.mocked(completeJson).mockResolvedValue({ canAnswer: true, answer: "You should apply now because you are eligible.", citationIndex: 0 });
    const r = await ground("eligibility");
    expect(r.grounded).toBe(false);
    expect(r.grounded === false && r.reason).toBe("advice_detected");
  });

  it("treats an unavailable LLM as no output", async () => {
    vi.mocked(retrievePassages).mockResolvedValue([passage]);
    vi.mocked(completeJson).mockResolvedValue(null);
    const r = await ground("A-Number");
    expect(r.grounded).toBe(false);
    expect(r.grounded === false && r.reason).toBe("llm_unavailable");
  });
});

describe("containsAdvice()", () => {
  it.each([
    "You should file Form I-485 now.",
    "You are eligible for adjustment of status.",
    "I recommend you answer yes.",
    "Usted es elegible para este beneficio.",
    "Debes presentar el formulario ahora.",
  ])("flags %s", (s) => expect(containsAdvice(s)).toBe(true));

  it.each([
    "An A-Number is the number USCIS assigns to your file.",
    "This field asks for the date you last entered the United States.",
    "El número A es el número que USCIS asigna a su expediente.",
  ])("allows %s", (s) => expect(containsAdvice(s)).toBe(false));
});
