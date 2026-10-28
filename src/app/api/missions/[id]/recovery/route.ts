import { z } from "zod";
import { apiRoute } from "@/server/api";
import { getRecovery } from "@/server/recovery";
import { RATE_LIMITS } from "@/server/ratelimit";

const query = z.object({ margin: z.coerce.number().int().min(0).max(25).optional() });

/** Deterministic recovery analysis for a mission. Read-only. */
export const GET = apiRoute<{ id: string }>(
  async ({ req, user, db, params }) => {
    const q = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    return getRecovery(db, user, params.id, { marginPct: q.margin });
  },
  { rateLimit: RATE_LIMITS.recovery },
);
