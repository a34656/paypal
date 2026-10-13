import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { prisma } from "@/server/db";
import { getPayPalGateway } from "@/server/paypal";
import { processWebhookEvent } from "@/server/webhooks";
import { consumeRateLimit, RATE_LIMITS } from "@/server/ratelimit";
import { AppError } from "@/server/errors";

/**
 * PayPal webhook. Server-to-server: no session/CSRF; authenticity comes from PayPal's
 * verify-webhook-signature API. The raw body is read with request.text() BEFORE parsing.
 */
export async function POST(req: NextRequest) {
  const env = getEnv();
  const gateway = getPayPalGateway();
  if (!gateway || !env.paypal.webhookId) {
    return NextResponse.json({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "Webhooks are not configured (PAYPAL_WEBHOOK_ID / credentials missing)." } }, { status: 503 });
  }
  try {
    await consumeRateLimit(prisma, RATE_LIMITS.webhook, "global");
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ ok: false }, { status: 429 });
    throw err;
  }
  const raw = await req.text();
  if (raw.length > 256 * 1024) return NextResponse.json({ ok: false }, { status: 413 });
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let verified = false;
  try {
    verified = await gateway.verifyWebhookSignature({ headers: req.headers, webhookId: env.paypal.webhookId, event });
  } catch {
    verified = false;
  }
  if (!verified) return NextResponse.json({ ok: false, error: { code: "FORBIDDEN", message: "Signature verification failed" } }, { status: 401 });
  const result = await processWebhookEvent(prisma, event, gateway);
  return NextResponse.json({ ok: true, data: result });
}
