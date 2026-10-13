import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { simulateBuyerApproval } from "@/server/payments";
import { RATE_LIMITS } from "@/server/ratelimit";

/** DEMO mode only: stand-in for the PayPal buyer popup. Refused for real PayPal payments. */
export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { paymentId } = await readJson(req, z.object({ paymentId: z.string().min(1).max(40) }).strict());
    return simulateBuyerApproval(db, user, paymentId, correlationId);
  },
  { rateLimit: RATE_LIMITS.order },
);
