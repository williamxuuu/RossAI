import { describe, expect, it } from "vitest";
import {
  anchorCard,
  classifySelection,
  normalizeSelection,
  readerPageUrl,
  SELECTION_MAX_CHARS,
  type Frame,
} from "./selection";

describe("normalizeSelection", () => {
  it("collapses the line breaks a PDF text layer hands back", () => {
    expect(normalizeSelection("  Affidavit   of\n  Support \n")).toBe("Affidavit of Support");
  });

  it("rejoins a word hyphenated across a line break", () => {
    expect(normalizeSelection("adjustment of sta-\ntus")).toBe("adjustment of status");
  });

  it("keeps a hyphen that belongs to the term", () => {
    expect(normalizeSelection("A-Number")).toBe("A-Number");
    expect(normalizeSelection("Form I-485,\nPart 3")).toBe("Form I-485, Part 3");
  });

  it("does not join across a capital, which starts a new sentence rather than continuing a word", () => {
    expect(normalizeSelection("green card-\nHolders")).toBe("green card- Holders");
  });

  it("drops soft hyphens", () => {
    expect(normalizeSelection("bio­metrics")).toBe("biometrics");
  });
});

describe("classifySelection", () => {
  it("ignores nothing and near-nothing", () => {
    expect(classifySelection("")).toEqual({ kind: "ignore" });
    expect(classifySelection("   \n ")).toEqual({ kind: "ignore" });
    expect(classifySelection("of")).toEqual({ kind: "ignore" });
  });

  it("looks up a term", () => {
    expect(classifySelection(" A-Number ")).toEqual({ kind: "lookup", text: "A-Number" });
  });

  it("flags a selection past the API's limit instead of sending it", () => {
    const long = "word ".repeat(200);
    const verdict = classifySelection(long);
    expect(verdict.kind).toBe("too_long");
  });

  it("accepts a selection exactly at the limit", () => {
    const exact = "x".repeat(SELECTION_MAX_CHARS);
    expect(classifySelection(exact)).toEqual({ kind: "lookup", text: exact });
  });
});

describe("anchorCard", () => {
  const card = { width: 340, height: 200 };
  const frame: Frame = { width: 800, height: 4000, scrollTop: 0, viewHeight: 700 };

  it("places the card under the selection", () => {
    const at = anchorCard({ top: 100, left: 120, bottom: 118, right: 300 }, card, frame);
    expect(at).toEqual({ left: 120, top: 128, side: "below" });
  });

  it("flips above when the card would fall off the bottom of the view", () => {
    const at = anchorCard({ top: 600, left: 40, bottom: 620, right: 300 }, card, frame);
    expect(at).toEqual({ left: 40, top: 390, side: "above" });
  });

  it("slides the card on screen when it fits on neither side", () => {
    const tight: Frame = { width: 800, height: 4000, scrollTop: 0, viewHeight: 220 };
    const at = anchorCard({ top: 80, left: 0, bottom: 100, right: 300 }, card, tight);
    // 110 would put the last 90px of the card past the bottom of the view
    expect(at.top).toBe(20);
  });

  it("pins a card taller than the view to the top of it rather than off the bottom", () => {
    const tight: Frame = { width: 800, height: 4000, scrollTop: 600, viewHeight: 150 };
    const at = anchorCard({ top: 700, left: 0, bottom: 720, right: 300 }, card, tight);
    expect(at.top).toBe(600);
  });

  it("measures room against the scrolled view, not the whole document", () => {
    const scrolled: Frame = { width: 800, height: 4000, scrollTop: 1000, viewHeight: 700 };
    const at = anchorCard({ top: 1600, left: 0, bottom: 1620, right: 300 }, card, scrolled);
    expect(at).toEqual({ left: 0, top: 1390, side: "above" });
  });

  it("keeps a card selected near the right edge inside the document", () => {
    const at = anchorCard({ top: 10, left: 700, bottom: 30, right: 790 }, card, frame);
    expect(at.left).toBe(460);
  });

  it("never returns a negative position", () => {
    const narrow: Frame = { width: 200, height: 100, scrollTop: 0, viewHeight: 100 };
    const at = anchorCard({ top: 0, left: 10, bottom: 12, right: 80 }, card, narrow);
    expect(at.left).toBe(0);
    expect(at.top).toBe(0);
  });
});

describe("readerPageUrl", () => {
  it("reports this page, not the document", () => {
    expect(readerPageUrl("https://clinic.example", "/jargon")).toBe("https://clinic.example/jargon");
  });

  it("carries the form number as a retrieval hint", () => {
    expect(readerPageUrl("https://clinic.example", "/jargon", "I-485")).toBe("https://clinic.example/jargon?form=I-485");
  });
});
