import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { cancelPayment } from "@/server/payments";
import { RATE_LIMITS } from "@/server/ratelimit";

export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { paymentId } = await readJson(req, z.object({ paymentId: z.string().min(1).max(40) }).strict());
    return cancelPayment(db, user, paymentId, correlationId);
  },
  { rateLimit: RATE_LIMITS.order },
);
