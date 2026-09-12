import { NextResponse } from "next/server";
import { devEnabled } from "@/lib/dev";

/** 404 (not 403) when the dev surface is off: an endpoint that is not there is not there. */
export function devGuard(): NextResponse | null {
  return devEnabled() ? null : NextResponse.json({ error: "not_found" }, { status: 404 });
}
