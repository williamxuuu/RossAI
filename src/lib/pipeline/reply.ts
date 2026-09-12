import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Case, Citation, Client } from "@/db/schema";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { getChannelProvider } from "@/lib/channel";
import type { Channel, ChannelProvider, OutboundResult } from "@/lib/channel/types";
import { completeText } from "@/lib/llm/client";
import { languageName, normalizeLanguage } from "@/lib/i18n";
import { outboundAdviceCheck } from "@/lib/guardrails/classify";
import { log } from "@/lib/log";
<<<<<<< HEAD
import { renderTemplate } from "./templates";
=======
import { caseCode } from "./casecode";
import { hasTemplatePack, renderTemplate } from "./templates";
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b

/**
 * THE HUMAN GATE (spec §4, §3.7).
 *
 * This is the ONLY module allowed to hand text to the channel provider.
 *
 *   sendApproved()      free text approved by a paralegal — requires a paralegal id and
 *                       writes the audit entry BEFORE the provider is called.
 *   sendTemplate()      clinic-owned operational templates (templates.ts), logged as
 *                       approvedBy "template:<name>". Never model-authored content.
 *   sendGroundedAuto()  a grounded, cited answer sent without a human — only when
 *                       AUTO_SEND_GROUNDED_ANSWERS=true (default off). Logged as
 *                       approvedBy "auto:grounded" with the citation in the audit payload.
 *
 * Everything else in the codebase must go through one of these three functions.
 */

const logger = log.scope("reply");

export type SendApprovedInput = {
  caseId: string;
  paralegalId: string;
  /** Approved English text. It is translated to the client's language before sending. */
  englishText: string;
  channel?: Channel; // default: sms (email when the client has no phone)
  /** Optional links for audit context. */
  escalationId?: string;
  flagId?: string;
};

export type TemplateName =
  | "intake.welcome"
  | "intake.ask_case_type"
  | "intake.ask_question"
  | "checklist.sent"
  | "document.received"
  | "document.rejected"
  | "document.nudge"
  | "checklist.complete"
<<<<<<< HEAD
=======
  | "status.update"
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
  | "escalation.human_reviewing"
  | "reply.generic";

export type SendTemplateInput = {
  caseId: string;
  template: TemplateName;
  vars?: Record<string, string>;
  channel?: Channel;
};

export type SendGroundedAutoInput = {
  caseId: string;
  /** Grounded answer, already in the client's language (ground() was called with it). */
  text: string;
  citation: Citation;
  sourceMessageId?: string;
  channel?: Channel;
};

export const AUTO_GROUNDED_APPROVER = "auto:grounded";

export function templateApprover(name: TemplateName): string {
  return `template:${name}`;
}

/** Grounded SMS answers are drafted, never auto-sent, unless the clinic opts in. */
export function isAutoSendEnabled(): boolean {
  return process.env.AUTO_SEND_GROUNDED_ANSWERS === "true";
}

// ---------------------------------------------------------------------------
// sendApproved — paralegal-approved free text
// ---------------------------------------------------------------------------

export async function sendApproved(input: SendApprovedInput): Promise<{ messageId: string }> {
  const paralegalId = input.paralegalId?.trim() ?? "";
  if (!paralegalId) throw new Error("sendApproved requires a paralegal id (human gate)");
  const englishText = input.englishText?.trim() ?? "";
  if (!englishText) throw new Error("sendApproved requires non-empty text");

  const { kase, client } = await loadCaseWithClient(input.caseId);
  const provider = await getChannelProvider();
  const channel = resolveChannel(client, input.channel);
  const language = normalizeLanguage(client.preferredLanguage);
  const translated = await translateText(englishText, language);

  const messageId = await insertOutbound({
    kase,
    client,
    channel,
    body: translated,
    language,
    approvedBy: paralegalId,
<<<<<<< HEAD
    subject: channel === "email" ? await translateText(DEFAULT_EMAIL_SUBJECT, language) : undefined,
=======
    subject: channel === "email" ? emailSubject(language) : undefined,
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
  });

  // Audit BEFORE the provider is called: the approval record must exist even if delivery fails.
  await writeAudit({
    caseId: kase.id,
    actor: paralegalId,
    action: "message.sent",
    payload: {
      messageId,
      paralegalId,
      channel,
      language,
      englishText,
      translated,
      escalationId: input.escalationId ?? null,
      flagId: input.flagId ?? null,
    },
  });

  const delivered = await deliver({ provider, client, channel, messageId, caseId: kase.id, actor: paralegalId, body: translated, language });
  if (!delivered.ok) throw delivered.error;

  if (input.escalationId) await markEscalationReplied(kase.id, input.escalationId, messageId, paralegalId);
  if (kase.status === "awaiting_review") await setCaseStatus(kase, "replied", paralegalId);

  return { messageId };
}

