import { apiRoute, readJson } from "@/server/api";
import { loadOwnedMission } from "@/server/missions";
import { createOverrideRequest, createOverrideSchema } from "@/server/overrides";
import { overrideView } from "@/server/recovery";
import { RATE_LIMITS } from "@/server/ratelimit";

export const GET = apiRoute<{ id: string }>(async ({ user, db, params }) => {
  await loadOwnedMission(db, user, params.id);
  const rows = await db.policyOverrideRequest.findMany({ where: { missionId: params.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return { items: rows.map(overrideView) };
});

/** Files a request for review. Not an authorization: nothing about checkout changes. */
export const POST = apiRoute<{ id: string }>(
  async ({ req, user, db, params, correlationId }) => {
    const input = await readJson(req, createOverrideSchema);
    return createOverrideRequest(db, user, params.id, input, correlationId);
  },
  { rateLimit: RATE_LIMITS.override },
);
