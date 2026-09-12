import "server-only";
import type { ChannelProvider } from "./types";
import { MockChannelProvider } from "./mock";

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
