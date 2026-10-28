import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { approvePurchase } from "@/server/approvals";
import { executeMission } from "@/server/orchestrator";
import { capturePayment, createOrderForMission } from "@/server/payments";
import { setGatewayOverrideForTests } from "@/server/paypal";
import { latestPolicy, publishPolicy } from "@/server/policies";
import { diffConstraints, getRecovery, recoveryAdvice, reviseMission, searchAlternatives } from "@/server/recovery";
import { createOverrideRequest, getOverride, reviewOverride, withdrawOverride } from "@/server/overrides";
import { confirmedConstraints } from "@/server/missions";
import { verifyAuditChain } from "@/server/audit";
import { resetEnvCache } from "@/lib/env";
import { DeterministicAi, type AiProvider } from "@/domain/ai/provider";
import { deterministicAdvice } from "@/domain/recovery/advice";
import type { RecoveryAnalysis } from "@/domain/recovery/analysis";
import * as recoveryRoute from "@/app/api/missions/[id]/recovery/route";
import * as reviseRoute from "@/app/api/missions/[id]/revise/route";
import * as overridesRoute from "@/app/api/missions/[id]/overrides/route";
import * as reviewRoute from "@/app/api/overrides/[overrideId]/review/route";
import * as previewRoute from "@/app/api/missions/[id]/recovery/preview/route";
import { call, newSession } from "../helpers/api";
import { MockPayPal } from "../helpers/mock-paypal";
import { runMission, userFor } from "../helpers/fixtures";

/** Demo catalogue: cheapest compliant offer is demo-usbc-001 at $364.00 for 50 units → over a $100 budget. */
const BLOCKED_CABLES = "Buy 50 USB-C cables, 1m, 60W, for the hardware bench. Budget $100, needed within 10 days.";

async function blocked() {
  const r = await runMission(BLOCKED_CABLES);
  expect(r.mission.status).toBe("BLOCKED");
  return r;
}

async function revise(r: Awaited<ReturnType<typeof blocked>>, changes: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const m = await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } });
  return reviseMission(prisma, r.user, m.id, { changes, expectedVersion: m.version, confirm: true, acknowledgeRelaxedRequirements: false, refreshQuotes: false, ...extra } as never, "t");
}

let pp: MockPayPal;
beforeEach(() => {
  pp = new MockPayPal();
  setGatewayOverrideForTests(pp);
});
afterEach(() => {
  setGatewayOverrideForTests(null);
  delete process.env.AEGIS_POLICY_ADMIN_IDS;
  resetEnvCache();
});

describe("recovery diagnosis", () => {
  it("diagnoses the blocked mission from the stored evaluation, with exact amounts and options", async () => {
    const r = await blocked();
    const { analysis: a, canRevise } = await getRecovery(prisma, r.user, r.mission.id);
    expect(canRevise).toBe(true);
    expect(a.summary).toMatchObject({ budgetMinor: 10_000, quantity: 50, decision: "BLOCK", anyDemoData: true });
    const cheapestExact = a.offers.find((o) => o.title.startsWith("USB-C to USB-C cable, 1 m"))!;
    expect(cheapestExact).toMatchObject({ totalMinor: 36_400, totalBasis: "EXACT", shippingMinor: 1_200, taxMinor: 2_700, budgetOnly: true });
    expect(cheapestExact.blocking.map((b) => b.checkId)).toEqual(["budget.mission"]);
    expect(cheapestExact.blocking[0]).toMatchObject({ actual: "$364.00", permitted: "≤ $100.00", difference: "$264.00 over", differenceMinor: 26_400 });
    expect(a.budget.unlock).toMatchObject({ minBudgetMinor: 36_400, increaseMinor: 26_400, projectedDecision: "ALLOW_CHECKOUT" });
    expect(a.quantity.candidates[0]).toMatchObject({ quantity: 9, totalMinor: 9_750 });
    expect(a.recommendations[0].resolves).toBe(true);
  });

  it("is owner-scoped over HTTP and needs no LLM", async () => {
    const r = await blocked();
    const mine = await call(recoveryRoute.GET, { session: r.session, params: { id: r.mission.id } });
    expect(mine.status).toBe(200);
    expect(mine.data.analysis.summary.shortfallMinor).toBeGreaterThan(0);
    const other = await call(recoveryRoute.GET, { session: await newSession(), params: { id: r.mission.id } });
    expect(other.status).toBe(404);
  });

  it("previews a revision without writing anything", async () => {
    const r = await blocked();
    const before = await prisma.mission.count();
    const p = await call(previewRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { changes: { budgetMinor: 36_400 } } });
    expect(p.status).toBe(200);
    expect(p.data.diff).toEqual([expect.objectContaining({ field: "budgetMinor", display: { before: "$100.00", after: "$364.00" } })]);
    expect(p.data.projection.best.totalMinor).toBe(36_400);
    expect(await prisma.mission.count()).toBe(before);
  });
});

