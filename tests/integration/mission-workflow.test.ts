import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { executeMission, LEASE_MS, SimulatedCrash } from "@/server/orchestrator";
import { createMission, confirmMission } from "@/server/missions";
import { verifyAuditChain } from "@/server/audit";
import * as missionsRoute from "@/app/api/missions/route";
import * as confirmRoute from "@/app/api/missions/[id]/confirm/route";
import * as executeRoute from "@/app/api/missions/[id]/execute/route";
import * as eventsRoute from "@/app/api/missions/[id]/events/route";
import { call, newSession } from "../helpers/api";
import { runMission, SCENARIO, userFor } from "../helpers/fixtures";

describe("mission create → confirm → execute", () => {
  it("runs the robotics scenario end to end through the HTTP routes", async () => {
    const s = await newSession();
    const created = await call(missionsRoute.POST, { method: "POST", session: s, body: { text: SCENARIO.robotics } });
    expect(created.status).toBe(200);
    expect(created.data.status).toBe("PARSED");
    expect(created.data.parsedProposal).toMatchObject({ quantity: 20, budgetMinor: 250_000 });

    // Executing before confirmation is refused: raw text never reaches the engines.
    const early = await call(executeRoute.POST, { method: "POST", session: s, params: { id: created.data.id } });
    expect(early.status).toBe(422);

    const { uncertain: _u, ...constraints } = created.data.parsedProposal;
    void _u;
    const confirmed = await call(confirmRoute.POST, { method: "POST", session: s, params: { id: created.data.id }, body: { constraints } });
    expect(confirmed.data.status).toBe("CONFIRMED");

    const exec = await call(executeRoute.POST, { method: "POST", session: s, params: { id: created.data.id } });
    expect(exec.status).toBe(200);
    expect(exec.data).toMatchObject({ state: "COMPLETED_WORKFLOW", status: "AWAITING_APPROVAL" });

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: created.data.id } });
    const mps = await prisma.missionProduct.findMany({ where: { missionId: mission.id }, include: { product: true } });
    const by = (id: string) => mps.find((m) => m.product.providerProductId === id)!;
    expect(mission.recommendedProductId).toBe(by("demo-rpi-002").productId);
    expect(mission.decision).toBe("REQUIRE_APPROVAL");
    expect(by("demo-rpi-002").totalMinor).toBe(176_700);
    expect(by("demo-rpi-001").policyDecision).toBe("BLOCK"); // unknown shipping → unknown total
    expect(by("demo-rpi-003").policyDecision).toBe("BLOCK"); // over budget
    expect(by("demo-rpi-004").recommendationRank).toBeNull(); // wrong model
    expect(by("demo-rpi-005").policyDecision).toBe("BLOCK"); // prompt-injection listing
    expect(by("demo-rpi-001").riskScore!).toBeGreaterThan(by("demo-rpi-002").riskScore!);

    const events = await call(eventsRoute.GET, { session: s, params: { id: mission.id } });
    const types = events.data.events.map((e: { eventType: string }) => e.eventType);
    expect(types[0]).toBe("mission.created");
    expect(types).toContain("policy.evaluated");
    const seqs = events.data.events.map((e: { seq: number }) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("double execute is a no-op: no duplicated work, products or runs", async () => {
    const { mission } = await runMission(SCENARIO.robotics);
    const before = { runs: await prisma.agentRun.count(), mps: await prisma.missionProduct.count(), audit: await prisma.auditEvent.count() };
    const again = await executeMission(prisma, mission.id);
    expect(again).toEqual({ state: "NOOP", status: "AWAITING_APPROVAL" });
    expect(await prisma.agentRun.count()).toBe(before.runs);
    expect(await prisma.missionProduct.count()).toBe(before.mps);
    expect(await prisma.auditEvent.count()).toBe(before.audit);
    expect(await prisma.payment.count()).toBe(0); // the workflow never creates orders
  });

  it("concurrent execute calls do not duplicate steps", async () => {
    const { user } = await userFor();
    const m = await createMission(prisma, user, SCENARIO.cables, "t");
    await confirmMission(prisma, user, m.id, m.parsedProposal, "t");
    const results = await Promise.allSettled([executeMission(prisma, m.id), executeMission(prisma, m.id), executeMission(prisma, m.id)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    await executeMission(prisma, m.id);
    const runs = await prisma.agentRun.findMany({ where: { missionId: m.id } });
    expect(runs.map((r) => r.step).sort()).toEqual(["OPTIMIZE", "POLICY", "RISK", "SCOUT"]);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("READY_FOR_CHECKOUT");
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("resumes after an interruption (crash mid-step, lease expiry)", async () => {
    const { user } = await userFor();
    const m = await createMission(prisma, user, SCENARIO.robotics, "t");
    await confirmMission(prisma, user, m.id, m.parsedProposal, "t");
    await expect(executeMission(prisma, m.id, { crashAfterWork: "RISK" })).rejects.toBeInstanceOf(SimulatedCrash);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("RISK_ANALYSIS");

    // While the lease is held, a second call reports progress instead of duplicating work.
    expect(await executeMission(prisma, m.id)).toMatchObject({ state: "IN_PROGRESS" });

    const later = () => new Date(Date.now() + LEASE_MS + 1_000);
    const res = await executeMission(prisma, m.id, { now: later });
    expect(res).toEqual({ state: "COMPLETED_WORKFLOW", status: "AWAITING_APPROVAL" });
    const risk = await prisma.agentRun.findUniqueOrThrow({ where: { missionId_step: { missionId: m.id, step: "RISK" } } });
    expect(risk.attempt).toBe(2);
    expect(await prisma.missionProduct.count({ where: { missionId: m.id } })).toBe(5);
  });

  it("retries transient step failures with bounded attempts, then fails closed", async () => {
    const { user } = await userFor();
    const m1 = await createMission(prisma, user, SCENARIO.cables, "t");
    await confirmMission(prisma, user, m1.id, m1.parsedProposal, "t");
    expect(await executeMission(prisma, m1.id, { faults: { SCOUT: 1 }, sleep: async () => {} })).toMatchObject({ status: "READY_FOR_CHECKOUT" });

    const m2 = await createMission(prisma, user, SCENARIO.cables, "t");
    await confirmMission(prisma, user, m2.id, m2.parsedProposal, "t");
    expect(await executeMission(prisma, m2.id, { faults: { RISK: 99 }, sleep: async () => {} })).toEqual({ state: "FAILED", status: "FAILED" });
    const audit = await prisma.auditEvent.findMany({ where: { missionId: m2.id, eventType: { in: ["agent.step_retry", "agent.step_failed", "mission.failed"] } } });
    expect(audit.map((a) => a.eventType)).toEqual(["agent.step_retry", "agent.step_retry", "agent.step_failed", "mission.failed"]);
  });

  it("BLOCKs a mission whose budget exceeds the policy cap, regardless of the text", async () => {
    const { mission } = await runMission(SCENARIO.gpu);
    expect(mission.status).toBe("BLOCKED");
    expect(mission.decision).toBe("BLOCK");
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: mission.id } });
    const checks = (mp.policyResult as { checks: { id: string; result: string }[] }).checks;
    expect(checks.find((c) => c.id === "floor.mission_budget_cap")?.result).toBe("BLOCK");
  });

  it("small well-documented purchase reaches READY_FOR_CHECKOUT (still needs human authorisation)", async () => {
    const { mission } = await runMission(SCENARIO.cables);
    expect(mission.status).toBe("READY_FOR_CHECKOUT");
    expect(mission.decision).toBe("ALLOW_CHECKOUT");
    expect(await prisma.approval.count()).toBe(0);
  });
});