// ---------------------------------------------------------------------------
// sendTemplate — clinic-owned operational text
// ---------------------------------------------------------------------------

export async function sendTemplate(input: SendTemplateInput): Promise<{ messageId: string }> {
  const { kase, client } = await loadCaseWithClient(input.caseId);
  const provider = await getChannelProvider();
  const channel = resolveChannel(client, input.channel);
  const language = normalizeLanguage(client.preferredLanguage);

<<<<<<< HEAD
  const vars = { ...defaultTemplateVars(provider), ...(input.vars ?? {}) };
  const english = renderTemplate(input.template, vars);
  if (!english) throw new Error(`template ${input.template} rendered empty`);
  const translated = await translateText(english, language);
=======
  const vars = { ...defaultTemplateVars(provider, language), caseCode: caseCode(kase.id), ...(input.vars ?? {}) };
  // The English rendering is what the audit log records as the approved source text,
  // even when the client receives the language-pack version.
  const english = renderTemplate(input.template, { ...defaultTemplateVars(provider, "en"), caseCode: caseCode(kase.id), ...(input.vars ?? {}) });
  if (!english) throw new Error(`template ${input.template} rendered empty`);
  // A human translation of the clinic's own text beats a machine one, and costs nothing.
  const translated = hasTemplatePack(language)
    ? renderTemplate(input.template, vars, language)
    : await translateText(english, language);
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
  const approvedBy = templateApprover(input.template);

  const messageId = await insertOutbound({
    kase,
    client,
    channel,
    body: translated,
    language,
    approvedBy,
<<<<<<< HEAD
    subject: channel === "email" ? await translateText(DEFAULT_EMAIL_SUBJECT, language) : undefined,
=======
    subject: channel === "email" ? emailSubject(language) : undefined,
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
  });

  await writeAudit({
    caseId: kase.id,
    actor: AGENT_ACTOR,
    action: "message.sent",
<<<<<<< HEAD
    payload: { messageId, template: input.template, approvedBy, channel, language, vars: input.vars ?? {}, englishText: english, translated },
=======
    payload: {
      messageId,
      template: input.template,
      approvedBy,
      channel,
      language,
      source: hasTemplatePack(language) ? "language_pack" : language === "en" ? "english" : "machine_translation",
      vars: input.vars ?? {},
      englishText: english,
      translated,
    },
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
  });

  // Operational templates never abort the pipeline on a delivery hiccup; the row + audit exist.
  await deliver({ provider, client, channel, messageId, caseId: kase.id, actor: AGENT_ACTOR, body: translated, language });
  return { messageId };
}

// ---------------------------------------------------------------------------
// sendGroundedAuto — opt-in auto-send of cited answers
// ---------------------------------------------------------------------------

