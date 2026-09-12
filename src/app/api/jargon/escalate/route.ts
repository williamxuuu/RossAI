import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { writeAudit, AGENT_ACTOR } from "@/lib/audit";
import { normalizeLanguage } from "@/lib/i18n";
import { withCors, preflight } from "@/lib/cors";
import { createRateLimiter, requestKey, rateLimitResponse } from "@/lib/ratelimit";
import { detectFormNumber } from "../_lib/formHint";
import { readJsonBody, textHash, pageHost } from "../_lib/common";
import { fileJargonEscalation } from "../_lib/escalate";

/**
 * POST /api/jargon/escalate — public, anonymous. "Still confused — ask the clinic".
 *
 * Creates an escalation the paralegal sees in the console. With a phone number the
 * escalation attaches to that client's open case (or a new one); without one an
 * anonymous client + case is created. See ../_lib/escalate.ts for the policy.
 */
export const runtime = "nodejs";

const limiter = createRateLimiter({ name: "jargon.escalate", capacity: 10, windowMs: 60_000 });

const E164 = /^\+[1-9]\d{6,14}$/;

const Body = z.object({
  text: z.string().trim().min(3).max(400),
  pageUrl: z.string().url().max(2048).optional(),
  language: z.string().min(2).max(16),
  question: z.string().trim().max(1000).optional(),
  phone: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s().-]/g, ""))
    .pipe(z.string().regex(E164, "phone must be E.164, e.g. +15551234567"))
    .optional(),
});

export type EscalateResponse = { ok: true; escalationId: string };

export const OPTIONS = preflight;

export const POST = withCors(async (req: NextRequest) => {
  const limit = limiter.take(requestKey(req));
  if (!limit.ok) return rateLimitResponse(limit);

  const parsed = await readJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const { text, pageUrl, phone } = parsed.data;
  const question = parsed.data.question || undefined;
  const language = normalizeLanguage(parsed.data.language);

  const result = await fileJargonEscalation({ text, pageUrl, language, question, phone });

  await writeAudit({
    caseId: result.caseId,
    actor: AGENT_ACTOR,
    action: "jargon.escalated",
    payload: {
      escalationId: result.escalationId,
      textHash: textHash(text),
      language,
      hasPhone: Boolean(phone),
      hasQuestion: Boolean(question),
      createdClient: result.createdClient,
      createdCase: result.createdCase,
      viaContract: result.viaContract,
      formHint: detectFormNumber(text, pageUrl),
      pageHost: pageHost(pageUrl),
    },
  });

  const body: EscalateResponse = { ok: true, escalationId: result.escalationId };
  return NextResponse.json(body, { status: 201 });
});
