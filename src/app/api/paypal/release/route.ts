import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { releaseHold } from "@/server/payments";
import { RATE_LIMITS } from "@/server/ratelimit";

/** Voids an authorization hold. Body: { paymentId, reason }. */
export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { paymentId, reason } = await readJson(req, z.object({ paymentId: z.string().min(1).max(40), reason: z.string().trim().min(3).max(300) }).strict());
    return releaseHold(db, user, paymentId, reason, correlationId);
  },
  { rateLimit: RATE_LIMITS.capture },
);
