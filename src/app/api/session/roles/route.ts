import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { appendAudit } from "@/server/audit";
import { actorOf } from "@/server/users";
import { currentMode } from "@/lib/env";

/** Demo control: toggle the APPROVER role to demonstrate role-gated approval. REQUESTER is always held. */
export const POST = apiRoute(async ({ req, user, db, correlationId }) => {
  const { approver } = await readJson(req, z.object({ approver: z.boolean() }).strict());
  const roles = approver ? (["REQUESTER", "APPROVER"] as const) : (["REQUESTER"] as const);
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id: user.id }, data: { roles: [...roles] } });
    await appendAudit(tx, { ownerId: user.id, actor: actorOf(user), eventType: "identity.roles_changed", resource: `user:${user.id}`, outcome: "SUCCESS", correlationId, metadata: { before: user.roles, after: u.roles }, mode: currentMode() });
    return u;
  });
  return { roles: updated.roles };
});
