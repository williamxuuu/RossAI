import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireParalegal, type Paralegal } from "@/lib/auth";
import { ConsoleActionError } from "@/lib/console-actions";
import { log } from "@/lib/log";

/**
 * Shared plumbing for the console route handlers: paralegal session check,
 * JSON body parsing, and error → HTTP status mapping. Keeps each route.ts thin.
 */

const logger = log.scope("api:cases");

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/** Run a handler with the current paralegal; 401 when there is no session. */
export async function withParalegal(fn: (paralegal: Paralegal) => Promise<Response>): Promise<Response> {
  let paralegal: Paralegal;
  try {
    paralegal = await requireParalegal();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  try {
    return await fn(paralegal);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Parse a JSON body (an empty body becomes {}), throwing a 400-mapped error on bad JSON. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConsoleActionError(400, "invalid JSON body");
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ConsoleActionError) return json({ error: err.message }, err.status);
  if (err instanceof ZodError) {
    return json({ error: "invalid request body", issues: err.issues.map((i) => ({ path: i.path, message: i.message })) }, 400);
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error("unhandled", { error: message });
  return json({ error: "internal error" }, 500);
}