export async function sendGroundedAuto(input: SendGroundedAutoInput): Promise<{ messageId: string }> {
  if (!isAutoSendEnabled()) throw new Error("sendGroundedAuto called while AUTO_SEND_GROUNDED_ANSWERS is not enabled");
  const text = input.text.trim();
  if (!text) throw new Error("sendGroundedAuto requires non-empty text");
  if (!input.citation?.url) throw new Error("sendGroundedAuto requires a citation (no grounding, no output)");
  const advice = outboundAdviceCheck(text);
  if (!advice.ok) {
    await writeAudit({
      caseId: input.caseId,
      actor: AGENT_ACTOR,
      action: "message.blocked",
      payload: { reason: advice.reason, sourceMessageId: input.sourceMessageId ?? null },
    });
    throw new Error(`sendGroundedAuto blocked: ${advice.reason}`);
  }

  const { kase, client } = await loadCaseWithClient(input.caseId);
  const provider = await getChannelProvider();
  const channel = resolveChannel(client, input.channel);
  const language = normalizeLanguage(client.preferredLanguage);

  const messageId = await insertOutbound({ kase, client, channel, body: text, language, approvedBy: AUTO_GROUNDED_APPROVER });
  await writeAudit({
    caseId: kase.id,
    actor: AGENT_ACTOR,
    action: "message.sent",
    payload: {
      messageId,
      approvedBy: AUTO_GROUNDED_APPROVER,
      channel,
      language,
      text,
      citation: input.citation,
      sourceMessageId: input.sourceMessageId ?? null,
    },
  });
  const delivered = await deliver({ provider, client, channel, messageId, caseId: kase.id, actor: AGENT_ACTOR, body: text, language });
  if (!delivered.ok) throw delivered.error;
  return { messageId };
}

// ---------------------------------------------------------------------------
// translateText — cheap tier, strict "translate only" prompt, in-memory cache
// ---------------------------------------------------------------------------

const TRANSLATION_CACHE_MAX = 500;
const translationCache = new Map<string, string>();

/** Test hook. */
export function clearTranslationCache(): void {
  translationCache.clear();
}

function translationPrompt(lang: string): string {
  return [
    "TASK: translate.",
    `You are a professional translator for a legal aid clinic. Translate the user's message from English into the language with ISO 639-1 code "${lang}" (${languageName(lang)}).`,
    "Rules:",
    "- Translate only. Do not add, remove, summarize, answer, or explain anything.",
    "- Keep numbers, dates, names, USCIS form numbers (e.g. I-485), email addresses, phone numbers, and URLs exactly as they appear.",
    "- Keep line breaks and numbered lists in the same order.",
    "- Use a warm, plain, respectful register suitable for a text message.",
    "Output only the translation, with no quotes or commentary.",
  ].join("\n");
}

