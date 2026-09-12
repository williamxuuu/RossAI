import "server-only";
import { NextResponse } from "next/server";
import { getChannelProvider } from "@/lib/channel";
import type { Channel, InboundMessage } from "@/lib/channel/types";
import { enqueue } from "@/lib/jobs";
import { intakeInbound } from "@/lib/pipeline/cases";
import { ingestInboundAttachments } from "@/lib/pipeline/documents";
import { log } from "@/lib/log";

/**
 * What both channel webhooks do, once the provider has parsed and verified the
 * request (spec §3.1 SMS intake, §3.3 email document intake).
 *
 *   parse → verify signature (in the provider) → store client/case/message →
 *   store attachments → enqueue the pipeline → answer the provider
 *
 * Order matters. The message row is written before any pipeline work, so a provider
 * retry after a slow response is de-duplicated by `externalId` instead of replaying
 * intake. Nothing here decides anything about the case; it only records what arrived.
 */

const logger = log.scope("webhook");

export type InboundOutcome = {
  ok: true;
  caseId: string;
  messageId: string;
  duplicate: boolean;
  documents: number;
};

export async function handleInboundRequest(req: Request, expected: Channel): Promise<Response> {
  const provider = await getChannelProvider();

  let message: InboundMessage | null;
  try {
    message = await provider.parseInbound(req);
  } catch (err) {
    // Providers throw a Response for a failed signature check; anything else is a 400.
    if (err instanceof Response) return err;
    logger.warn("could not parse inbound webhook", { provider: provider.name, expected, err: String(err) });
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Delivery receipts and status callbacks parse to null — acknowledged, not processed.
  if (!message) return acknowledge(provider.name, expected, null);

  if (message.channel !== expected) {
    logger.warn("channel mismatch", { expected, got: message.channel, provider: provider.name });
  }

  const outcome = await processInbound(message);
  return acknowledge(provider.name, expected, outcome);
}

export async function processInbound(message: InboundMessage): Promise<InboundOutcome> {
  const { caseId, messageId, duplicate } = await intakeInbound(message);
  if (duplicate) return { ok: true, caseId, messageId, duplicate: true, documents: 0 };

  let documents = 0;
  if (message.attachments.length > 0) {
    const ids = await ingestInboundAttachments(caseId, message);
    documents = ids.length;
  }

  if (message.body.trim()) {
    await enqueue("process-inbound-message", { messageId, hasAttachments: message.attachments.length > 0 });
  }

  return { ok: true, caseId, messageId, duplicate: false, documents };
}

/**
 * Twilio logs a warning (error 12300) for a non-TwiML reply, so SMS webhooks answer
 * it with an empty TwiML document. Everything else gets JSON, which the /dev/phone
 * simulator renders.
 */
function acknowledge(providerName: string, channel: Channel, outcome: InboundOutcome | null): Response {
  if (providerName === "twilio" && channel === "sms") {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { "content-type": "text/xml; charset=utf-8" },
    });
  }
  return NextResponse.json(outcome ?? { ok: true, ignored: true });
}
