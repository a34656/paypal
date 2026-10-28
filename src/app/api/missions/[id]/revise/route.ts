import { apiRoute, readJson } from "@/server/api";
import { executeMission } from "@/server/orchestrator";
import { reviseInputSchema, reviseMission } from "@/server/recovery";
import { RATE_LIMITS } from "@/server/ratelimit";

/**
 * Explicitly confirmed revision → NEW linked mission, then the bounded workflow re-runs every
 * check under the current policy. Never creates orders; the original mission is not modified.
 */
export const POST = apiRoute<{ id: string }>(
  async ({ req, user, db, params, correlationId }) => {
    const input = await readJson(req, reviseInputSchema);
    const { mission, reused } = await reviseMission(db, user, params.id, input, correlationId);
    const execution = mission.status === "CONFIRMED" ? await executeMission(db, mission.id) : { state: "NOOP" as const, status: mission.status };
    return { missionId: mission.id, revisionNumber: mission.revisionNumber, reused, execution };
  },
  { rateLimit: RATE_LIMITS.revise },
);
