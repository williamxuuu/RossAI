import type { TemplateName } from "./reply";

/**
 * Clinic-owned operational templates (spec §4 human gate: "Operational templates
 * ... are clinic-owned fixed text, translated, and logged as template:<name>").
 *
 * Written in English, SMS-friendly, no legal advice. `{{var}}` placeholders are
 * filled by `renderTemplate()`; `sendTemplate()` in reply.ts translates the result
 * into the client's language before sending.
 *
 * Variables every template may use without passing them explicitly (filled by
 * sendTemplate from the environment / channel identity):
 *   clinicName, inboxEmail, clinicPhone
 */
export const TEMPLATES: Record<TemplateName, string> = {
  "intake.welcome":
    "Hi! You've reached the intake assistant for {{clinicName}}. I can help you get started and collect your documents. " +
    "A member of our clinic team reviews everything before it is sent to you. I cannot give legal advice.",

  "intake.ask_case_type":
    "Which of these best describes what you need help with? Reply with the number:\n{{options}}",

  "intake.ask_question": "{{question}}",

  "checklist.sent":
    "Thanks! To prepare your {{caseType}} case we need photos or scans of these documents:\n{{list}}\n" +
    "Please email them to {{inboxEmail}} (one document per email works best). I'll confirm each one as it arrives.",

  "document.received": "Received: {{docName}}. Thank you!",

  "document.rejected":
    "We could not use the {{docName}} you sent: {{reason}}. Please send a clear, complete copy to {{inboxEmail}}.",

  "document.nudge":
    "Friendly reminder from {{clinicName}}: we still need these documents for your case:\n{{list}}\n" +
    "Please email them to {{inboxEmail}} when you can.",

  "checklist.complete":
    "We have received all of your documents. Our clinic team will now review your case and will contact you if anything else is needed.",

  "escalation.human_reviewing":
    "Thanks for your question. A member of our clinic team is reviewing it and will reply to you here. " +
    "We can't answer questions about your specific situation by text until a person has looked at your case.",

  "reply.generic": "{{text}}",
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Substitute `{{var}}` placeholders. Unknown placeholders render as empty strings. */
export function renderTemplate(name: TemplateName, vars: Record<string, string> = {}): string {
  return TEMPLATES[name].replace(PLACEHOLDER, (_m, key: string) => vars[key] ?? "").trim();
}

/** Placeholders a template references, for callers that want to validate vars. */
export function templateVars(name: TemplateName): string[] {
  const out = new Set<string>();
  for (const m of TEMPLATES[name].matchAll(PLACEHOLDER)) out.add(m[1]);
  return [...out];
}
