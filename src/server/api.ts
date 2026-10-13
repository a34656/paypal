import "server-only";
/**
 * Route-handler wrapper: demo session → user, CSRF (origin + token) on state-changing
 * methods, DB-backed rate limits, Zod input parsing, consistent response envelope, and
 * error mapping that never leaks stacks or secrets.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { User } from "@/generated/prisma/client";
import { IllegalTransitionError } from "@/domain/state/machines";
import { CSRF_HEADER, SESSION_COOKIE, verifyCsrf, verifySession } from "@/lib/session-crypto";
import { scrubString } from "@/lib/redact";
import { getEnv } from "@/lib/env";
import { prisma, type Db } from "./db";
import { AppError } from "./errors";
import { consumeRateLimit, type RateLimitRule } from "./ratelimit";
import { getOrCreateDemoUser } from "./users";

export interface ApiContext<P> {
  req: NextRequest;
  user: User;
  params: P;
  correlationId: string;
  db: Db;
}

interface Options {
  /** Additional rate limit for this route (per user). */
  rateLimit?: RateLimitRule;
}

type Handler<P> = (ctx: ApiContext<P>) => Promise<unknown>;

const MAX_BODY_BYTES = 64 * 1024;

export async function readJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new AppError("VALIDATION", "Request body too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION", "Request body too large");
  let raw: unknown;
  try {
    raw = text.length ? JSON.parse(text) : {};
  } catch {
    throw new AppError("VALIDATION", "Body must be valid JSON");
  }
  return schema.parse(raw);
}

function allowedOrigins(req: NextRequest): string[] {
  const out = new Set<string>([req.nextUrl.origin]);
  const configured = getEnv().appOrigin;
  if (configured) out.add(configured.replace(/\/+$/, ""));
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
    out.add(`${proto}://${host}`);
  }
  return [...out];
}

async function checkCsrf(req: NextRequest, sid: string) {
  const origin = req.headers.get("origin");
  if (origin) {
    if (!allowedOrigins(req).includes(origin)) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
  } else if (req.headers.get("sec-fetch-site") && req.headers.get("sec-fetch-site") !== "same-origin") {
    throw new AppError("FORBIDDEN", "Cross-site request rejected");
  }
  if (!(await verifyCsrf(sid, req.headers.get(CSRF_HEADER)))) {
    throw new AppError("FORBIDDEN", "Missing or invalid CSRF token");
  }
}

export function errorResponse(err: unknown, correlationId: string): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json({ ok: false, error: { code: err.code, message: err.message, details: err.details ?? null }, correlationId }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION", message: "Invalid input", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, correlationId },
      { status: 400 },
    );
  }
  if (err instanceof IllegalTransitionError) {
    return NextResponse.json({ ok: false, error: { code: "CONFLICT", message: err.message, details: null }, correlationId }, { status: 409 });
  }
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
    return NextResponse.json({ ok: false, error: { code: "CONFLICT", message: "Conflicting concurrent operation", details: null }, correlationId }, { status: 409 });
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[aegis] internal error ${correlationId}: ${scrubString(msg)}`);
  return NextResponse.json({ ok: false, error: { code: "INTERNAL", message: "Internal error", details: null }, correlationId }, { status: 500 });
}

export function apiRoute<P = Record<string, never>>(handler: Handler<P>, options: Options = {}) {
  return async (req: NextRequest, routeCtx?: { params: Promise<P> }): Promise<NextResponse> => {
    const correlationId = randomUUID();
    try {
      const sid = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!sid) throw new AppError("UNAUTHENTICATED", "No valid demo session. Reload the page to receive one.");
      const method = req.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD") await checkCsrf(req, sid);
      const user = await getOrCreateDemoUser(prisma, sid);
      if (options.rateLimit) await consumeRateLimit(prisma, options.rateLimit, user.id);
      const params = (routeCtx ? await routeCtx.params : {}) as P;
      const data = await handler({ req, user, params, correlationId, db: prisma });
      if (data instanceof NextResponse || data instanceof Response) return data as NextResponse;
      return NextResponse.json({ ok: true, data, correlationId }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err, correlationId);
    }
  };
}
