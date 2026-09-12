import { decideFlag, flagDecisionSchema } from "@/lib/console-actions";
import { json, readJson, withParalegal } from "../../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string; flagId: string }> };

/**
 * PATCH /api/cases/:caseId/flags/:flagId
 * body { decision: approve|edit|reject|request_more_info, editedText?, requestText? } → { flag, messageId?, sendError? }
 */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId, flagId } = await ctx.params;
    const body = flagDecisionSchema.parse(await readJson(req));
    const result = await decideFlag({ ...body, caseId, flagId, paralegalId: paralegal.id });
    return json(result);
  });
}
