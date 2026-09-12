import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelProvider, InboundAttachment, InboundMessage, OutboundResult } from "./types";
import { log } from "@/lib/log";

/**
 * Email via the Ambiguous AI coworker's agent inbox — how client documents arrive
 * (spec §1, docs/ARCHITECTURE.md §8).
 *
 * Ambiguous has a real public email API (agent inboxes, `email.received` webhooks
 * signed with HMAC-SHA256, `GET /api/mail/{id}` with attachment downloads, and
 * `POST /api/mail/send`) and no SMS capability at all, which is why SMS runs on
 * Twilio behind the composite provider.
 *
 * The exact JSON shape of the `email.received` payload is not documented, so
 * `parseInbound` is written defensively: it looks for the mail id under every
 * plausible key, and if the webhook already carries the whole message it uses that
 * instead of fetching. Anything it cannot understand returns null (acknowledged, not
 * processed) rather than throwing away a client's documents with a 500.
 *
 * Env: AMBIGUOUS_API_KEY, AMBIGUOUS_WEBHOOK_SECRET, AMBIGUOUS_INBOX_EMAIL,
 *      AMBIGUOUS_API_BASE_URL (default https://api.ambiguous.ai)
 */

const logger = log.scope("channel:ambiguous");

const DEFAULT_BASE_URL = "https://api.ambiguous.ai";

type JsonRecord = Record<string, unknown>;

export class AmbiguousChannelProvider implements ChannelProvider {
  readonly name = "ambiguous";

  private apiKey(): string {
    const key = process.env.AMBIGUOUS_API_KEY;
    if (!key) throw new Error("AMBIGUOUS_API_KEY is not set");
    return key;
  }

