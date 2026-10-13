import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { verifyAuditChain } from "@/server/audit";
import * as missionRoute from "@/app/api/missions/[id]/route";
import * as missionsRoute from "@/app/api/missions/route";
import * as denyRoute from "@/app/api/missions/[id]/deny/route";
import * as policiesRoute from "@/app/api/policies/route";
import * as ordersRoute from "@/app/api/paypal/orders/route";
import * as captureRoute from "@/app/api/paypal/capture/route";
import * as simRoute from "@/app/api/paypal/simulate-approval/route";
import * as approveRoute from "@/app/api/missions/[id]/approve/route";
import * as eventsRoute from "@/app/api/missions/[id]/events/route";
import * as auditRoute from "@/app/api/audit/route";
import { DEFAULT_POLICY } from "@/domain/policy/schema";
import { call, newSession } from "../helpers/api";
import { runMission, SCENARIO } from "../helpers/fixtures";

describe("identity, ownership, CSRF", () => {
  it("rejects requests without a valid signed session", async () => {
    const res = await call(missionsRoute.GET, { session: null });
    expect(res.status).toBe(401);
    const forged = await call(missionsRoute.GET, { session: null, headers: { cookie: "aegis_sid=123e4567-e89b-12d3-a456-426614174000.forged" } });
    expect(forged.status).toBe(401);
  });

  it("isolates visitors: another session sees 404, not the mission", async () => {
    const { mission } = await runMission(SCENARIO.robotics);
    const other = await newSession();
    for (const h of [missionRoute.GET, eventsRoute.GET]) {
      expect((await call(h, { session: other, params: { id: mission.id } })).status).toBe(404);
    }
    expect((await call(denyRoute.POST, { method: "POST", session: other, params: { id: mission.id }, body: { reason: "x" } })).status).toBe(404);
    expect((await call(ordersRoute.POST, { method: "POST", session: other, body: { missionId: mission.id } })).status).toBe(404);
    const list = await call(missionsRoute.GET, { session: other });
    expect(list.data.items).toEqual([]);
    const audit = await call(auditRoute.GET, { session: other });
    expect(audit.data.events.every((e: { missionId: string | null }) => e.missionId !== mission.id)).toBe(true);
  });

  it("rejects state changes without the CSRF token or from another origin", async () => {
    const s = await newSession();
    expect((await call(missionsRoute.POST, { method: "POST", session: s, body: { text: SCENARIO.cables }, csrf: false })).status).toBe(403);
    expect((await call(missionsRoute.POST, { method: "POST", session: s, body: { text: SCENARIO.cables }, headers: { origin: "https://evil.example" } })).status).toBe(403);
    const other = await newSession();
    expect((await call(missionsRoute.POST, { method: "POST", session: s, body: { text: SCENARIO.cables }, headers: { "x-aegis-csrf": other.csrf } })).status).toBe(403);
    expect(await prisma.mission.count()).toBe(0);
  });

  it("errors never leak stacks", async () => {
    const s = await newSession();
    const res = await call(missionsRoute.POST, { method: "POST", session: s, body: { text: 42 } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("rate-limits mission creation (DB-backed)", async () => {
    const s = await newSession();
    let last = 0;
    for (let i = 0; i < 16; i++) last = (await call(missionsRoute.POST, { method: "POST", session: s, body: { text: SCENARIO.cables } })).status;
    expect(last).toBe(429); // LLM-route budget is 15 / 10 min
  });
});

describe("policies are versioned and append-only", () => {
  it("PUT inserts a new version, audits before/after and flags loosening", async () => {
    const s = await newSession();
    const g = await call(policiesRoute.GET, { session: s });
    expect(g.data.current.version).toBe(1);
    const put = await call(policiesRoute.PUT, { method: "PUT", session: s, body: { expectedVersion: 1, configuration: { ...DEFAULT_POLICY, approvalThresholdMinor: 200_000 } } });
    expect(put.status).toBe(200);
    expect(put.data.version).toBe(2);
    expect(put.data.changes[0]).toMatchObject({ field: "approvalThresholdMinor", loosens: true });
    const stale = await call(policiesRoute.PUT, { method: "PUT", session: s, body: { expectedVersion: 1, configuration: DEFAULT_POLICY } });
    expect(stale.status).toBe(409);
    const invalid = await call(policiesRoute.PUT, { method: "PUT", session: s, body: { expectedVersion: 2, configuration: { ...DEFAULT_POLICY, maxPurchaseMinor: -5 } } });
    expect(invalid.status).toBe(400);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "policy.version_published" } });
    expect(ev.metadata).toMatchObject({ policyVersion: 2, previousVersion: 1, loosens: true });
    expect(await prisma.policy.count()).toBe(2);
  });

  it("DB rejects UPDATE/DELETE on Policy and AuditEvent", async () => {
    await runMission(SCENARIO.cables);
    await expect(prisma.policy.updateMany({ data: { createdBy: "agent" } })).rejects.toThrow(/append-only/);
    await expect(prisma.policy.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.updateMany({ data: { outcome: "SUCCESS" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("hash chain detects tampering even if the trigger were bypassed", async () => {
    await runMission(SCENARIO.cables);
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditEvent" DISABLE TRIGGER "AuditEvent_append_only"`);
    try {
      const victim = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "policy.evaluated" } });
      await prisma.auditEvent.update({ where: { id: victim.id }, data: { outcome: "SUCCESS", metadata: { decision: "ALLOW_CHECKOUT", forged: true } } });
      const v = await verifyAuditChain(prisma);
      expect(v.ok).toBe(false);
      expect(v.brokenAtSeq).toBe(victim.seq);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "AuditEvent" ENABLE TRIGGER "AuditEvent_append_only"`);
    }
  });

  it("audit metadata is redacted by allowlist", async () => {
    const { mission } = await runMission(SCENARIO.robotics);
    const evs = await prisma.auditEvent.findMany({ where: { missionId: mission.id } });
    const text = JSON.stringify(evs.map((e) => e.metadata));
    expect(text).not.toMatch(/IMPORTANT INSTRUCTIONS/); // untrusted listing text is not copied into audit
    expect(text).not.toMatch(/SESSION_SECRET|test-session-secret/);
  });
});

describe("DEMO mode (no PayPal credentials): simulated, clearly labelled", () => {
  it("runs the full flow with the simulator and labels everything simulated", async () => {
    const r = await runMission(SCENARIO.robotics);
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id, productId: r.mission.recommendedProductId! } });
    await call(approveRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { productId: mp.productId, expectedTotalMinor: mp.totalMinor, acknowledge: true } });
    const order = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } });
    expect(order.data).toMatchObject({ provider: "simulated", mode: "DEMO", status: "CHECKOUT_PENDING" });
    expect((await call(captureRoute.POST, { method: "POST", session: r.session, body: { paymentId: order.data.paymentId } })).status).toBe(422);
    const sim = await call(simRoute.POST, { method: "POST", session: r.session, body: { paymentId: order.data.paymentId } });
    expect(sim.data).toMatchObject({ simulated: true, orderStatus: "APPROVED" });
    const cap = await call(captureRoute.POST, { method: "POST", session: r.session, body: { paymentId: order.data.paymentId } });
    expect(cap.data).toMatchObject({ status: "CAPTURED", simulated: true, mode: "DEMO" });
    expect(cap.data.message).toMatch(/SIMULATED.*No money moved/);
    const evs = await prisma.auditEvent.findMany({ where: { missionId: r.mission.id, eventType: "payment.captured" } });
    expect(evs[0].mode).toBe("DEMO");
    expect((evs[0].metadata as { simulated: boolean }).simulated).toBe(true);
  });

  it("denial revokes approvals and ends the mission", async () => {
    const r = await runMission(SCENARIO.robotics);
    const res = await call(denyRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { reason: "Not this quarter" } });
    expect(res.data.status).toBe("DENIED");
    expect((await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } })).status).toBe(409);
  });
});