/** Translate English → target language with the cheap tier. Returns the input unchanged for "en". */
export async function translateText(text: string, targetLanguage: string): Promise<string> {
  const lang = normalizeLanguage(targetLanguage);
  const source = text.trim();
  if (lang === "en" || !source) return text;

  const key = `${lang}|${source}`;
  const cached = translationCache.get(key);
  if (cached) return cached;

  const out = await completeText({ tier: "cheap", system: translationPrompt(lang), user: source, temperature: 0, maxTokens: 1500 });
  const translated = out?.trim();
  if (!translated) {
    logger.warn("translation unavailable; sending English", { lang, chars: source.length });
    return text;
  }
  if (translationCache.size >= TRANSLATION_CACHE_MAX) translationCache.clear();
  translationCache.set(key, translated);
  return translated;
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

<<<<<<< HEAD
const DEFAULT_EMAIL_SUBJECT = "A message from your legal clinic";

function defaultTemplateVars(provider: ChannelProvider): Record<string, string> {
  const id = provider.identity();
  return {
    clinicName: process.env.CLINIC_NAME?.trim() || "our legal clinic",
=======
/**
 * Email subjects, clinic-owned like the templates. They are a fixed set rather than a
 * translated string because a subject line is the one part of a message a client sees
 * before opening it, and a machine translation is a poor thing to greet them with.
 */
const EMAIL_SUBJECTS: Record<string, string> = {
  en: "A message from your legal clinic",
  es: "Un mensaje de su clínica legal",
};

function emailSubject(language: string): string {
  return EMAIL_SUBJECTS[language] ?? EMAIL_SUBJECTS.en;
}

/** Used when CLINIC_NAME is unset, so the fallback still reads as the client's language. */
const GENERIC_CLINIC_NAME: Record<string, string> = {
  en: "our legal clinic",
  es: "nuestra clínica legal",
};

function defaultTemplateVars(provider: ChannelProvider, language: string): Record<string, string> {
  const id = provider.identity();
  return {
    clinicName: process.env.CLINIC_NAME?.trim() || GENERIC_CLINIC_NAME[language] || GENERIC_CLINIC_NAME.en,
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
    inboxEmail: id.email ?? "",
    clinicPhone: id.phone ?? "",
  };
}

async function loadCaseWithClient(caseId: string): Promise<{ kase: Case; client: Client }> {
  const db = await getDb();
  const kase = await db.query.cases.findFirst({ where: eq(schema.cases.id, caseId), with: { client: true } });
  if (!kase) throw new Error(`case ${caseId} not found`);
  const { client, ...rest } = kase;
  if (!client) throw new Error(`case ${caseId} has no client`);
  return { kase: rest, client };
}

function resolveChannel(client: Client, requested?: Channel): Channel {
  const channel: Channel = requested ?? (client.phone ? "sms" : "email");
  if (channel === "sms" && !client.phone) throw new Error("client has no phone number for SMS");
  if (channel === "email" && !client.email) throw new Error("client has no email address");
  return channel;
}

async function insertOutbound(input: {
  kase: Case;
  client: Client;
  channel: Channel;
  body: string;
  language: string;
  approvedBy: string;
  subject?: string;
}): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.messages)
    .values({
      caseId: input.kase.id,
      clientId: input.client.id,
      direction: "outbound",
      channel: input.channel,
      body: input.body,
      language: input.language,
      approvedBy: input.approvedBy,
      subject: input.subject ?? null,
    })
    .returning({ id: schema.messages.id });
  return row.id;
}

type DeliverInput = {
  provider: ChannelProvider;
  client: Client;
  channel: Channel;
  messageId: string;
  caseId: string;
  actor: string;
  body: string;
  language: string;
};

async function deliver(input: DeliverInput): Promise<{ ok: true } | { ok: false; error: Error }> {
  const { provider, client, channel } = input;
  try {
    let result: OutboundResult;
    if (channel === "sms") {
      result = await provider.sendSms(client.phone as string, input.body);
    } else {
<<<<<<< HEAD
      const subject = await translateText(DEFAULT_EMAIL_SUBJECT, input.language);
      result = await provider.sendEmail(client.email as string, subject, input.body);
=======
      result = await provider.sendEmail(client.email as string, emailSubject(input.language), input.body);
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
    }
    if (result.externalId) {
      const db = await getDb();
      await db.update(schema.messages).set({ externalId: result.externalId }).where(eq(schema.messages.id, input.messageId));
    }
    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error("delivery failed", { messageId: input.messageId, channel, err: error.message });
    await writeAudit({
      caseId: input.caseId,
      actor: input.actor,
      action: "message.blocked",
      payload: { messageId: input.messageId, reason: "provider_error", error: error.message },
    });
    return { ok: false, error };
  }
}

async function markEscalationReplied(caseId: string, escalationId: string, messageId: string, paralegalId: string): Promise<void> {
  const db = await getDb();
  const [updated] = await db
    .update(schema.escalations)
    .set({ status: "replied", replyMessageId: messageId })
    .where(eq(schema.escalations.id, escalationId))
    .returning({ id: schema.escalations.id });
  if (!updated) {
    logger.warn("escalation not found when marking replied", { escalationId });
    return;
  }
  await writeAudit({ caseId, actor: paralegalId, action: "escalation.replied", payload: { escalationId, messageId } });
}

async function setCaseStatus(kase: Case, to: Case["status"], actor: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.cases).set({ status: to, updatedAt: new Date() }).where(eq(schema.cases.id, kase.id));
  await writeAudit({ caseId: kase.id, actor, action: "case.status_changed", payload: { from: kase.status, to } });
}
