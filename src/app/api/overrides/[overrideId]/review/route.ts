import { apiRoute, readJson } from "@/server/api";
import { reviewOverride, reviewOverrideSchema } from "@/server/overrides";
import { RATE_LIMITS } from "@/server/ratelimit";

/** Human policy-administrator review. Separation of duties is enforced server-side and in the DB. */
export const POST = apiRoute<{ overrideId: string }>(
  async ({ req, user, db, params, correlationId }) => {
    const input = await readJson(req, reviewOverrideSchema);
    return reviewOverride(db, user, params.overrideId, input, correlationId);
  },
  { rateLimit: RATE_LIMITS.override },
);
