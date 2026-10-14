import { prisma } from "@/server/db";
import { getOrCreateDemoUser } from "@/server/users";
import { createMission, confirmMission } from "@/server/missions";
import { executeMission } from "@/server/orchestrator";
import { approvePurchase } from "@/server/approvals";
import { DEMO_SCENARIOS } from "@/domain/providers/demo-catalog";
import { DeterministicAi } from "@/domain/ai/provider";
import { setAiOverrideForTests } from "@/server/ai/gemini";
import { newSession, type Session } from "./api";

setAiOverrideForTests(new DeterministicAi());

export const SCENARIO = {
  robotics: DEMO_SCENARIOS[0].text,
  cables: DEMO_SCENARIOS[1].text,
  gpu: DEMO_SCENARIOS[2].text,
};

export async function userFor(session?: Session) {
  const s = session ?? (await newSession());
  const user = await getOrCreateDemoUser(prisma, s.sid);
  return { session: s, user };
}

/** create → confirm (as parsed) → execute */
export async function runMission(text: string, session?: Session) {
  const { user, session: s } = await userFor(session);
  const m = await createMission(prisma, user, text, "test");
  await confirmMission(prisma, user, m.id, m.parsedProposal, "test");
  await executeMission(prisma, m.id);
  const mission = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } });
  return { user, session: s, mission };
}

export async function approvedMission(text: string = SCENARIO.robotics) {
  const r = await runMission(text);
  const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id, productId: r.mission.recommendedProductId! } });
  const approval = await approvePurchase(prisma, r.user, r.mission.id, { productId: mp.productId, expectedTotalMinor: mp.totalMinor! }, "test");
  return { ...r, approval, mp };
}
