import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { previewRevision } from "@/server/recovery";
import { RATE_LIMITS } from "@/server/ratelimit";

/** What-if projection of a proposed revision. Writes nothing. */
export const POST = apiRoute<{ id: string }>(
  async ({ req, user, db, params }) => {
    const { changes } = await readJson(req, z.object({ changes: z.unknown() }).strict());
    return previewRevision(db, user, params.id, changes);
  },
  { rateLimit: RATE_LIMITS.recovery },
);
