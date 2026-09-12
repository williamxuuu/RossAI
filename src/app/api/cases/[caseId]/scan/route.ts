import { rescanCase } from "@/lib/console-actions";
import { json, withParalegal } from "../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string }> };

/** POST /api/cases/:caseId/scan → { ok: true } (enqueues scan-case for this case) */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId } = await ctx.params;
    await rescanCase({ caseId, paralegalId: paralegal.id });
    return json({ ok: true });
  });
}
