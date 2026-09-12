import "server-only";
import type { ChannelProvider, InboundAttachment, InboundMessage, OutboundResult } from "./types";
import { log } from "@/lib/log";

/**
 * SMS via Twilio Programmable Messaging.
 *
 * The build spec routes SMS through the Ambiguous coworker, but Ambiguous has no
 * phone-number capability (docs/ARCHITECTURE.md §8 — verified against its live
 * OpenAPI spec). SMS therefore runs on Twilio and email on Ambiguous, behind
 * `CompositeChannelProvider`. Nothing above the adapter changed.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 *      TWILIO_WEBHOOK_URL (the exact public URL Twilio is configured to call —
 *      the signature is computed over it, so a proxy that rewrites the host will
 *      break validation unless this is set).
 */

const logger = log.scope("channel:twilio");

type TwilioClient = {
  messages: { create(opts: { from: string; to: string; body: string }): Promise<{ sid: string }> };
};

export class TwilioChannelProvider implements ChannelProvider {
  readonly name = "twilio";
  private client: TwilioClient | null = null;

  private config() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!accountSid || !authToken || !from) {
      throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)");
    }
    return { accountSid, authToken, from };
  }

  private async getClient(): Promise<TwilioClient> {
    if (!this.client) {
      const { accountSid, authToken } = this.config();
      const mod = await import("twilio");
      const factory = (mod.default ?? mod) as unknown as (sid: string, token: string) => TwilioClient;
      this.client = factory(accountSid, authToken);
    }
    return this.client;
  }

  async sendSms(to: string, body: string): Promise<OutboundResult> {
    const { from } = this.config();
    const client = await this.getClient();
    const message = await client.messages.create({ from, to, body });
    logger.info("sms sent", { to: maskPhone(to), sid: message.sid });
    return { externalId: message.sid };
  }

  async sendEmail(): Promise<OutboundResult> {
    throw new Error("TwilioChannelProvider does not send email; use the composite provider");
  }

  /**
   * Twilio posts `application/x-www-form-urlencoded`. The signature is HMAC-SHA1 over
   * the webhook URL plus the sorted POST parameters, so both must be exactly what
   * Twilio used — hence TWILIO_WEBHOOK_URL rather than the request's own URL, which a
   * proxy may have rewritten.
   */
  async parseInbound(req: Request): Promise<InboundMessage | null> {
    const { authToken } = this.config();
    const signature = req.headers.get("x-twilio-signature");
    const raw = await req.text();
    const params = Object.fromEntries(new URLSearchParams(raw));
    const url = process.env.TWILIO_WEBHOOK_URL ?? req.url;

    const { validateRequest } = await import("twilio");
    if (!signature || !validateRequest(authToken, signature, url, params)) {
      logger.warn("rejected webhook with a bad signature", { hasSignature: Boolean(signature), url });
      throw new Response(JSON.stringify({ error: "invalid_signature" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // Status callbacks (delivered / failed) carry MessageStatus and no From/Body pair.
    if (!params.From || (params.MessageStatus && !params.Body && !params.NumMedia)) return null;

    return {
      channel: "sms",
      from: params.From,
      body: params.Body ?? "",
      externalId: params.MessageSid ?? params.SmsMessageSid,
      receivedAt: new Date(),
      attachments: this.mediaAttachments(params),
    };
  }

  /** MMS media, fetched lazily with the account's basic auth. */
  private mediaAttachments(params: Record<string, string>): InboundAttachment[] {
    const count = Number(params.NumMedia ?? "0");
    if (!Number.isFinite(count) || count <= 0) return [];
    const { accountSid, authToken } = this.config();
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const out: InboundAttachment[] = [];
    for (let i = 0; i < count; i += 1) {
      const url = params[`MediaUrl${i}`];
      if (!url) continue;
      const mimeType = params[`MediaContentType${i}`] ?? "application/octet-stream";
      out.push({
        filename: `mms-${i}${extensionFor(mimeType)}`,
        mimeType,
        bytes: async () => {
          const res = await fetch(url, { headers: { authorization: `Basic ${auth}` } });
          if (!res.ok) throw new Error(`Twilio media download failed: ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        },
      });
    }
    return out;
  }

  identity() {
    return { phone: process.env.TWILIO_FROM_NUMBER ?? process.env.CHANNEL_PHONE_NUMBER };
  }
}

function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  };
  return map[mimeType.toLowerCase()] ?? "";
}

/** Phone numbers are PII; logs keep only the last four digits. */
function maskPhone(phone: string): string {
  return `···${phone.replace(/\D/g, "").slice(-4)}`;
}
