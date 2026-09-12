import { dismissEscalation } from "@/lib/console-actions";
import { json, withParalegal } from "../../../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string; escalationId: string }> };

/** POST /api/cases/:caseId/escalations/:escalationId/dismiss → { ok: true } */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId, escalationId } = await ctx.params;
    await dismissEscalation({ caseId, escalationId, paralegalId: paralegal.id });
    return json({ ok: true });
  });
}
