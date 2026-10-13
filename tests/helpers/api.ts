import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { CSRF_HEADER, csrfTokenFor, SESSION_COOKIE, signSession } from "@/lib/session-crypto";

export const ORIGIN = "http://localhost:3000";

export interface Session {
  sid: string;
  cookie: string;
  csrf: string;
}

export async function newSession(): Promise<Session> {
  const sid = randomUUID();
  return { sid, cookie: `${SESSION_COOKIE}=${await signSession(sid)}`, csrf: await csrfTokenFor(sid) };
}

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export async function call(
  handler: unknown,
  opts: { method?: string; path?: string; body?: unknown; session?: Session | null; params?: Record<string, string>; headers?: Record<string, string>; csrf?: boolean },
) {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.session) headers.cookie = opts.session.cookie;
  if (method !== "GET") {
    headers.origin ??= ORIGIN;
    if (opts.session && opts.csrf !== false) headers[CSRF_HEADER] ??= opts.session.csrf;
    headers["content-type"] = "application/json";
  }
  const req = new NextRequest(`${ORIGIN}${opts.path ?? "/api/x"}`, {
    method,
    headers,
    body: opts.body === undefined || method === "GET" ? undefined : JSON.stringify(opts.body),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opts.params ?? {}) });
  const json = (await res.json()) as { ok: boolean; data?: any; error?: { code: string; message: string; details?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { status: res.status, ...json };
}
