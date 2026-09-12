import { handleInboundRequest } from "../../_lib/inbound";

/**
 * POST /api/webhooks/channel/email — inbound email, which is how documents arrive
 * (spec §3.3: "texts the list to the client with instructions to email documents").
 *
 * Public (src/proxy.ts). `AmbiguousChannelProvider.parseInbound` verifies the
 * HMAC-SHA256 signature on the `email.received` webhook and throws a 401 Response
 * when it does not match.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleInboundRequest(req, "email");
}
