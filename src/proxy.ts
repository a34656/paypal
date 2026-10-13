import { NextResponse, type NextRequest } from "next/server";
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  csrfTokenFor,
  signSession,
  verifySession,
} from "@/lib/session-crypto";

/**
 * Issues a signed, httpOnly, SameSite=Lax demo-session cookie to every visitor, plus a
 * readable CSRF token cookie bound to it. On the first request the new cookies are also
 * injected into the forwarded request so the handler sees the session immediately.
 */
export async function proxy(request: NextRequest) {
  const existing = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const csrfCookie = request.cookies.get(CSRF_COOKIE)?.value;
  if (existing) {
    const expected = await csrfTokenFor(existing);
    if (csrfCookie === expected) return NextResponse.next();
    const res = NextResponse.next();
    res.cookies.set(CSRF_COOKIE, expected, cookieOpts(false));
    return res;
  }

  // Webhooks are server-to-server; never mint sessions for them.
  if (request.nextUrl.pathname.startsWith("/api/paypal/webhook")) return NextResponse.next();

  const sid = crypto.randomUUID();
  const signed = await signSession(sid);
  const csrf = await csrfTokenFor(sid);

  const headers = new Headers(request.headers);
  const others = request.cookies
    .getAll()
    .filter((c) => c.name !== SESSION_COOKIE && c.name !== CSRF_COOKIE)
    .map((c) => `${c.name}=${c.value}`);
  headers.set("cookie", [...others, `${SESSION_COOKIE}=${signed}`, `${CSRF_COOKIE}=${csrf}`].join("; "));

  const res = NextResponse.next({ request: { headers } });
  res.cookies.set(SESSION_COOKIE, signed, cookieOpts(true));
  res.cookies.set(CSRF_COOKIE, csrf, cookieOpts(false));
  return res;
}

function cookieOpts(httpOnly: boolean) {
  return {
    httpOnly,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demo-products/|.*\\.(?:svg|png|jpg|webp|ico)$).*)"],
};
