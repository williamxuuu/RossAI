import { escalationReplySchema, replyEscalation } from "@/lib/console-actions";
import { json, readJson, withParalegal } from "../../../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string; escalationId: string }> };

/** POST /api/cases/:caseId/escalations/:escalationId/reply  body { englishText } → { messageId } */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId, escalationId } = await ctx.params;
    const { englishText } = escalationReplySchema.parse(await readJson(req));
    const { messageId } = await replyEscalation({ caseId, escalationId, englishText, paralegalId: paralegal.id });
    return json({ messageId });
  });
}
