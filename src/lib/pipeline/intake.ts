import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Case, Client, IntakeState, Message } from "@/db/schema";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { caseTypeOptions, parseCaseTypeReply, type CaseType } from "@/lib/casetypes";
import { localizedDocName } from "@/lib/casetypes/checklists";
import { ground } from "@/lib/grounding";
import { classifyClientQuestion, looksLikeQuestion } from "@/lib/guardrails/classify";
import { log } from "@/lib/log";
import { checklistProgress, generateChecklist, sendChecklistToClient, verifyHeldDocuments } from "./checklist";
import { getCase, setCaseStatus, updateIntakeState } from "./cases";
import { createEscalation } from "./escalation";
import { isAutoSendEnabled, sendGroundedAuto, sendTemplate } from "./reply";

/**
 * What happens when a client texts (spec §3.1 intake, §3.5 escalation).
 *
 * Two phases, decided by the case status:
 *
 *   status "intake"  → the conversational intake state machine below. It asks for
 *                      exactly two things: the language (detected, not asked) and
 *                      which kind of case this is. Then it builds the checklist and
 *                      hands off to the document loop.
 *   any other status → the message is a question. `classifyClientQuestion()` decides
 *                      whether the agent may try to answer it at all; anything needing
 *                      judgment becomes an escalation and a person replies.
 *
 * Nothing in this file sends model-authored text to a client. Grounded answers become
 * escalation drafts a paralegal approves, unless the clinic has explicitly turned on
 * AUTO_SEND_GROUNDED_ANSWERS.
 */

const logger = log.scope("intake");

/** How many times the agent re-asks which case type before handing over to a person. */
const MAX_CASE_TYPE_ATTEMPTS = 3;

export type ProcessOptions = {
  /** True when documents arrived with this message; a cover note is then not a question. */
  hasAttachments?: boolean;
};

export async function processInboundMessage(messageId: string, opts: ProcessOptions = {}): Promise<void> {
  const db = await getDb();
  const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!message || message.direction !== "inbound") return;
  if (!message.caseId) {
    logger.warn("inbound message has no case", { messageId });
    return;
  }
  const kase = await getCase(message.caseId);
  if (!kase || kase.status === "closed") return;
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, kase.clientId) });
  if (!client) return;

  const body = message.body.trim();
  if (!body) return; // an attachment-only email; the document loop handles it

  if (kase.status === "intake") {
    await runIntakeStep({ kase, client, message, body });
    return;
  }

  // "Here are my documents" is a cover note, not a question. Sending it through
  // question handling would escalate it — unclassifiable text is treated as needing
  // judgment on purpose — and leave a paralegal clearing an empty escalation for
  // every email of documents.
  if (opts.hasAttachments && !looksLikeQuestion(body)) {
    logger.info("cover note ignored", { caseId: kase.id, messageId });
    return;
  }

  await handleQuestion({ kase, client, message, body });
}

// ---------------------------------------------------------------------------
// intake state machine
// ---------------------------------------------------------------------------

type Ctx = { kase: Case; client: Client; message: Message; body: string };

async function runIntakeStep(ctx: Ctx): Promise<void> {
  const state: IntakeState = ctx.kase.intakeState ?? { step: "language", answers: {} };
  if (state.step === "language") {
    await stepWelcome(ctx, state);
    return;
  }
  await stepChooseCaseType(ctx, state);
}

/**
 * First contact: the clinic's welcome and the one question the agent asks.
 *
 * The language is already known — `intakeInbound()` detected it from this very
 * message before storing it — so nothing here asks the client to pick one. This
 * message is not treated as an answer to the case-type question either: the client
 * has not seen the menu yet.
 */
async function stepWelcome(ctx: Ctx, state: IntakeState): Promise<void> {
  const language = ctx.client.preferredLanguage;

  const next: IntakeState = {
    step: "case_type",
    answers: { ...state.answers, firstMessage: ctx.body.slice(0, 300) },
  };
  await updateIntakeState(ctx.kase.id, next);

  await sendTemplate({ caseId: ctx.kase.id, template: "intake.welcome" });
  await sendTemplate({ caseId: ctx.kase.id, template: "intake.ask_case_type", vars: { options: caseTypeOptions(language) } });
}

/**
 * The one question the agent asks. A reply it cannot read is re-asked, not guessed;
 * after three tries a person takes over, because a client who cannot use the menu is
 * exactly the client who needs one.
 */
