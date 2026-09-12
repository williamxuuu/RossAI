import "server-only";
import type { ChannelProvider } from "./types";
import { MockChannelProvider } from "./mock";
<<<<<<< HEAD

export type { ChannelProvider, InboundMessage, InboundAttachment, Channel, OutboundResult } from "./types";

let provider: ChannelProvider | null = null;

/** CHANNEL_PROVIDER=ambiguous | mock (default). */
export async function getChannelProvider(): Promise<ChannelProvider> {
  if (provider) return provider;
  const name = (process.env.CHANNEL_PROVIDER ?? "mock").toLowerCase();
  if (name === "ambiguous") {
    const { AmbiguousChannelProvider } = await import("./ambiguous");
    provider = new AmbiguousChannelProvider();
  } else {
    provider = new MockChannelProvider();
  }
  return provider;
}
=======
import { log } from "@/lib/log";

export type { ChannelProvider, InboundMessage, InboundAttachment, Channel, OutboundResult } from "./types";

/**
 * Which provider moves the bytes (docs/ARCHITECTURE.md §8).
 *
 *   CHANNEL_PROVIDER=mock (default)  in-memory outbox; /dev/phone plays the client
 *   CHANNEL_PROVIDER=live            Twilio for SMS, Ambiguous for email
 *   CHANNEL_PROVIDER=twilio          SMS only (email sends throw)
 *   CHANNEL_PROVIDER=ambiguous       email only (SMS sends throw)
 *
 * Approval and audit are NOT here: src/lib/pipeline/reply.ts is the only module
 * allowed to call `send*` (spec §4 human gate).
 */

const logger = log.scope("channel");

let provider: ChannelProvider | null = null;

export async function getChannelProvider(): Promise<ChannelProvider> {
  if (provider) return provider;
  const name = (process.env.CHANNEL_PROVIDER ?? "mock").toLowerCase();
  provider = await build(name);
  logger.info("provider selected", { configured: name, active: provider.name });
  return provider;
}

async function build(name: string): Promise<ChannelProvider> {
  switch (name) {
    case "live":
    case "composite": {
      const [{ TwilioChannelProvider }, { AmbiguousChannelProvider }, { CompositeChannelProvider }] = await Promise.all([
        import("./twilio"),
        import("./ambiguous"),
        import("./composite"),
      ]);
      return new CompositeChannelProvider({ sms: new TwilioChannelProvider(), email: new AmbiguousChannelProvider() });
    }
    case "twilio": {
      const { TwilioChannelProvider } = await import("./twilio");
      return new TwilioChannelProvider();
    }
    case "ambiguous": {
      const { AmbiguousChannelProvider } = await import("./ambiguous");
      return new AmbiguousChannelProvider();
    }
    default:
      return new MockChannelProvider();
  }
}

/** Tests and the dev reset endpoint need a fresh selection. */
export function resetChannelProvider(): void {
  provider = null;
}
>>>>>>> 8d64fb4a3699d6db3d952409328d6ef500dd697b
