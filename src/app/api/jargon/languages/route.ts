import { NextResponse } from "next/server";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";
import { withCors, preflight } from "@/lib/cors";
import { UNGROUNDED_MESSAGE_LANGUAGES } from "../_lib/messages";

/**
 * GET /api/jargon/languages — public, anonymous.
 *
 * The extension popup builds its language menu from this so the list can never drift
 * from SUPPORTED_LANGUAGES on the server. `hasLocalRefusalMessage` marks the languages
 * whose "we could not find a source" text is a human translation rather than English —
 * the popup does not use it yet, but it is the difference between a client seeing their
 * own language and seeing English at the exact moment the agent is refusing to answer.
 */
export const runtime = "nodejs";

export const OPTIONS = preflight;

export const GET = withCors(async () => {
  return NextResponse.json(
    {
      languages: SUPPORTED_LANGUAGES,
      hasLocalRefusalMessage: UNGROUNDED_MESSAGE_LANGUAGES,
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
});
