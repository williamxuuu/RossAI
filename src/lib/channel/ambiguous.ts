import "server-only";
import type { ChannelProvider, InboundMessage, OutboundResult } from "./types";

/**
 * Ambiguous AI coworker adapter. Placeholder until the provider's API is wired:
 * every call fails loudly so misconfiguration is never silent.
 */
export class AmbiguousChannelProvider implements ChannelProvider {
  readonly name = "ambiguous";
  private notConfigured(): never {
    throw new Error("AmbiguousChannelProvider is not implemented yet; set CHANNEL_PROVIDER=mock");
  }
  async sendSms(_to: string, _body: string): Promise<OutboundResult> {
    this.notConfigured();
  }
  async sendEmail(_to: string, _subject: string, _body: string): Promise<OutboundResult> {
    this.notConfigured();
  }
  async parseInbound(_req: Request): Promise<InboundMessage | null> {
    this.notConfigured();
  }
  identity() {
    return { phone: process.env.CHANNEL_PHONE_NUMBER, email: process.env.CHANNEL_INBOX_EMAIL };
  }
}
