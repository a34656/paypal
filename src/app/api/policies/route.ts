import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { diffPolicies, policyConfigSchema } from "@/domain/policy/schema";
import { publishPolicy } from "@/server/policies";
import { RATE_LIMITS } from "@/server/ratelimit";

export const GET = apiRoute(async ({ user, db }) => {
  const rows = await db.policy.findMany({ where: { ownerId: user.id }, orderBy: { version: "desc" }, take: 50 });
  const versions = rows.map((r, i) => {
    const prev = rows[i + 1];
    const cfg = policyConfigSchema.parse(r.configuration);
    return {
      id: r.id,
      version: r.version,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      configuration: cfg,
      changes: prev ? diffPolicies(policyConfigSchema.parse(prev.configuration), cfg) : [],
    };
  });
  return { current: versions[0], versions };
});

/** PUT inserts a NEW immutable version. Human route only; no agent or LLM can reach it. */
export const PUT = apiRoute(
  async ({ req, user, db }) => {
    const body = await readJson(req, z.object({ expectedVersion: z.number().int().min(1), configuration: z.unknown() }));
    const { row, changes } = await publishPolicy(db, user, body.configuration, body.expectedVersion);
    return { version: row.version, changes };
  },
  { rateLimit: RATE_LIMITS.policy },
);
