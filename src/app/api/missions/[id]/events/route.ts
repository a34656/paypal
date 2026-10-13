import { apiRoute } from "@/server/api";
import { loadOwnedMission } from "@/server/missions";

/** Ordered, schema-versioned events for live view and read-only replay. GET only. */
export const GET = apiRoute<{ id: string }>(async ({ user, db, params }) => {
  const m = await loadOwnedMission(db, user, params.id);
  const events = await db.auditEvent.findMany({
    where: { missionId: params.id },
    orderBy: { seq: "asc" },
    take: 1000,
    select: { id: true, seq: true, actor: true, eventType: true, resource: true, outcome: true, metadata: true, schemaVersion: true, mode: true, createdAt: true, hash: true },
  });
  return { missionId: m.id, mode: m.mode, events };
});
