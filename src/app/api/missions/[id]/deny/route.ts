import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { denyMission } from "@/server/approvals";
import { RATE_LIMITS } from "@/server/ratelimit";

export const POST = apiRoute<{ id: string }>(
  async ({ req, user, db, params, correlationId }) => {
    const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(1).max(300).default("Denied by approver") }));
    const m = await denyMission(db, user, params.id, reason, correlationId);
    return { id: m.id, status: m.status };
  },
  { rateLimit: RATE_LIMITS.approve },
);
