import { z } from "zod";
import { apiRoute, readJson } from "@/server/api";
import { confirmMission } from "@/server/missions";

export const POST = apiRoute<{ id: string }>(async ({ req, user, db, params, correlationId }) => {
  const body = await readJson(req, z.object({ constraints: z.unknown() }));
  return confirmMission(db, user, params.id, body.constraints, correlationId);
});
