import "server-only";
import type { Channel, ChannelProvider, InboundMessage, OutboundResult } from "./types";
import { log } from "@/lib/log";

/**
 * One provider per channel (docs/ARCHITECTURE.md §8).
 *
 * The spec wanted a single coworker owning both the phone number and the inbox.
 * Ambiguous owns the inbox; it has no phone number, so Twilio owns SMS. This class
 * is the only place that knows that. If Ambiguous ships SMS, delete the `sms` entry
 * and nothing above the adapter changes.
 */

const logger = log.scope("channel:composite");

export class CompositeChannelProvider implements ChannelProvider {
  readonly name = "composite";

  constructor(private readonly providers: Record<Channel, ChannelProvider>) {}

  /** The adapter that owns a channel, for callers that need it by name (webhooks). */
  for(channel: Channel): ChannelProvider {
    return this.providers[channel];
  }

  sendSms(to: string, body: string): Promise<OutboundResult> {
    return this.providers.sms.sendSms(to, body);
  }

  sendEmail(to: string, subject: string, body: string): Promise<OutboundResult> {
    return this.providers.email.sendEmail(to, subject, body);
  }

  /**
   * Webhooks are channel-specific routes, so the composite tries both adapters and
   * takes whichever one recognises the request. A provider that rejects a signature
   * throws a Response, which propagates — a bad signature is never retried against
   * the other adapter.
   */
  async parseInbound(req: Request): Promise<InboundMessage | null> {
    const contentType = req.headers.get("content-type") ?? "";
    const order: Channel[] = contentType.includes("application/json") ? ["email", "sms"] : ["sms", "email"];
    let lastError: unknown = null;
    for (const channel of order) {
      try {
        const parsed = await this.providers[channel].parseInbound(req.clone());
        if (parsed) return parsed;
      } catch (err) {
        if (err instanceof Response) throw err;
        lastError = err;
      }
    }
    if (lastError) logger.warn("no adapter could parse the webhook", { err: String(lastError) });
    return null;
  }

  identity() {
    return { ...this.providers.email.identity(), ...this.providers.sms.identity() };
  }
}
