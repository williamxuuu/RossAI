import "server-only";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { Case, CaseStatus, Client, IntakeState } from "@/db/schema";
import type { Channel, InboundMessage } from "@/lib/channel/types";
import { AGENT_ACTOR, writeAudit } from "@/lib/audit";
import { normalizeLanguage } from "@/lib/i18n";
import { log } from "@/lib/log";
import { extractCaseCode, findCaseByCode, rememberClientEmail } from "./casecode";
import { detectLanguage } from "./language";

/**
 * Client, case and inbound-message plumbing shared by the webhooks, the intake
 * state machine, and the document loop. Nothing here talks to a model or to Exa;
 * it only decides which row an inbound message belongs to.
 *
 * Client anonymity (spec §4): a client is a phone number or an email address and a
 * preferred language. No name, no address, nothing the case does not need.
 */

const logger = log.scope("cases");

export const INITIAL_INTAKE_STATE: IntakeState = { step: "language", answers: {} };

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

export async function findOrCreateClientByPhone(
  phone: string,
  opts: { language?: string; email?: string } = {},
): Promise<{ client: Client; created: boolean }> {
  const db = await getDb();
  const existing = await db.query.clients.findFirst({ where: eq(schema.clients.phone, phone) });
  if (existing) {
    if (opts.email && !existing.email) {
      const [updated] = await db.update(schema.clients).set({ email: opts.email }).where(eq(schema.clients.id, existing.id)).returning();
      return { client: updated, created: false };
    }
    return { client: existing, created: false };
  }
  // Race-safe: a concurrent insert for the same phone loses on the unique index.
  const inserted = await db
    .insert(schema.clients)
    .values({ phone, email: opts.email ?? null, preferredLanguage: normalizeLanguage(opts.language) })
    .onConflictDoNothing({ target: schema.clients.phone })
    .returning();
  if (inserted.length === 0) {
    const again = await db.query.clients.findFirst({ where: eq(schema.clients.phone, phone) });
    if (!again) throw new Error("client upsert failed");
    return { client: again, created: false };
  }
  await writeAudit({ caseId: null, actor: AGENT_ACTOR, action: "client.created", payload: { clientId: inserted[0].id, via: "sms" } });
  return { client: inserted[0], created: true };
}

export async function findOrCreateClientByEmail(
  email: string,
  opts: { language?: string } = {},
): Promise<{ client: Client; created: boolean }> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const existing = await db.query.clients.findFirst({
    where: eq(schema.clients.email, normalized),
    orderBy: [desc(schema.clients.createdAt)],
  });
  if (existing) return { client: existing, created: false };
  const [created] = await db
    .insert(schema.clients)
    .values({ email: normalized, preferredLanguage: normalizeLanguage(opts.language) })
    .returning();
  await writeAudit({ caseId: null, actor: AGENT_ACTOR, action: "client.created", payload: { clientId: created.id, via: "email" } });
  return { client: created, created: true };
}

/** Record the client's language once it is known. No-op when it already matches. */
export async function setClientLanguage(clientId: string, language: string, caseId: string | null): Promise<void> {
  const lang = normalizeLanguage(language);
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, clientId) });
  if (!client || client.preferredLanguage === lang) return;
  await db.update(schema.clients).set({ preferredLanguage: lang }).where(eq(schema.clients.id, clientId));
  await writeAudit({
    caseId,
    actor: AGENT_ACTOR,
    action: "intake.language_detected",
    payload: { clientId, from: client.preferredLanguage, to: lang },
  });
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

/** The client's open case, or a new one in `intake`. Closed cases are never reused. */
export async function openCaseFor(clientId: string): Promise<{ kase: Case; created: boolean }> {
  const db = await getDb();
  const open = await db.query.cases.findFirst({
    where: and(eq(schema.cases.clientId, clientId), ne(schema.cases.status, "closed")),
    orderBy: [desc(schema.cases.updatedAt)],
  });
  if (open) return { kase: open, created: false };
  const [created] = await db
    .insert(schema.cases)
    .values({ clientId, caseType: null, status: "intake", intakeState: INITIAL_INTAKE_STATE })
    .returning();
  await writeAudit({ caseId: created.id, actor: AGENT_ACTOR, action: "case.created", payload: { clientId } });
  return { kase: created, created: true };
}

export async function getCase(caseId: string): Promise<Case | undefined> {
  const db = await getDb();
  return db.query.cases.findFirst({ where: eq(schema.cases.id, caseId) });
}

