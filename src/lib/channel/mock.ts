import "server-only";
import type { ChannelProvider, InboundMessage, OutboundResult } from "./types";
import { log } from "@/lib/log";

/**
 * Mock provider for local demo. Outbound messages are appended to an in-memory
 * outbox (and persisted as Message rows by the pipeline, which is what the
 * /dev/phone simulator renders). Inbound messages arrive from the simulator via
 * POST /api/webhooks/channel/{sms,email} using the same JSON shape the simulator
 * sends, so the whole pipeline runs unchanged.
 */
const logger = log.scope("channel:mock");

type OutboxEntry = { channel: "sms" | "email"; to: string; subject?: string; body: string; at: string };
const g = globalThis as unknown as { __rossaiOutbox?: OutboxEntry[] };
export const mockOutbox: OutboxEntry[] = (g.__rossaiOutbox ??= []);

export class MockChannelProvider implements ChannelProvider {
  readonly name = "mock";

  async sendSms(to: string, body: string): Promise<OutboundResult> {
    mockOutbox.push({ channel: "sms", to, body, at: new Date().toISOString() });
    logger.info("sms →", { to, preview: body.slice(0, 60) });
    return { externalId: `mock-sms-${mockOutbox.length}` };
  }

  async sendEmail(to: string, subject: string, body: string): Promise<OutboundResult> {
    mockOutbox.push({ channel: "email", to, subject, body, at: new Date().toISOString() });
    logger.info("email →", { to, subject });
    return { externalId: `mock-email-${mockOutbox.length}` };
  }

  /**
   * Accepts either JSON { channel, from, body, subject?, attachments?: [{filename, mimeType, base64}] }
   * or multipart/form-data with fields channel, from, body, subject and file parts.
   */
  async parseInbound(req: Request): Promise<InboundMessage | null> {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const channel = (form.get("channel") as string) === "email" ? "email" : "sms";
      const from = String(form.get("from") ?? "");
      const body = String(form.get("body") ?? "");
      const subject = form.get("subject") ? String(form.get("subject")) : undefined;
      const attachments = form
        .getAll("files")
        .filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f)
        .map((f) => ({
          filename: f.name || "attachment",
          mimeType: f.type || "application/octet-stream",
          bytes: async () => Buffer.from(await f.arrayBuffer()),
        }));
      if (!from) return null;
      return { channel, from, body, subject, receivedAt: new Date(), attachments };
    }
    const json = (await req.json()) as {
      channel?: string;
      from?: string;
      body?: string;
      subject?: string;
      attachments?: { filename: string; mimeType: string; base64: string }[];
    };
    if (!json.from) return null;
    return {
      channel: json.channel === "email" ? "email" : "sms",
      from: json.from,
      body: json.body ?? "",
      subject: json.subject,
      receivedAt: new Date(),
      attachments: (json.attachments ?? []).map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        bytes: async () => Buffer.from(a.base64, "base64"),
      })),
    };
  }

  identity() {
    return {
      phone: process.env.CHANNEL_PHONE_NUMBER || "+1 (555) 010-0000",
      email: process.env.CHANNEL_INBOX_EMAIL || "docs@clinic.local",
    };
  }
}
