import { apiRoute } from "@/server/api";
import { searchAlternatives } from "@/server/recovery";
import { RATE_LIMITS } from "@/server/ratelimit";

/** Re-searches the product provider and projects each result. Nothing is persisted or purchasable. */
export const POST = apiRoute<{ id: string }>(
  async ({ user, db, params, correlationId }) => searchAlternatives(db, user, params.id, correlationId),
  { rateLimit: RATE_LIMITS.alternatives },
);
