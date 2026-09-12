import "server-only";
import { Auth0Client } from "@auth0/nextjs-auth0/server";

/**
 * Paralegal authentication (spec §4: Auth0 protects paralegal accounts only;
 * clients never log in).
 *
 *   AUTH_DISABLED=true  → a fixed dev paralegal is returned everywhere (local demo)
 *   otherwise           → Auth0 session via @auth0/nextjs-auth0 v4
 *
 * `Paralegal.id` is the Auth0 `sub` and is what the audit log records.
 */
export type Paralegal = { id: string; name: string; email?: string };

export const DEV_PARALEGAL: Paralegal = { id: "dev|paralegal", name: "Dev Paralegal", email: "paralegal@clinic.local" };

export function isAuthDisabled(): boolean {
  if (process.env.AUTH_DISABLED === "true") return true;
  // If Auth0 isn't configured at all, fall back to the dev user rather than 500.
  return !process.env.AUTH0_DOMAIN || !process.env.AUTH0_CLIENT_ID || !process.env.AUTH0_CLIENT_SECRET;
}

let auth0: Auth0Client | null = null;
export function getAuth0(): Auth0Client {
  if (!auth0) {
    auth0 = new Auth0Client({
      domain: process.env.AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID,
      clientSecret: process.env.AUTH0_CLIENT_SECRET,
      secret: process.env.AUTH0_SECRET,
      appBaseUrl: process.env.APP_BASE_URL,
    });
  }
  return auth0;
}

/** Current paralegal or null. Never throws. */
export async function getParalegal(): Promise<Paralegal | null> {
  if (isAuthDisabled()) return DEV_PARALEGAL;
  try {
    const session = await getAuth0().getSession();
    if (!session?.user?.sub) return null;
    return { id: session.user.sub, name: session.user.name ?? session.user.email ?? "Paralegal", email: session.user.email };
  } catch {
    return null;
  }
}

/** For route handlers: returns the paralegal or throws a 401 Response. */
export async function requireParalegal(): Promise<Paralegal> {
  const p = await getParalegal();
  if (!p) throw new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  return p;
}
