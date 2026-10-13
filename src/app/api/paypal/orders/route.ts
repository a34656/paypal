import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { createOrderForMission } from "@/server/payments";
import { RATE_LIMITS } from "@/server/ratelimit";

/** Body is { missionId } only. Amounts are recomputed from stored data on the server. */
export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { missionId } = await readJson(req, z.object({ missionId: z.string().min(1).max(40) }).strict());
    return createOrderForMission(db, user, missionId, correlationId);
  },
  { rateLimit: RATE_LIMITS.order },
);
