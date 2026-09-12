import { getCaseDetail } from "@/lib/queries";
import { json, withParalegal } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ caseId: string }> };

/** GET /api/cases/:caseId → CaseDetail (case, client, checklistItems, documents, flags, escalations, messages, auditEntries). */
export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  return withParalegal(async () => {
    const { caseId } = await ctx.params;
    const detail = await getCaseDetail(caseId);
    if (!detail) return json({ error: "case not found" }, 404);
    return json(detail);
  });
}
