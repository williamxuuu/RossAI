import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 "proxy" (formerly middleware). Mounts Auth0's /auth/* routes and
 * gates console pages. Public surfaces stay open:
 *   /api/webhooks/*  (channel provider callbacks)
 *   /api/jargon/*    (Chrome extension; anonymous clients)
 *   /api/copilotkit  (protected by the same session cookie via credentials: include)
 *   /dev/*           (demo simulator; only when AUTH_DISABLED)
 */
const PUBLIC_PREFIXES = ["/api/webhooks", "/api/jargon", "/api/health", "/_next", "/favicon.ico", "/auth"];

function authDisabled(): boolean {
  if (process.env.AUTH_DISABLED === "true") return true;
  return !process.env.AUTH0_DOMAIN || !process.env.AUTH0_CLIENT_ID || !process.env.AUTH0_CLIENT_SECRET;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/auth") && !authDisabled()) {
      const { getAuth0 } = await import("@/lib/auth");
      return getAuth0().middleware(request);
    }
    return NextResponse.next();
  }
  if (authDisabled()) return NextResponse.next();

  const { getAuth0 } = await import("@/lib/auth");
  const auth0 = getAuth0();
  const authRes = await auth0.middleware(request);
  const session = await auth0.getSession(request);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const login = new URL("/auth/login", request.url);
    login.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(login);
  }
  return authRes;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
