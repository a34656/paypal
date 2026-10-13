import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { createMissionInputSchema } from "@/domain/types";
import { createMission, listMissions } from "@/server/missions";
import { consumeRateLimit, RATE_LIMITS } from "@/server/ratelimit";

const listQuery = z.object({
  status: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(40).optional(),
});

export const GET = apiRoute(async ({ req, user, db }) => {
  const q = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return listMissions(db, user, q);
});

export const POST = apiRoute(
  async ({ req, user, db, correlationId }) => {
    const { text } = await readJson(req, createMissionInputSchema);
    // Parsing may call the LLM: separate (stricter) budget for LLM-calling routes.
    await consumeRateLimit(db, RATE_LIMITS.llm, user.id);
    return createMission(db, user, text, correlationId);
  },
  { rateLimit: RATE_LIMITS.missionCreate },
);
