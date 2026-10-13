import { z } from "zod";
import { apiRoute } from "@/server/api";

const q = z.object({
  actor: z.string().max(80).optional(),
  eventType: z.string().max(80).optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "DENIED", "BLOCKED", "INFO"]).optional(),
  missionId: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(200).default(100),
  beforeSeq: z.coerce.number().int().optional(),
});

export const GET = apiRoute(async ({ req, user, db }) => {
  const p = q.parse(Object.fromEntries(req.nextUrl.searchParams));
  const events = await db.auditEvent.findMany({
    where: {
      ownerId: user.id,
      ...(p.actor ? { actor: { contains: p.actor } } : {}),
      ...(p.eventType ? { eventType: { startsWith: p.eventType } } : {}),
      ...(p.outcome ? { outcome: p.outcome } : {}),
      ...(p.missionId ? { missionId: p.missionId } : {}),
      ...(p.from || p.to ? { createdAt: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {}),
      ...(p.beforeSeq ? { seq: { lt: p.beforeSeq } } : {}),
    },
    orderBy: { seq: "desc" },
    take: p.take,
  });
  return { events, nextBeforeSeq: events.length === p.take ? events[events.length - 1].seq : null };
});
