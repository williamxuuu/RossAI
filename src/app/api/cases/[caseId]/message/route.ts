import { clientMessageSchema, sendClientMessage } from "@/lib/console-actions";
import { json, readJson, withParalegal } from "../../_http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ caseId: string }> };

/** POST /api/cases/:caseId/message — send a paralegal-approved message to the client. */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async (paralegal) => {
    const { caseId } = await ctx.params;
    const { englishText } = clientMessageSchema.parse(await readJson(req));
    return json(await sendClientMessage({ caseId, paralegalId: paralegal.id, englishText }));
  });
}
