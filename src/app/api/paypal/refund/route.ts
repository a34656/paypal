import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { loadOwnedPayment, refundPayment } from "@/server/payments";
import { precondition } from "@/server/errors";
import { RATE_LIMITS } from "@/server/ratelimit";
import { parseMajorInput } from "@/lib/money";

/** Refunds a captured payment. Body: { paymentId, reason, amount? } — omit amount for the full remainder. */
export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const body = await readJson(req, z.object({ paymentId: z.string().min(1).max(40), reason: z.string().trim().min(3).max(300), amount: z.string().trim().min(1).max(20).optional() }).strict());
    const payment = await loadOwnedPayment(db, user, body.paymentId);
    let amountMinor: number | null = null;
    if (body.amount) {
      try {
        amountMinor = parseMajorInput(body.amount, payment.currency);
      } catch {
        throw precondition(`Invalid ${payment.currency} amount.`);
      }
    }
    return refundPayment(db, user, body.paymentId, { amountMinor, reason: body.reason }, correlationId);
  },
  { rateLimit: RATE_LIMITS.capture },
);
