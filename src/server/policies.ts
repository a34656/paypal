import "server-only";
import type { Policy } from "@/generated/prisma/client";
import { DEFAULT_POLICY, diffPolicies, policyConfigSchema, type PolicyConfig } from "@/domain/policy/schema";
import { currentMode } from "@/lib/env";
import { appendAudit } from "./audit";
import type { Db, Tx } from "./db";
import { AppError } from "./errors";
import { actorOf } from "./users";

export async function latestPolicy(db: Db | Tx, ownerId: string): Promise<{ row: Policy; config: PolicyConfig }> {
  const row = await db.policy.findFirst({ where: { ownerId }, orderBy: { version: "desc" } });
  if (!row) throw new AppError("PRECONDITION_FAILED", "No policy found for this user");
  const parsed = policyConfigSchema.safeParse(row.configuration);
  // Fail closed: an unparseable stored policy is an error, never "no limits".
  if (!parsed.success) throw new AppError("INTERNAL", "Stored policy is invalid");
  return { row, config: parsed.data };
}

export async function policyByVersion(db: Db | Tx, ownerId: string, version: number): Promise<PolicyConfig> {
  const row = await db.policy.findUnique({ where: { ownerId_version: { ownerId, version } } });
  if (!row) throw new AppError("NOT_FOUND", `Policy version ${version} not found`);
  return policyConfigSchema.parse(row.configuration);
}

/** Policies are append-only: a change inserts version N+1. Only callable from a human route. */
export async function publishPolicy(db: Db, user: { id: string }, config: unknown, expectedVersion: number) {
  const next = policyConfigSchema.parse(config);
  return db.$transaction(async (tx) => {
    const current = await latestPolicy(tx, user.id);
    if (current.row.version !== expectedVersion) {
      throw new AppError("CONFLICT", `Policy changed since you loaded it (now v${current.row.version}). Reload and retry.`);
    }
    const changes = diffPolicies(current.config, next);
    if (changes.length === 0) throw new AppError("VALIDATION", "No changes to publish");
    const row = await tx.policy.create({
      data: { ownerId: user.id, version: current.row.version + 1, configuration: next, createdBy: actorOf(user) },
    });
    await appendAudit(tx, {
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "policy.version_published",
      resource: `policy:${row.id}`,
      outcome: "SUCCESS",
      metadata: {
        policyVersion: row.version,
        previousVersion: current.row.version,
        loosens: changes.some((c) => c.loosens),
        changes: changes.map((c) => ({ field: c.field, before: c.before, after: c.after, loosens: c.loosens })),
      },
      mode: currentMode(),
    });
    return { row, changes };
  });
}

export { DEFAULT_POLICY };
