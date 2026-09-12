import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";

/**
 * Shared helpers for the /api/jargon routes.
 *
 * The selected text may be PII (a name, an A-Number, an address on a form), so
 * the audit log only ever stores a short hash of it — enough to correlate
 * repeated lookups, never enough to recover the text.
 */

/** sha256 of the whitespace-normalized, lower-cased text; first 12 hex chars. */
export function textHash(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/** Origin + pathname only (query strings and fragments can carry personal data). */
export function safePageRef(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) return undefined;
  try {
    const u = new URL(pageUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    return undefined;
  }
}

export function pageHost(pageUrl: string | undefined): string | undefined {
  if (!pageUrl) return undefined;
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return undefined;
  }
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** Parse and validate a JSON request body. Invalid JSON or schema mismatch → 400. */
export async function readJsonBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message }));
    return { ok: false, response: NextResponse.json({ error: "invalid_body", issues }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}
