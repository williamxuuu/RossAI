import { getQueue } from "@/lib/queries";
import { json, withParalegal } from "./_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cases → { cases: QueueCase[] } (only checklist-complete, scanned cases). */
export async function GET(): Promise<Response> {
  return withParalegal(async () => json({ cases: await getQueue() }));
}
