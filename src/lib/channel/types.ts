/**
 * Client channel abstraction (spec §1: "Ambiguous AI coworker — owns a phone
 * number + inbox; handles SMS and email intake").
 *
 * Providers only move bytes. Approval and audit happen in src/lib/pipeline/reply.ts,
 * which is the only module allowed to call `send*` with free text.
 */
export type Channel = "sms" | "email";

export type InboundAttachment = {
  filename: string;
  mimeType: string;
  /** Lazy so we never download bytes we will reject on type alone. */
  bytes: () => Promise<Buffer>;
};

export type InboundMessage = {
  channel: Channel;
  /** E.164 phone for SMS, email address for email. */
  from: string;
  body: string;
  subject?: string;
  externalId?: string;
  receivedAt: Date;
  attachments: InboundAttachment[];
};

export type OutboundResult = { externalId?: string };

export interface ChannelProvider {
  readonly name: string;
  sendSms(to: string, body: string): Promise<OutboundResult>;
  sendEmail(to: string, subject: string, body: string): Promise<OutboundResult>;
  /**
   * Parse and verify a provider webhook request into a normalized inbound message.
   * Returns null when the request is not an inbound message (e.g. a delivery receipt).
   * Must throw a Response(401) if signature verification fails.
   */
  parseInbound(req: Request): Promise<InboundMessage | null>;
  /** The phone number / inbox clients are told to use. */
  identity(): { phone?: string; email?: string };
}
