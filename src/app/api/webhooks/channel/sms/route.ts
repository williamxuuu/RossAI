import { handleInboundRequest } from "../../_lib/inbound";

/**
 * POST /api/webhooks/channel/sms — inbound text messages (spec §3.1).
 *
 * Public (src/proxy.ts): the caller is the channel provider, not a paralegal.
 * Authenticity is the provider adapter's job — `TwilioChannelProvider.parseInbound`
 * validates the X-Twilio-Signature and throws a 401 Response when it does not match.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleInboundRequest(req, "sms");
}
