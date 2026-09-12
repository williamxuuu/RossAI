import { NextResponse } from "next/server";
import { listFixtures } from "@/lib/dev";
import { devGuard } from "../_lib/guard";

/** GET /api/dev/fixtures → the demo documents the simulator can attach to an email. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return devGuard() ?? NextResponse.json({ fixtures: await listFixtures() });
}