/** Move a case to a new status and audit the transition. Idempotent. */
export async function setCaseStatus(caseId: string, to: CaseStatus, actor: string = AGENT_ACTOR, payload: Record<string, unknown> = {}): Promise<void> {
  const db = await getDb();
  const current = await getCase(caseId);
  if (!current || current.status === to) return;
  await db.update(schema.cases).set({ status: to, updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
  await writeAudit({ caseId, actor, action: "case.status_changed", payload: { from: current.status, to, ...payload } });
}

export async function updateIntakeState(caseId: string, state: IntakeState): Promise<void> {
  const db = await getDb();
  await db.update(schema.cases).set({ intakeState: state, updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
}

export async function touchCase(caseId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.cases).set({ updatedAt: new Date() }).where(eq(schema.cases.id, caseId));
}

// ---------------------------------------------------------------------------
// inbound messages
// ---------------------------------------------------------------------------

export type RecordInboundInput = {
  caseId: string;
  clientId: string;
  channel: Channel;
  body: string;
  subject?: string;
  externalId?: string;
  language: string;
  attachmentCount: number;
};

/** Store one inbound message and audit it. Returns the message id. */
export async function recordInboundMessage(input: RecordInboundInput): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.messages)
    .values({
      caseId: input.caseId,
      clientId: input.clientId,
      direction: "inbound",
      channel: input.channel,
      body: input.body,
      subject: input.subject ?? null,
      externalId: input.externalId ?? null,
      language: normalizeLanguage(input.language),
    })
    .returning({ id: schema.messages.id });
  await writeAudit({
    caseId: input.caseId,
    actor: AGENT_ACTOR,
    action: "message.received",
    payload: { messageId: row.id, channel: input.channel, attachments: input.attachmentCount, chars: input.body.length },
  });
  return row.id;
}

/**
 * An inbound provider message that has already been de-duplicated by `externalId`
 * returns the existing message id instead of storing it twice. Providers retry.
 */
export async function findMessageByExternalId(externalId: string): Promise<{ id: string } | undefined> {
  const db = await getDb();
  const row = await db.query.messages.findFirst({
    where: eq(schema.messages.externalId, externalId),
    columns: { id: true },
  });
  return row;
}

/**
 * Everything the webhooks do after parsing a provider payload, in one place:
 * de-duplicate the delivery, decide which client and case it belongs to, learn the
 * client's language if it is not known yet, and store the message.
 */
export async function intakeInbound(message: InboundMessage): Promise<{
  clientId: string;
  caseId: string;
  messageId: string;
  duplicate: boolean;
}> {
  if (message.externalId) {
    const seen = await findMessageByExternalId(message.externalId);
    if (seen) {
      logger.info("duplicate provider delivery ignored", { externalId: message.externalId });
      const db = await getDb();
      const row = await db.query.messages.findFirst({ where: eq(schema.messages.id, seen.id) });
      return { clientId: row?.clientId ?? "", caseId: row?.caseId ?? "", messageId: seen.id, duplicate: true };
    }
  }

  const { client, kase } = await resolveClientAndCase(message);
  const language = await ensureLanguage(client, kase.id, message.body);

  const messageId = await recordInboundMessage({
    caseId: kase.id,
    clientId: client.id,
    channel: message.channel,
    body: message.body,
    subject: message.subject,
    externalId: message.externalId,
    language,
    attachmentCount: message.attachments.length,
  });
  return { clientId: client.id, caseId: kase.id, messageId, duplicate: false };
}

/**
 * Which case this message belongs to.
 *
 * SMS is easy: the phone number is the client. Email is not — the address is usually
 * one the clinic has never seen — so the case code the checklist text gave the client
 * is checked first (src/lib/pipeline/casecode.ts), then the address itself. Only when
 * neither matches does an email open a new case, which is the right outcome for a
 * stranger emailing the clinic's inbox cold.
 */
async function resolveClientAndCase(message: InboundMessage): Promise<{ client: Client; kase: Case }> {
  const db = await getDb();

  if (message.channel === "email") {
    const code = extractCaseCode(message.subject, message.body);
    if (code) {
      const matched = await findCaseByCode(code);
      if (matched) {
        const owner = await db.query.clients.findFirst({ where: eq(schema.clients.id, matched.clientId) });
        if (owner) {
          await rememberClientEmail(owner.id, message.from);
          logger.info("email matched a case by code", { caseId: matched.id });
          const refreshed = await db.query.clients.findFirst({ where: eq(schema.clients.id, owner.id) });
          return { client: refreshed ?? owner, kase: matched };
        }
      }
      logger.warn("email carried a case code that matched nothing", { code });
    }
  }

  const { client } =
    message.channel === "sms"
      ? await findOrCreateClientByPhone(message.from)
      : await findOrCreateClientByEmail(message.from);
  const { kase } = await openCaseFor(client.id);
  return { client, kase };
}

/**
 * Detect the client's language from what they actually wrote, the first time they
 * write anything. It happens here rather than inside the intake state machine so an
 * email that arrives before any text — a client who was given the address by a
 * caseworker — still gets answered in their own language.
 */
async function ensureLanguage(client: Client, caseId: string, body: string): Promise<string> {
  if (client.preferredLanguage !== "en" || body.trim().length < 2) return client.preferredLanguage;
  const guess = await detectLanguage(body);
  if (guess.language === client.preferredLanguage) return client.preferredLanguage;
  await setClientLanguage(client.id, guess.language, caseId);
  return guess.language;
}
