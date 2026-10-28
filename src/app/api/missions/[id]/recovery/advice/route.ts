import { apiRoute } from "@/server/api";
import { recoveryAdvice } from "@/server/recovery";
import { consumeRateLimit, RATE_LIMITS } from "@/server/ratelimit";

/** Advisor guidance (LLM when configured, validated server-side; deterministic otherwise). Display only. */
export const POST = apiRoute<{ id: string }>(
  async ({ user, db, params, correlationId }) => {
    await consumeRateLimit(db, RATE_LIMITS.llm, user.id);
    return recoveryAdvice(db, user, params.id, correlationId);
  },
  { rateLimit: RATE_LIMITS.recovery },
);
