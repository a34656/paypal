import { apiRoute } from "@/server/api";
import { getOverride } from "@/server/overrides";

export const GET = apiRoute<{ overrideId: string }>(async ({ user, db, params }) => getOverride(db, user, params.overrideId));
