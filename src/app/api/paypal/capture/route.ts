import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { capturePayment } from "@/server/payments";
import { RATE_LIMITS } from "@/server/ratelimit";

/** Body is { paymentId } only. Never accepts an order id or amount from the client. */
export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { paymentId } = await readJson(req, z.object({ paymentId: z.string().min(1).max(40) }).strict());
    return capturePayment(db, user, paymentId, correlationId);
  },
  { rateLimit: RATE_LIMITS.capture },
);
