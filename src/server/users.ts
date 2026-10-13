import "server-only";
import type { User } from "@/generated/prisma/client";
import { DEFAULT_POLICY } from "@/domain/policy/schema";
import { currentMode } from "@/lib/env";
import { appendAudit } from "./audit";
import type { Db } from "./db";

/** Maps a verified demo session id to its per-session demo User (created on first use). */
export async function getOrCreateDemoUser(db: Db, sid: string): Promise<User> {
  const existing = await db.user.findUnique({ where: { demoIdentity: sid } });
  if (existing) return existing;
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          demoIdentity: sid,
          displayName: `Operator ${sid.slice(0, 4).toUpperCase()}`,
          roles: ["REQUESTER", "APPROVER"],
        },
      });
      await tx.policy.create({
        data: { ownerId: user.id, version: 1, configuration: DEFAULT_POLICY, createdBy: "system:default-policy" },
      });
      await appendAudit(tx, {
        ownerId: user.id,
        actor: "system",
        eventType: "identity.demo_user_created",
        resource: `user:${user.id}`,
        outcome: "SUCCESS",
        metadata: { roles: user.roles, policyVersion: 1 },
        mode: currentMode(),
      });
      return user;
    });
  } catch (err) {
    // Two parallel first requests: the loser re-reads the winner's row.
    const again = await db.user.findUnique({ where: { demoIdentity: sid } });
    if (again) return again;
    throw err;
  }
}

export const hasRole = (user: Pick<User, "roles">, role: "REQUESTER" | "APPROVER") => user.roles.includes(role);
export const actorOf = (user: Pick<User, "id">) => `user:${user.id}`;
