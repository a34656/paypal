import { apiRoute } from "@/server/api";
import { missionDetail } from "@/server/missions";
import { reconcileMissionPayments } from "@/server/payments";

export const GET = apiRoute<{ id: string }>(async ({ user, db, params }) => {
  await missionDetail(db, user, params.id); // ownership check before any reconciliation
  // Read-side reconciliation of stuck captures (never calls capture; records provider truth).
  await reconcileMissionPayments(db, params.id);
  return missionDetail(db, user, params.id);
});
