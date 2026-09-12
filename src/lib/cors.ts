import { NextResponse, type NextRequest } from "next/server";
import { log } from "@/lib/log";

/**
 * CORS for the public, anonymous extension API (`/api/jargon/*`).
 *
 * Allowed origins:
 *   chrome-extension://<id>   any id by default; set EXTENSION_IDS="id1,id2" to pin
 *   http(s)://localhost:*     local dev (any port), also 127.0.0.1 and [::1]
 *   APP_BASE_URL              the console itself (the /jargon fallback page)
 *
 * `Access-Control-Allow-Origin` cannot be a pattern, so we echo the exact origin
 * back when it matches. No credentials are ever allowed: the extension sends only
 * the selected text and page URL, never cookies (spec §4 client anonymity).
 */

const logger = log.scope("cors");

const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/([a-p]{32})$/;
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

const ALLOW_METHODS = "GET, POST, OPTIONS";
const ALLOW_HEADERS = "Content-Type";
const MAX_AGE_SECONDS = "86400";

function pinnedExtensionIds(): Set<string> | null {
  const raw = process.env.EXTENSION_IDS;
  if (!raw || !raw.trim()) return null;
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

function appOrigin(): string | null {
  const base = process.env.APP_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
}

/** True when the Origin header value may receive an Access-Control-Allow-Origin echo. */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const ext = CHROME_EXTENSION_ORIGIN.exec(origin);
  if (ext) {
    const pinned = pinnedExtensionIds();
    return pinned === null || pinned.has(ext[1]);
  }
  if (LOCALHOST_ORIGIN.test(origin)) return true;
  return origin === appOrigin();
}

/** CORS response headers for a request from `origin`. Omits ACAO when the origin is not allowed. */
export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Max-Age": MAX_AGE_SECONDS,
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin as string;
  return headers;
}

function applyCors(res: Response, origin: string | null): Response {
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

/**
 * OPTIONS preflight handler. Next.js auto-implements OPTIONS only with an `Allow`
 * header, which is not a CORS preflight response, so routes export this explicitly.
 */
export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

type RouteHandler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response;

/**
 * Wrap a route handler so every response (including thrown `Response`s and
 * unexpected errors) carries CORS headers, and OPTIONS requests get a preflight reply.
 */
export function withCors<C = unknown>(handler: RouteHandler<C>): (req: NextRequest, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return preflight(req);
    try {
      return applyCors(await handler(req, ctx), origin);
    } catch (err) {
      if (err instanceof Response) return applyCors(err, origin);
      logger.error("unhandled route error", { path: new URL(req.url).pathname, err: String(err) });
      return applyCors(NextResponse.json({ error: "internal_error" }, { status: 500 }), origin);
    }
  };
}
