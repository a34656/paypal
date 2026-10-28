import { apiRoute } from "@/server/api";
import { withdrawOverride } from "@/server/overrides";
import { RATE_LIMITS } from "@/server/ratelimit";

export const POST = apiRoute<{ overrideId: string }>(
  async ({ user, db, params, correlationId }) => withdrawOverride(db, user, params.overrideId, correlationId),
  { rateLimit: RATE_LIMITS.override },
);