describe("mission revision", () => {
  it("creates a linked revision, leaves the original untouched, audits every changed field, and re-runs the policy", async () => {
    const r = await blocked();
    const original = await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } });
    const { mission: rev } = await revise(r, { budgetMinor: 36_400 });
    expect(rev).toMatchObject({ revisedFromId: original.id, revisionNumber: 1, status: "CONFIRMED", budgetMinor: 36_400, parserSource: "revision" });

    const after = await prisma.mission.findUniqueOrThrow({ where: { id: original.id } });
    expect(after.status).toBe("BLOCKED");
    expect(after.version).toBe(original.version);
    expect(after.confirmedConstraints).toEqual(original.confirmedConstraints);

    const revisedEvent = await prisma.auditEvent.findFirstOrThrow({ where: { missionId: original.id, eventType: "mission.revised" } });
    expect(revisedEvent.metadata).toMatchObject({ revisionId: rev.id, missionVersion: original.version, changes: [{ field: "budgetMinor", before: 10_000, after: 36_400, relaxesMandatory: false }] });
    const newEvents = await prisma.auditEvent.findMany({ where: { missionId: rev.id }, orderBy: { seq: "asc" } });
    expect(newEvents.map((e) => e.eventType)).toEqual(["mission.created", "mission.parsed", "mission.confirmed"]);

    await executeMission(prisma, rev.id);
    const ran = await prisma.mission.findUniqueOrThrow({ where: { id: rev.id } });
    expect(ran.status).toBe("READY_FOR_CHECKOUT");
    expect(ran.decision).toBe("ALLOW_CHECKOUT");
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("the revise route creates and evaluates the revision in one confirmed request", async () => {
    const r = await blocked();
    const res = await call(reviseRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { changes: { budgetMinor: 36_400 }, expectedVersion: r.mission.version, confirm: true } });
    expect(res.status).toBe(200);
    expect(res.data.execution).toMatchObject({ state: "COMPLETED_WORKFLOW", status: "READY_FOR_CHECKOUT" });
    const noConfirm = await call(reviseRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { changes: { budgetMinor: 30_000 }, expectedVersion: r.mission.version } });
    expect(noConfirm.status).toBe(400);
    const noCsrf = await call(reviseRoute.POST, { method: "POST", session: r.session, csrf: false, params: { id: r.mission.id }, body: { changes: { budgetMinor: 30_000 }, expectedVersion: r.mission.version, confirm: true } });
    expect(noCsrf.status).toBe(403);
    const foreign = await call(reviseRoute.POST, { method: "POST", session: await newSession(), params: { id: r.mission.id }, body: { changes: { budgetMinor: 30_000 }, expectedVersion: r.mission.version, confirm: true } });
    expect(foreign.status).toBe(404);
  });

  it("validates revisions on the server", async () => {
    const r = await blocked();
    await expect(revise(r, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(revise(r, { budgetMinor: 36_400 }, { expectedVersion: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(revise(r, { budgetMinor: 2_000_000 })).rejects.toMatchObject({ code: "VALIDATION" }); // above the $10,000 policy cap
    await expect(revise(r, { currency: "EUR" } as never)).rejects.toBeTruthy(); // not an editable field
    await expect(revise(r, { requiredAttributes: { length: "1m" } })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); // relaxes "power"
    const ok = await revise(r, { requiredAttributes: { length: "1m" }, budgetMinor: 36_400 }, { acknowledgeRelaxedRequirements: true });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { missionId: r.mission.id, eventType: "mission.revised" } });
    expect(ev.metadata).toMatchObject({ relaxesMandatory: ["requiredAttributes.power"], acknowledgedRelaxations: true });
    // Double submit of the same revision is idempotent.
    const again = await revise(r, { requiredAttributes: { length: "1m" }, budgetMinor: 36_400 }, { acknowledgeRelaxedRequirements: true });
    expect(again).toMatchObject({ reused: true, mission: { id: ok.mission.id } });
  });

  it("only finished, unpurchased missions can be revised", async () => {
    const ok = await runMission("Buy 50 USB-C cables, 1m, 60W, for the hardware bench. Budget $400, needed within 10 days.");
    expect(ok.mission.status).toBe("READY_FOR_CHECKOUT");
    await expect(reviseMission(prisma, ok.user, ok.mission.id, { changes: { budgetMinor: 50_000 }, expectedVersion: ok.mission.version, confirm: true, acknowledgeRelaxedRequirements: false, refreshQuotes: false }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("diffs constraints and flags only loosened mandatory requirements", async () => {
    const r = await blocked();
    const c = confirmedConstraints(r.mission);
    const d = diffConstraints(c, { ...c, quantity: 9, requiredAttributes: { ...c.requiredAttributes, color: "black" }, maxRiskScore: 30 });
    expect(d.map((x) => [x.field, x.relaxesMandatory])).toEqual([
      ["quantity", false],
      ["maxRiskScore", false],
      ["requiredAttributes.color", false],
    ]);
    const loosen = diffConstraints({ ...c, maxRiskScore: 30 }, { ...c, maxRiskScore: null, requiredAttributes: {} });
    expect(loosen.filter((x) => x.relaxesMandatory).map((x) => x.field).sort()).toEqual(["maxRiskScore", "requiredAttributes.length", "requiredAttributes.power"]);
  });
});

describe("approval and payment after revision", () => {
  it("a revised mission still needs human approval for its exact snapshot, then completes the existing PayPal flow", async () => {
    const r = await blocked();
    const { mission: rev } = await revise(r, { budgetMinor: 36_400 });
    await executeMission(prisma, rev.id);
    const ran = await prisma.mission.findUniqueOrThrow({ where: { id: rev.id } });
    // No order before authorization.
    await expect(createOrderForMission(prisma, r.user, rev.id, "t")).rejects.toBeTruthy();
    expect(pp.createCalls).toBe(0);
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: rev.id, productId: ran.recommendedProductId! } });
    const approval = await approvePurchase(prisma, r.user, rev.id, { productId: mp.productId, expectedTotalMinor: mp.totalMinor! }, "t");
    expect(approval).toMatchObject({ kind: "AUTHORIZATION", approvedAmountMinor: 36_400, missionId: rev.id });
    const order = await createOrderForMission(prisma, r.user, rev.id, "t");
    expect(pp.captureCalls).toBe(0);
    pp.buyerApproves(order.providerOrderId!);
    const cap = await capturePayment(prisma, r.user, order.paymentId, "t");
    expect(cap.status).toBe("CAPTURED");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: rev.id } })).status).toBe("COMPLETED");
    // The original stays blocked and purchase-free.
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("BLOCKED");
    expect(await prisma.payment.count({ where: { missionId: r.mission.id } })).toBe(0);
  });

  it("approval snapshot mismatch: an amount reviewed for a different revision is refused", async () => {
    const r = await blocked();
    const { mission: rev } = await revise(r, { quantity: 9 }, {});
    await executeMission(prisma, rev.id);
    const ran = await prisma.mission.findUniqueOrThrow({ where: { id: rev.id } });
    expect(ran.status).toBe("READY_FOR_CHECKOUT");
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: rev.id, productId: ran.recommendedProductId! } });
    expect(mp.totalMinor).toBe(9_750);
    await expect(approvePurchase(prisma, r.user, rev.id, { productId: mp.productId, expectedTotalMinor: 36_400 }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.approval.count({ where: { missionId: rev.id } })).toBe(0);
  });

  it("hard BLOCK: the original cannot be approved, ordered or captured, however the client asks", async () => {
    const r = await blocked();
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id, totalMinor: 36_400 } });
    await expect(approvePurchase(prisma, r.user, r.mission.id, { productId: mp.productId, expectedTotalMinor: 36_400 }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createOrderForMission(prisma, r.user, r.mission.id, "t")).rejects.toBeTruthy();
    expect(pp.createCalls).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("after a policy change, re-evaluation is a new revision and still needs approver sign-off", async () => {
    const r = await blocked();
    const { row, config } = await latestPolicy(prisma, r.user.id);
    await publishPolicy(prisma, r.user, { ...config, blockOverBudget: false }, row.version);
    const { mission: rev } = await revise(r, {}); // allowed: policy changed since evaluation
    await executeMission(prisma, rev.id);
    const ran = await prisma.mission.findUniqueOrThrow({ where: { id: rev.id } });
    expect(ran.status).toBe("AWAITING_APPROVAL");
    expect(ran.decision).toBe("REQUIRE_APPROVAL");
    await prisma.user.update({ where: { id: r.user.id }, data: { roles: ["REQUESTER"] } });
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: rev.id, productId: ran.recommendedProductId! } });
    await expect(approvePurchase(prisma, requester, rev.id, { productId: mp.productId, expectedTotalMinor: mp.totalMinor! }, "t")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("policy override requests", () => {
  const justification = "Bench is down; cables are needed for the customer demo on Friday.";

  it("records a request with mission and policy versions, but changes nothing about checkout", async () => {
    const r = await blocked();
    const req = await createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["budget.mission"], proposedBudgetMinor: 36_400, justification }, "t");
    expect(req).toMatchObject({ status: "PENDING_REVIEW", missionVersion: r.mission.version, policyVersion: r.mission.policyVersion, currentBudgetMinor: 10_000, proposedBudgetMinor: 36_400 });
    expect(req.challengedChecks[0]).toMatchObject({ checkId: "budget.mission", policyField: "blockOverBudget" });
    expect(req.challengedChecks[0].offers.length).toBeGreaterThan(0);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { missionId: r.mission.id, eventType: "override.requested" } });
    expect(ev.metadata).toMatchObject({ requestId: req.id, checkIds: ["budget.mission"] });
    await expect(createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["budget.mission"], justification }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("BLOCKED");
    await expect(createOrderForMission(prisma, r.user, r.mission.id, "t")).rejects.toBeTruthy();
  });

  it("refuses to file overrides against system-enforced floors and audits the refusal", async () => {
    const s = await newSession();
    const { user } = await userFor(s);
    const { row, config } = await latestPolicy(prisma, user.id);
    await publishPolicy(prisma, user, { ...config, costAllowancePct: 0 }, row.version); // undisclosed totals now BLOCK at the floor
    const r = await runMission(BLOCKED_CABLES, s);
    const { analysis } = await getRecovery(prisma, r.user, r.mission.id);
    expect(analysis.override.notOverridable.map((x) => x.checkId)).toContain("floor.total_known");
    await expect(createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["floor.total_known"], justification }, "t")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await prisma.auditEvent.count({ where: { missionId: r.mission.id, eventType: "override.refused" } })).toBe(1);
    await expect(createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["category"], justification }, "t")).rejects.toMatchObject({ code: "VALIDATION" }); // not failing
    expect(await prisma.policyOverrideRequest.count()).toBe(0);
  });

  it("rejects unauthorized reviews: self-review, non-admins, and admins without the APPROVER role", async () => {
    const r = await blocked();
    const req = await createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["budget.mission"], justification }, "t");
    // The requester holds APPROVER (demo default) but can never review their own request.
    const self = await call(reviewRoute.POST, { method: "POST", session: r.session, params: { overrideId: req.id }, body: { decision: "APPROVED", note: "looks fine" } });
    expect(self.status).toBe(403);
    expect(await prisma.auditEvent.count({ where: { eventType: "override.review_denied" } })).toBe(1);
    // Another approver who is not a configured policy admin cannot even see it.
    const other = await userFor();
    await expect(reviewOverride(prisma, other.user, req.id, { decision: "APPROVED", note: "looks fine" }, "t")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getOverride(prisma, other.user, req.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A configured admin without the APPROVER role is refused.
    process.env.AEGIS_POLICY_ADMIN_IDS = other.user.id;
    resetEnvCache();
    const noRole = await prisma.user.update({ where: { id: other.user.id }, data: { roles: ["REQUESTER"] } });
    await expect(reviewOverride(prisma, noRole, req.id, { decision: "APPROVED", note: "looks fine" }, "t")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.policyOverrideRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING_REVIEW");
    // The database also refuses self-review.
    await expect(prisma.policyOverrideRequest.update({ where: { id: req.id }, data: { reviewedById: r.user.id } })).rejects.toBeTruthy();
  });

  it("an APPROVED override does not authorise anything: no policy change, no approval, no order", async () => {
    const r = await blocked();
    const req = await createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["budget.mission"], justification }, "t");
    const admin = await userFor();
    process.env.AEGIS_POLICY_ADMIN_IDS = admin.user.id;
    resetEnvCache();
    const policyBefore = await latestPolicy(prisma, r.user.id);
    const reviewed = await reviewOverride(prisma, admin.user, req.id, { decision: "APPROVED", note: "Exception justified for the demo." }, "t");
    expect(reviewed).toMatchObject({ status: "APPROVED", reviewedById: admin.user.id });
    await expect(reviewOverride(prisma, admin.user, req.id, { decision: "REJECTED", note: "changed my mind" }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await latestPolicy(prisma, r.user.id)).row.version).toBe(policyBefore.row.version);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("BLOCKED");
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id, totalMinor: 36_400 } });
    await expect(approvePurchase(prisma, r.user, r.mission.id, { productId: mp.productId, expectedTotalMinor: 36_400 }, "t")).rejects.toBeTruthy();
    await expect(createOrderForMission(prisma, r.user, r.mission.id, "t")).rejects.toBeTruthy();
    expect(await prisma.approval.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { eventType: "override.reviewed" } });
    expect(ev).toMatchObject({ missionId: r.mission.id, actor: `user:${admin.user.id}`, outcome: "SUCCESS" });
  });

  it("requesters can withdraw; others cannot; non-blocked missions cannot request", async () => {
    const r = await blocked();
    const req = await createOverrideRequest(prisma, r.user, r.mission.id, { checkIds: ["budget.mission"], justification }, "t");
    const other = await userFor();
    await expect(withdrawOverride(prisma, other.user, req.id, "t")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await withdrawOverride(prisma, r.user, req.id, "t")).status).toBe("WITHDRAWN");
    const ok = await runMission("Buy 50 USB-C cables, 1m, 60W, for the hardware bench. Budget $400, needed within 10 days.");
    await expect(createOverrideRequest(prisma, ok.user, ok.mission.id, { checkIds: ["budget.mission"], justification }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
    const short = await call(overridesRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { checkIds: ["budget.mission"], justification: "too short" } });
    expect(short.status).toBe(400);
  });
});

