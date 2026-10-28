import "server-only";
/** DB-backed fixed-window rate limiting (works on serverless; in-memory limits do not). */
import { AppError } from "./errors";
import type { Db } from "./db";

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  missionCreate: { name: "mission-create", limit: 20, windowSeconds: 600 },
  execute: { name: "execute", limit: 30, windowSeconds: 600 },
  approve: { name: "approve", limit: 30, windowSeconds: 600 },
  order: { name: "paypal-order", limit: 20, windowSeconds: 600 },
  capture: { name: "paypal-capture", limit: 20, windowSeconds: 600 },
  policy: { name: "policy-write", limit: 30, windowSeconds: 600 },
  llm: { name: "llm", limit: 15, windowSeconds: 600 },
  webhook: { name: "paypal-webhook", limit: 300, windowSeconds: 60 },
  recovery: { name: "recovery", limit: 120, windowSeconds: 600 },
  revise: { name: "mission-revise", limit: 20, windowSeconds: 600 },
  alternatives: { name: "recovery-alternatives", limit: 20, windowSeconds: 600 },
  override: { name: "policy-override", limit: 20, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

export async function consumeRateLimit(db: Db, rule: RateLimitRule, subject: string, now = new Date()): Promise<void> {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const key = `${rule.name}:${subject}`;
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count")
    VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  if (count > rule.limit) {
    throw new AppError("RATE_LIMITED", `Rate limit exceeded for ${rule.name}. Try again later.`, {
      retryAfterSeconds: Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
    });
  }
  // Opportunistic cleanup of stale windows (cheap, bounded).
  if (count === 1 && now.getSeconds() % 10 === 0) {
    await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - 86_400_000) } } });
  }
}