  private baseUrl(): string {
    return (process.env.AMBIGUOUS_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async sendSms(): Promise<OutboundResult> {
    throw new Error("Ambiguous has no SMS capability; SMS runs on Twilio (see docs/ARCHITECTURE.md §8)");
  }

  async sendEmail(to: string, subject: string, body: string): Promise<OutboundResult> {
    const res = await fetch(`${this.baseUrl()}/api/mail/send`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey()}`,
        "content-type": "application/json",
        // Ambiguous de-duplicates retries on this key; the caller already wrote the
        // Message row, so the same text is never sent twice by a network retry.
        "idempotency-key": idempotencyKey(to, subject, body),
      },
      body: JSON.stringify({ to, subject, text: body, from: process.env.AMBIGUOUS_INBOX_EMAIL }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ambiguous mail send failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    const json = (await res.json().catch(() => ({}))) as JsonRecord;
    const externalId = firstString(json, ["id", "mail_id", "mailId", "message_id", "messageId"]);
    logger.info("email sent", { to, externalId });
    return { externalId };
  }

  async parseInbound(req: Request): Promise<InboundMessage | null> {
    const raw = await req.text();
    this.verifySignature(req, raw);

    let payload: JsonRecord;
    try {
      payload = JSON.parse(raw) as JsonRecord;
    } catch {
      logger.warn("webhook body was not JSON");
      return null;
    }

    const event = firstString(payload, ["event", "type", "event_type", "eventType"]);
    if (event && !event.includes("received")) {
      logger.info("ignoring non-delivery event", { event });
      return null;
    }

    const data = (asRecord(payload.data) ?? asRecord(payload.mail) ?? asRecord(payload.message) ?? payload) as JsonRecord;
    const mail = (await this.resolveMail(data)) ?? data;

    const from = extractAddress(mail, ["from", "from_address", "fromAddress", "sender", "from_email"]);
    if (!from) {
      logger.warn("inbound mail has no sender address", { keys: Object.keys(mail).slice(0, 12) });
      return null;
    }

    return {
      channel: "email",
      from,
      body: firstString(mail, ["text", "body_text", "bodyText", "plain", "body", "snippet"]) ?? "",
      subject: firstString(mail, ["subject", "title"]),
      externalId: firstString(mail, ["id", "mail_id", "mailId", "message_id", "messageId"]),
      receivedAt: parseDate(firstString(mail, ["received_at", "receivedAt", "date", "created_at", "createdAt"])),
      attachments: this.attachmentsFrom(mail),
    };
  }

  identity() {
    return { email: process.env.AMBIGUOUS_INBOX_EMAIL ?? process.env.CHANNEL_INBOX_EMAIL };
  }

  // -------------------------------------------------------------------------

  /**
   * HMAC-SHA256 over the raw request body, compared in constant time. A webhook that
   * cannot be verified is rejected with 401 — an unauthenticated caller must not be
   * able to inject documents into a stranger's case.
   */
  private verifySignature(req: Request, raw: string): void {
    const secret = process.env.AMBIGUOUS_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error("AMBIGUOUS_WEBHOOK_SECRET is not set; refusing to accept unverified webhooks");
    }
    const header =
      req.headers.get("x-ambiguous-signature") ??
      req.headers.get("x-signature") ??
      req.headers.get("x-webhook-signature") ??
      "";
    // Providers send either "<hex>" or "sha256=<hex>".
    const provided = header.includes("=") ? header.slice(header.indexOf("=") + 1).trim() : header.trim();
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const ok =
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
    if (!ok) {
      logger.warn("rejected webhook with a bad signature");
      throw new Response(JSON.stringify({ error: "invalid_signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
  }

  /** The webhook may carry only an id; fetch the full message when the body is absent. */
  private async resolveMail(data: JsonRecord): Promise<JsonRecord | null> {
    const hasBody = ["text", "body_text", "bodyText", "body", "attachments"].some((k) => k in data);
    if (hasBody) return null;
    const id = firstString(data, ["id", "mail_id", "mailId", "message_id", "messageId"]);
    if (!id) return null;
    try {
      const res = await fetch(`${this.baseUrl()}/api/mail/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${this.apiKey()}` },
      });
      if (!res.ok) {
        logger.warn("mail fetch failed", { id, status: res.status });
        return null;
      }
      const json = (await res.json()) as JsonRecord;
      return asRecord(json.data) ?? asRecord(json.mail) ?? json;
    } catch (err) {
      logger.error("mail fetch threw", { id, err: String(err) });
      return null;
    }
  }

  private attachmentsFrom(mail: JsonRecord): InboundAttachment[] {
    const list = Array.isArray(mail.attachments) ? mail.attachments : [];
    const apiKey = this.apiKey();
    const base = this.baseUrl();
    const out: InboundAttachment[] = [];
    for (const entry of list) {
      const a = asRecord(entry);
      if (!a) continue;
      const filename = firstString(a, ["filename", "file_name", "fileName", "name"]) ?? "attachment";
      const mimeType = firstString(a, ["content_type", "contentType", "mime_type", "mimeType", "type"]) ?? "application/octet-stream";
      const inlineBase64 = firstString(a, ["content", "data", "base64"]);
      const url = firstString(a, ["url", "download_url", "downloadUrl", "href"]);
      const id = firstString(a, ["id", "attachment_id", "attachmentId"]);

      if (inlineBase64) {
        out.push({ filename, mimeType, bytes: async () => Buffer.from(inlineBase64, "base64") });
        continue;
      }
      const href = url ?? (id ? `${base}/api/mail/attachments/${encodeURIComponent(id)}` : null);
      if (!href) continue;
      out.push({
        filename,
        mimeType,
        bytes: async () => {
          const res = await fetch(href, { headers: { authorization: `Bearer ${apiKey}` } });
          if (!res.ok) throw new Error(`Ambiguous attachment download failed: ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        },
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function firstString(source: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** `from` may be a string, `{ address }`, `{ email }`, or a one-element array of those. */
function extractAddress(source: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === "string" && candidate.trim()) return normalizeAddress(candidate);
    const record = asRecord(candidate);
    const nested = record ? firstString(record, ["address", "email", "value"]) : undefined;
    if (nested) return normalizeAddress(nested);
  }
  return undefined;
}

/** "Maria Garcia <maria@example.com>" → "maria@example.com" */
function normalizeAddress(raw: string): string {
  const angle = raw.match(/<([^>]+)>/);
  return (angle ? angle[1] : raw).trim().toLowerCase();
}

function parseDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const t = Date.parse(raw);
  return Number.isNaN(t) ? new Date() : new Date(t);
}

function idempotencyKey(to: string, subject: string, body: string): string {
  return createHmac("sha256", "rossai-outbound").update(`${to}|${subject}|${body}`).digest("hex").slice(0, 32);
}
