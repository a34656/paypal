import { NextResponse } from "next/server";
import { apiRoute } from "@/server/api";
import { loadOwnedMission } from "@/server/missions";
import { executeMission } from "@/server/orchestrator";
import { RATE_LIMITS } from "@/server/ratelimit";

/** Idempotent and resumable: safe to call twice or after an interrupted run. Never creates orders. */
export const POST = apiRoute<{ id: string }>(
  async ({ user, db, params, correlationId }) => {
    await loadOwnedMission(db, user, params.id);
    const result = await executeMission(db, params.id);
    return NextResponse.json({ ok: true, data: result, correlationId }, { status: result.state === "IN_PROGRESS" ? 202 : 200 });
  },
  { rateLimit: RATE_LIMITS.execute },
);
