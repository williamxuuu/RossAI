import { closeCase } from "@/lib/console-actions";
import { json, withParalegal } from "../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string }> };

/** POST /api/cases/:caseId/close → { ok: true } */
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId } = await ctx.params;
    await closeCase({ caseId, paralegalId: paralegal.id });
    return json({ ok: true });
  });
}
