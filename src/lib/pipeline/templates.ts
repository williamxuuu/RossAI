import type { TemplateName } from "./reply";

/**
 * Clinic-owned operational templates (spec §4 human gate: "Operational templates
 * ... are clinic-owned fixed text, translated, and logged as template:<name>").
 *
 * Written in English, SMS-friendly, no legal advice. `{{var}}` placeholders are
 * filled by `renderTemplate()`; `sendTemplate()` in reply.ts renders the client's
 * language before sending.
 *
 * ## Language packs
 *
 * A clinic's standard texts are translated once by a person, not per message by a
 * model. `TEMPLATE_PACKS` holds those human translations; `renderTemplate(name, vars,
 * lang)` uses the pack when one exists for that language and falls back to the English
 * string, which `sendTemplate()` then machine-translates. So the common languages read
 * well and cost nothing, and the long tail still works.
 *
 * Variables every template may use without passing them explicitly (filled by
 * sendTemplate from the environment / channel identity):
 *   clinicName, inboxEmail, clinicPhone, caseCode
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
    "Email them to {{inboxEmail}} and keep {{caseCode}} in the subject line so we know they are yours. " +
    "You can send them one at a time. I'll confirm each one as it arrives.",

  "document.received": "Received: {{docName}}. Thank you!",

  "document.rejected":
    "We could not use the {{docName}} you sent: {{reason}}. Please send a clear, complete copy to {{inboxEmail}}.",

  "document.nudge":
    "Friendly reminder from {{clinicName}}: we still need these documents for your case:\n{{list}}\n" +
    "Email them to {{inboxEmail}} with {{caseCode}} in the subject line when you can.",

  "checklist.complete":
    "We have received all of your documents. Our clinic team will now review your case and will contact you if anything else is needed.",

  "status.update":
    "Here is where your case stands right now:\n{{status}}\n" +
    "A member of our clinic team is the one who decides anything about your case.",

  "escalation.human_reviewing":
    "Thanks for your question. A member of our clinic team is reviewing it and will reply to you here. " +
    "We can't answer questions about your specific situation by text until a person has looked at your case.",

  "reply.generic": "{{text}}",
};

/**
 * Human-written translations of the operational templates.
 *
 * Placeholders must appear in every translation exactly as in the English string —
 * `templatePackIssues()` checks that, and `src/lib/pipeline/templates.test.ts` fails
 * the build if a pack drifts.
 */
export const TEMPLATE_PACKS: Record<string, Partial<Record<TemplateName, string>>> = {
  es: {
    "intake.welcome":
      "¡Hola! Se comunicó con el asistente de admisión de {{clinicName}}. Puedo ayudarle a empezar y a reunir sus documentos. " +
      "Una persona de nuestra clínica revisa todo antes de que se le envíe. No puedo dar asesoría legal.",

    "intake.ask_case_type":
      "¿Cuál de estas opciones describe mejor lo que necesita? Responda con el número:\n{{options}}",

    "intake.ask_question": "{{question}}",

    "checklist.sent":
      "¡Gracias! Para preparar su caso {{caseType}} necesitamos fotos o escaneos de estos documentos:\n{{list}}\n" +
      "Envíelos por correo electrónico a {{inboxEmail}} y deje {{caseCode}} en el asunto para que sepamos que son suyos. " +
      "Puede enviarlos de uno en uno. Le confirmaré cada uno cuando llegue.",

    "document.received": "Recibimos: {{docName}}. ¡Gracias!",

    "document.rejected":
      "No pudimos usar el documento «{{docName}}» que envió: {{reason}}. Por favor envíe una copia clara y completa a {{inboxEmail}}.",

    "document.nudge":
      "Recordatorio de {{clinicName}}: todavía necesitamos estos documentos para su caso:\n{{list}}\n" +
      "Envíelos a {{inboxEmail}} con {{caseCode}} en el asunto cuando pueda.",

    "checklist.complete":
      "Ya recibimos todos sus documentos. Nuestro equipo de la clínica revisará su caso y le avisará si hace falta algo más.",

    "status.update":
      "Así va su caso en este momento:\n{{status}}\n" +
      "Una persona de nuestra clínica es quien decide cualquier cosa sobre su caso.",

    "escalation.human_reviewing":
      "Gracias por su pregunta. Una persona de nuestra clínica la está revisando y le responderá por aquí. " +
      "No podemos responder preguntas sobre su situación específica por mensaje hasta que una persona revise su caso.",

    "reply.generic": "{{text}}",
  },
};

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** True when the clinic has a human translation of its templates for this language. */
export function hasTemplatePack(language: string): boolean {
  return language !== "en" && language in TEMPLATE_PACKS;
}

/**
 * Substitute `{{var}}` placeholders. Unknown placeholders render as empty strings.
 * With `language`, the human translation is used when the clinic has one.
 */
export function renderTemplate(name: TemplateName, vars: Record<string, string> = {}, language = "en"): string {
  const source = (hasTemplatePack(language) ? TEMPLATE_PACKS[language][name] : undefined) ?? TEMPLATES[name];
  return source.replace(PLACEHOLDER, (_m, key: string) => vars[key] ?? "").trim();
}

/** Placeholders a template references, for callers that want to validate vars. */
export function templateVars(name: TemplateName): string[] {
  const out = new Set<string>();
  for (const m of TEMPLATES[name].matchAll(PLACEHOLDER)) out.add(m[1]);
  return [...out];
}

/**
 * Every way a language pack can disagree with the English source. Empty means the
 * pack is safe to send: same templates, same placeholders, no missing substitution.
 */
export function templatePackIssues(language: string): string[] {
  const pack = TEMPLATE_PACKS[language];
  if (!pack) return [`no pack for ${language}`];
  const issues: string[] = [];
  for (const name of Object.keys(TEMPLATES) as TemplateName[]) {
    const translated = pack[name];
    if (!translated) {
      issues.push(`${name}: missing`);
      continue;
    }
    const expected = new Set(templateVars(name));
    const actual = new Set([...translated.matchAll(PLACEHOLDER)].map((m) => m[1]));
    for (const v of expected) if (!actual.has(v)) issues.push(`${name}: missing {{${v}}}`);
    for (const v of actual) if (!expected.has(v)) issues.push(`${name}: unexpected {{${v}}}`);
  }
  return issues;
}
