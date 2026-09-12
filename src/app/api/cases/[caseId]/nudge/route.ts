import { nudgeCase } from "@/lib/console-actions";
import { json, withParalegal } from "../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string }> };

/** POST /api/cases/:caseId/nudge → { ok: true } (enqueues nudge-pending for this case) */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId } = await ctx.params;
    await nudgeCase({ caseId, paralegalId: paralegal.id });
    return json({ ok: true });
  });
}