describe("advisor", () => {
  class FakeLlm implements AiProvider {
    readonly name = "fake";
    readonly isLlm = true;
    calls = 0;
    constructor(private readonly make: (a: RecoveryAnalysis) => unknown) {}
    interpretMission = new DeterministicAi().interpretMission;
    explainRecommendation = new DeterministicAi().explainRecommendation;
    async adviseRecovery(a: RecoveryAnalysis) {
      this.calls += 1;
      return { raw: this.make(a), source: "llm" as const };
    }
  }

  it("falls back to deterministic guidance without an LLM, and audits the advice", async () => {
    const r = await blocked();
    const out = await recoveryAdvice(prisma, r.user, r.mission.id, "t", { ai: new DeterministicAi() });
    expect(out.source).toBe("deterministic");
    expect(out.advice.failedConstraints.map((f) => f.checkId)).toContain("budget.mission");
    expect(await prisma.auditEvent.count({ where: { missionId: r.mission.id, eventType: "recovery.advice_generated" } })).toBe(1);
  });

  it("uses validated LLM advice, rejects fabricated prices, and respects the per-mission LLM cap", async () => {
    const r = await blocked();
    const good = new FakeLlm((a) => ({ ...deterministicAdvice(a), diagnosis: `The cheapest compliant offer totals $364.00 against a $100.00 budget.` }));
    const ok = await recoveryAdvice(prisma, r.user, r.mission.id, "t", { ai: good });
    expect(ok.source).toBe("llm");
    const liar = new FakeLlm((a) => ({ ...deterministicAdvice(a), diagnosis: "A seller offers these for $50.00 and it will be approved." }));
    const bad = await recoveryAdvice(prisma, r.user, r.mission.id, "t", { ai: liar });
    expect(bad.source).toBe("deterministic");
    expect(bad.fallbackReason).toMatch(/validation/);
    const before = (await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).llmCalls;
    await prisma.mission.update({ where: { id: r.mission.id }, data: { llmCalls: 3 } });
    const capped = new FakeLlm((a) => deterministicAdvice(a));
    const out = await recoveryAdvice(prisma, r.user, r.mission.id, "t", { ai: capped });
    expect(capped.calls).toBe(0);
    expect(out.fallbackReason).toMatch(/limit/);
    expect(before).toBeGreaterThan(0);
    // The advisor never changes the mission.
    const m = await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } });
    expect(m).toMatchObject({ status: "BLOCKED", decision: "BLOCK", budgetMinor: 10_000 });
  });
});

describe("alternatives", () => {
  it("searches the demo catalogue, labels it demo, and persists nothing", async () => {
    const r = await blocked();
    const products = await prisma.product.count();
    const mps = await prisma.missionProduct.count();
    const out = await searchAlternatives(prisma, r.user, r.mission.id, "t");
    expect(out.isDemo).toBe(true);
    expect(out.note).toMatch(/DEMO DATA/);
    expect(out.results.every((x) => x.isDemoData)).toBe(true);
    expect(out.queries[0]).toContain("1m");
    expect(await prisma.product.count()).toBe(products);
    expect(await prisma.missionProduct.count()).toBe(mps);
    expect(await prisma.auditEvent.count({ where: { missionId: r.mission.id, eventType: "recovery.alternatives_searched" } })).toBe(1);
  });
});
