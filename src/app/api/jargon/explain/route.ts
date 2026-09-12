import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ground } from "@/lib/grounding";
import { writeAudit, AGENT_ACTOR } from "@/lib/audit";
import { normalizeLanguage } from "@/lib/i18n";
import { withCors, preflight } from "@/lib/cors";
import { createRateLimiter, requestKey, rateLimitResponse } from "@/lib/ratelimit";
import { log } from "@/lib/log";
import { detectFormNumber } from "../_lib/formHint";
import { ungroundedKind, ungroundedMessage } from "../_lib/messages";
import { readJsonBody, textHash, pageHost } from "../_lib/common";

/**
 * POST /api/jargon/explain — public, anonymous (Chrome extension + /jargon page).
 *
 * Explains what a selected term or form field MEANS, grounded in a uscis.gov
 * passage. Spec §3.2 hard rule: never says what the client should do; with no
 * grounded source it says so and the overlay offers escalation instead.
 *
 * Audit stores only a hash of the selected text (it may be PII).
 */
export const runtime = "nodejs";

const logger = log.scope("jargon:explain");
const limiter = createRateLimiter({ name: "jargon.explain", capacity: 30, windowMs: 60_000 });

const Body = z.object({
  text: z.string().trim().min(3).max(400),
  pageUrl: z.string().url().max(2048).optional(),
  language: z.string().max(16).optional(),
});

export type ExplainResponse =
  | { grounded: true; language: string; explanation: string; citation: { title: string; url: string; quote: string }; formHint?: string }
  | { grounded: false; language: string; reason: string; message: string; formHint?: string };

export const OPTIONS = preflight;

export const POST = withCors(async (req: NextRequest) => {
  const limit = limiter.take(requestKey(req));
  if (!limit.ok) return rateLimitResponse(limit);

  const parsed = await readJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  const { text, pageUrl } = parsed.data;
  const language = normalizeLanguage(parsed.data.language);
  const formHint = detectFormNumber(text, pageUrl);

  const result = await ground(text, {
    language,
    mode: "explain",
    hint: formHint,
    context: [formHint ? `Form ${formHint}` : "", pageUrl ? `Page: ${pageUrl}` : ""].filter(Boolean).join(". ") || undefined,
  });

  const hash = textHash(text);
  if (result.grounded) {
    await audit("jargon.explained", { textHash: hash, language, grounded: true, citationUrl: result.citation.url, formHint, pageHost: pageHost(pageUrl) });
    const body: ExplainResponse = {
      grounded: true,
      language,
      explanation: result.text,
      citation: { title: result.citation.title, url: result.citation.url, quote: result.citation.quote },
      formHint,
    };
    return NextResponse.json(body);
  }

  await audit("jargon.ungrounded", { textHash: hash, language, grounded: false, reason: result.reason, formHint, pageHost: pageHost(pageUrl) });
  const body: ExplainResponse = {
    grounded: false,
    language,
    reason: result.reason,
    message: ungroundedMessage(language, ungroundedKind(result.reason)),
    formHint,
  };
  return NextResponse.json(body);
});

/** Explaining is read-only, so an audit hiccup must not turn into a failed lookup for the client. */
async function audit(action: "jargon.explained" | "jargon.ungrounded", payload: Record<string, unknown>): Promise<void> {
  try {
    await writeAudit({ caseId: null, actor: AGENT_ACTOR, action, payload });
  } catch (err) {
    logger.error("audit write failed", { action, err: String(err) });
  }
}
