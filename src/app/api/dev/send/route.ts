import { NextResponse } from "next/server";
import { z } from "zod";
import type { InboundMessage } from "@/lib/channel/types";
import { readFixture } from "@/lib/dev";
import { processInbound } from "@/app/api/webhooks/_lib/inbound";
import { log } from "@/lib/log";
import { devGuard } from "../_lib/guard";

/**
 * POST /api/dev/send — the simulator plays the client.
 *
 * It builds the same `InboundMessage` a provider adapter would produce and hands it
 * to the same `processInbound()` the real webhooks call, so the demo exercises the
 * actual pipeline rather than a shortcut through it. Attachments come from the
 * fixtures folder by name; no upload path is exposed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const logger = log.scope("dev:send");

const Body = z.object({
  channel: z.enum(["sms", "email"]),
  from: z.string().trim().min(3).max(200),
  body: z.string().max(4000).default(""),
  subject: z.string().max(200).optional(),
  fixtures: z.array(z.string().max(120)).max(6).default([]),
});

export async function POST(req: Request): Promise<Response> {
  const blocked = devGuard();
  if (blocked) return blocked;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 4) }, { status: 400 });
  }
  const { channel, from, body, subject, fixtures } = parsed.data;

  const attachments = [];
  for (const filename of fixtures) {
    const file = await readFixture(filename);
    if (!file) return NextResponse.json({ error: "unknown_fixture", filename }, { status: 400 });
    attachments.push({ filename, mimeType: file.mimeType, bytes: async () => file.bytes });
  }

  const message: InboundMessage = {
    channel,
    from,
    body,
    subject,
    externalId: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    receivedAt: new Date(),
    attachments,
  };

  try {
    // Jobs run inline without TRIGGER_SECRET_KEY, so this awaits the whole pipeline —
    // which is what the demo wants: send a message, then look at the console.
    const outcome = await processInbound(message);
    return NextResponse.json(outcome);
  } catch (err) {
    logger.error("pipeline failed", { err: String(err) });
    return NextResponse.json({ error: "pipeline_error", message: String(err) }, { status: 500 });
  }
}
