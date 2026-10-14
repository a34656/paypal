import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { loadOwnedPayment, settlePayment } from "@/server/payments";
import { precondition } from "@/server/errors";
import { RATE_LIMITS } from "@/server/ratelimit";
import { parseMajorInput } from "@/lib/money";

/**
 * Settles an authorization hold. Body: { paymentId, finalAmount } where finalAmount is the
 * seller's real invoice total as a decimal string. The server bounds it by the stored cap.
 */
export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { paymentId, finalAmount } = await readJson(req, z.object({ paymentId: z.string().min(1).max(40), finalAmount: z.string().trim().min(1).max(20) }).strict());
    const payment = await loadOwnedPayment(db, user, paymentId);
    let minor: number;
    try {
      minor = parseMajorInput(finalAmount, payment.currency);
    } catch {
      throw precondition(`Invalid ${payment.currency} amount.`);
    }
    return settlePayment(db, user, paymentId, minor, correlationId);
  },
  { rateLimit: RATE_LIMITS.capture },
);