async function stepChooseCaseType(ctx: Ctx, state: IntakeState): Promise<void> {
  const language = ctx.client.preferredLanguage;
  const choice = parseCaseTypeReply(ctx.body);

  if (!choice) {
    const attempts = Number(state.answers.caseTypeAttempts ?? "0") + 1;
    await updateIntakeState(ctx.kase.id, { ...state, answers: { ...state.answers, caseTypeAttempts: String(attempts) } });
    if (attempts >= MAX_CASE_TYPE_ATTEMPTS) {
      await createEscalation({
        caseId: ctx.kase.id,
        question: `Client could not choose a case type after ${attempts} tries. Their replies: "${ctx.body}"`,
        reason: "judgment",
        sourceMessageId: ctx.message.id,
      });
      return;
    }
    await sendTemplate({ caseId: ctx.kase.id, template: "intake.ask_case_type", vars: { options: caseTypeOptions(language) } });
    return;
  }

  await setCaseType(ctx.kase.id, choice);
  await updateIntakeState(ctx.kase.id, { step: "done", answers: { ...state.answers, caseType: choice } });
  await generateChecklist(ctx.kase.id);
  await setCaseStatus(ctx.kase.id, "collecting_docs", AGENT_ACTOR, { trigger: "case_type_chosen" });
  await sendChecklistToClient(ctx.kase.id, language);
  // Anything the client sent before choosing a case type was held; check it now that
  // there is a list to check it against. The client hears "received" after the list.
  await verifyHeldDocuments(ctx.kase.id);
}

async function setCaseType(caseId: string, caseType: CaseType): Promise<void> {
  const db = await getDb();
  await db.update(schema.cases).set({ caseType, updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
  await writeAudit({ caseId, actor: AGENT_ACTOR, action: "intake.case_type_set", payload: { caseType } });
}

// ---------------------------------------------------------------------------
// questions after intake
// ---------------------------------------------------------------------------

async function handleQuestion(ctx: Ctx): Promise<void> {
  const classification = await classifyClientQuestion(ctx.body);
  logger.info("classified", { caseId: ctx.kase.id, kind: classification.kind, by: classification.by });

  switch (classification.kind) {
    case "judgment":
      await createEscalation({
        caseId: ctx.kase.id,
        question: ctx.body,
        reason: "judgment",
        sourceMessageId: ctx.message.id,
      });
      return;
    case "status":
    case "other":
      await sendStatusUpdate(ctx);
      return;
    case "explain":
      await answerIfGrounded(ctx);
      return;
  }
}

/** Clinic-owned progress text. Operational, so it goes out without a human. */
async function sendStatusUpdate(ctx: Ctx): Promise<void> {
  const language = ctx.client.preferredLanguage;
  await sendTemplate({
    caseId: ctx.kase.id,
    template: "status.update",
    vars: { status: await statusSummary(ctx.kase, language) },
  });
}

async function statusSummary(kase: Case, language: string): Promise<string> {
  const progress = await checklistProgress(kase.id);
  const t = STATUS_STRINGS[language] ?? STATUS_STRINGS.en;
  if (kase.status === "intake") return t.intake;
  if (progress.total === 0) return t.noChecklist;
  if (!progress.complete) {
    const list = progress.pending.map((i) => `• ${localizedDocName(i.docName, language)}`).join("\n");
    return `${t.received(progress.done, progress.total)}\n${t.stillNeeded}\n${list}`;
  }
  if (kase.status === "replied") return t.replied;
  return t.underReview;
}

type StatusStrings = {
  intake: string;
  noChecklist: string;
  received: (done: number, total: number) => string;
  stillNeeded: string;
  underReview: string;
  replied: string;
};

const STATUS_STRINGS: Record<string, StatusStrings> = {
  en: {
    intake: "We have not started your document list yet.",
    noChecklist: "Your document list has not been created yet.",
    received: (done, total) => `Documents received: ${done} of ${total}.`,
    stillNeeded: "Still needed:",
    underReview: "All of your documents are in. A member of our clinic team is reviewing your case.",
    replied: "A member of our clinic team has replied to you about this case.",
  },
  es: {
    intake: "Todavía no hemos empezado su lista de documentos.",
    noChecklist: "Todavía no se ha creado su lista de documentos.",
    received: (done, total) => `Documentos recibidos: ${done} de ${total}.`,
    stillNeeded: "Todavía faltan:",
    underReview: "Ya tenemos todos sus documentos. Una persona de nuestra clínica está revisando su caso.",
    replied: "Una persona de nuestra clínica ya le respondió sobre este caso.",
  },
};

/**
 * "What does this word mean?" — answerable only from a retrieved USCIS passage.
 * A grounded answer becomes an escalation draft the paralegal approves; it is sent
 * straight through only when the clinic has turned auto-send on.
 */
async function answerIfGrounded(ctx: Ctx): Promise<void> {
  const language = ctx.client.preferredLanguage;
  const result = await ground(ctx.body, {
    language,
    mode: "answer",
    hint: ctx.kase.caseType ?? undefined,
    context: ctx.kase.caseType ? `The client's case is a ${ctx.kase.caseType}.` : undefined,
  });

  if (!result.grounded) {
    await createEscalation({
      caseId: ctx.kase.id,
      question: ctx.body,
      reason: "ungrounded",
      sourceMessageId: ctx.message.id,
    });
    return;
  }

  if (isAutoSendEnabled()) {
    await sendGroundedAuto({
      caseId: ctx.kase.id,
      text: result.text,
      citation: result.citation,
      sourceMessageId: ctx.message.id,
    });
    return;
  }

  await createEscalation({
    caseId: ctx.kase.id,
    question: ctx.body,
    reason: "grounded_pending_approval",
    sourceMessageId: ctx.message.id,
    draftReply: result.text,
    draftCitation: result.citation,
  });
}
