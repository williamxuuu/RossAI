import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATE_PACKS, renderTemplate, templatePackIssues, templateVars } from "./templates";
import { outboundAdviceCheck } from "@/lib/guardrails/classify";
import type { TemplateName } from "./reply";

/**
 * The clinic's operational texts are the ONLY model-free thing that reaches a client
 * without a paralegal pressing a button (spec §4). So they have to stay free of legal
 * advice, and every translation has to carry the same placeholders as the English —
 * a dropped `{{inboxEmail}}` tells a client to email nowhere.
 */

const NAMES = Object.keys(TEMPLATES) as TemplateName[];

describe("operational templates", () => {
  it("never give legal advice", () => {
    for (const name of NAMES) {
      expect(outboundAdviceCheck(TEMPLATES[name]), name).toMatchObject({ ok: true });
    }
    for (const [language, pack] of Object.entries(TEMPLATE_PACKS)) {
      for (const [name, text] of Object.entries(pack)) {
        expect(outboundAdviceCheck(text as string), `${language}/${name}`).toMatchObject({ ok: true });
      }
    }
  });

  it("say the agent cannot advise, at first contact", () => {
    expect(TEMPLATES["intake.welcome"]).toMatch(/cannot give legal advice/i);
    expect(TEMPLATE_PACKS.es["intake.welcome"]).toMatch(/no puedo dar asesor[íi]a legal/i);
  });

  it("keep every placeholder in every language pack", () => {
    for (const language of Object.keys(TEMPLATE_PACKS)) {
      expect(templatePackIssues(language), language).toEqual([]);
    }
  });

  it("fill placeholders and drop unknown ones rather than printing them", () => {
    const rendered = renderTemplate("document.received", { docName: "Passport" });
    expect(rendered).toBe("Received: Passport. Thank you!");
    expect(renderTemplate("document.received", {})).not.toContain("{{");
  });

  it("use the human translation when the clinic has one", () => {
    const es = renderTemplate("document.received", { docName: "Pasaporte" }, "es");
    expect(es).toBe("Recibimos: Pasaporte. ¡Gracias!");
    // A language with no pack falls back to English; sendTemplate then machine-translates.
    expect(renderTemplate("document.received", { docName: "Passport" }, "vi")).toContain("Received");
  });

  it("tell the client where to email documents and how we will recognise them", () => {
    expect(templateVars("checklist.sent")).toEqual(expect.arrayContaining(["inboxEmail", "caseCode", "list"]));
  });
});
