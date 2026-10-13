import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { capturePayment, createOrderForMission, reconcilePayment, SimulatedCaptureCrash, STALE_CAPTURE_MS } from "@/server/payments";
import { setGatewayOverrideForTests } from "@/server/paypal";
import { publishPolicy, latestPolicy } from "@/server/policies";
import { approvePurchase } from "@/server/approvals";
import { processWebhookEvent } from "@/server/webhooks";
import { verifyAuditChain } from "@/server/audit";
import * as ordersRoute from "@/app/api/paypal/orders/route";
import * as captureRoute from "@/app/api/paypal/capture/route";
import * as approveRoute from "@/app/api/missions/[id]/approve/route";
import * as rolesRoute from "@/app/api/session/roles/route";
import { call } from "../helpers/api";
import { MockPayPal } from "../helpers/mock-paypal";
import { approvedMission, runMission, SCENARIO } from "../helpers/fixtures";

let pp: MockPayPal;
beforeEach(() => {
  pp = new MockPayPal();
  setGatewayOverrideForTests(pp);
});
afterEach(() => setGatewayOverrideForTests(null));

async function checkout() {
  const r = await approvedMission();
  const order = await createOrderForMission(prisma, r.user, r.mission.id, "t");
  return { ...r, order };
}

describe("approval gate", () => {
  it("REQUIRE_APPROVAL needs the APPROVER role; the approval binds amount, policy version and snapshot", async () => {
    const r = await runMission(SCENARIO.robotics);
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id, productId: r.mission.recommendedProductId! } });
    await call(rolesRoute.POST, { method: "POST", session: r.session, body: { approver: false } });
    const denied = await call(approveRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { productId: mp.productId, expectedTotalMinor: mp.totalMinor, acknowledge: true } });
    expect(denied.status).toBe(403);
    await call(rolesRoute.POST, { method: "POST", session: r.session, body: { approver: true } });
    const ok = await call(approveRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { productId: mp.productId, expectedTotalMinor: mp.totalMinor, acknowledge: true } });
    expect(ok.status).toBe(200);
    expect(ok.data.kind).toBe("APPROVER_APPROVAL");
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: ok.data.approvalId } });
    expect(a).toMatchObject({ approvedAmountMinor: 176_700, currency: "USD", policyVersion: 1, status: "ACTIVE", approvedById: r.user.id });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("READY_FOR_CHECKOUT");
  });

  it("refuses an approval whose reviewed amount differs from the server's amount", async () => {
    const r = await runMission(SCENARIO.robotics);
    const res = await call(approveRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { productId: r.mission.recommendedProductId, expectedTotalMinor: 1, acknowledge: true } });
    expect(res.status).toBe(409);
  });

  it("a BLOCKED mission cannot be approved by a client-side bypass", async () => {
    const r = await runMission(SCENARIO.gpu);
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id } });
    const res = await call(approveRoute.POST, { method: "POST", session: r.session, params: { id: r.mission.id }, body: { productId: mp.productId, expectedTotalMinor: mp.totalMinor, acknowledge: true } });
    expect(res.status).toBe(409);
    const order = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } });
    expect(order.status).toBe(409);
    expect(await prisma.payment.count()).toBe(0);
  });

  it("ALLOW_CHECKOUT still requires an owner authorisation before any order", async () => {
    const r = await runMission(SCENARIO.cables);
    const res = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } });
    expect(res.status).toBe(422);
    expect(pp.createCalls).toBe(0);
  });
});

describe("orders and verified capture", () => {
  it("order body is { missionId } only; client amounts are rejected", async () => {
    const r = await approvedMission();
    const bad = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id, amount: "0.01" } });
    expect(bad.status).toBe(400);
    const badCap = await call(captureRoute.POST, { method: "POST", session: r.session, body: { paymentId: "x", orderId: "EVIL" } });
    expect(badCap.status).toBe(400);
  });

  it("creates one order idempotently and captures only after buyer approval", async () => {
    const r = await approvedMission();
    const o1 = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } });
    const o2 = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } });
    expect(o1.status).toBe(200);
    expect(o2.data.paymentId).toBe(o1.data.paymentId);
    expect(o2.data.reused).toBe(true);
    expect(pp.createCalls).toBe(1);
    const order = pp.orders.get(o1.data.providerOrderId)!.order;
    expect(order).toMatchObject({ totalMinor: 176_700, itemTotalMinor: 160_000, shippingMinor: 3_500, taxMinor: 13_200, customId: o1.data.paymentId });

    const early = await call(captureRoute.POST, { method: "POST", session: r.session, body: { paymentId: o1.data.paymentId } });
    expect(early.status).toBe(422);
    expect(pp.captureCalls).toBe(0);

    pp.buyerApproves(o1.data.providerOrderId);
    const cap = await call(captureRoute.POST, { method: "POST", session: r.session, body: { paymentId: o1.data.paymentId } });
    expect(cap.status).toBe(200);
    expect(cap.data).toMatchObject({ status: "CAPTURED", mode: "SANDBOX", simulated: false });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: o1.data.paymentId }, include: { approval: true, mission: true } });
    expect(p.approval.status).toBe("CONSUMED");
    expect(p.mission.status).toBe("COMPLETED");
    expect(p.providerCaptureId).toBe(`CAP-${o1.data.providerOrderId}`);

    const again = await call(captureRoute.POST, { method: "POST", session: r.session, body: { paymentId: o1.data.paymentId } });
    expect(again.data.status).toBe("CAPTURED");
    expect(pp.captureCalls).toBe(1);
    const another = await call(ordersRoute.POST, { method: "POST", session: r.session, body: { missionId: r.mission.id } });
    expect(another.status).toBe(409); // one mission = one purchase
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("concurrent duplicate captures call the provider exactly once", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    const results = await Promise.allSettled([1, 2, 3].map(() => capturePayment(prisma, r.user, r.order.paymentId, "t")));
    expect(pp.captureCalls).toBe(1);
    expect(results.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("CAPTURED");
    expect(await prisma.auditEvent.count({ where: { eventType: "payment.captured" } })).toBe(1);
  });

  it("capture PENDING at PayPal → CAPTURE_PROVIDER_PENDING, then resolved by reconciliation", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    pp.captureBehavior = "pending";
    const res = await capturePayment(prisma, r.user, r.order.paymentId, "t");
    expect(res.status).toBe("CAPTURE_PROVIDER_PENDING");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("READY_FOR_CHECKOUT");
    pp.setCaptureStatus(r.order.providerOrderId!, "COMPLETED");
    expect(await reconcilePayment(prisma, r.order.paymentId, { gateway: pp })).toBe("CAPTURED");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("COMPLETED");
  });

  it("capture failure (declined) → FAILED, mission stays retryable, nothing marked captured", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    pp.captureBehavior = "decline";
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId }, include: { approval: true } });
    expect(p.status).toBe("FAILED");
    expect(p.approval.status).toBe("ACTIVE");
    const retry = await createOrderForMission(prisma, r.user, r.mission.id, "t");
    expect(retry.paymentId).not.toBe(r.order.paymentId);
  });

  it("ORDER_ALREADY_CAPTURED is reconciled from provider state", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } });
    // Order is CAPTURED at PayPal under another request id, but our GET still showed APPROVED earlier.
    const realGet = pp.getOrder.bind(pp);
    let first = true;
    pp.getOrder = async (id) => {
      if (first) {
        first = false;
        const o = await realGet(id);
        pp.completeOutOfBand(id);
        return o;
      }
      return realGet(id);
    };
    const res = await capturePayment(prisma, r.user, p.id, "t");
    expect(res.status).toBe("CAPTURED");
    expect(res.message).toMatch(/already captured/i);
  });

  it("crash after PayPal captured but before the DB write is recovered", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t", { gateway: pp, crashAfterProviderCapture: true })).rejects.toBeInstanceOf(SimulatedCaptureCrash);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("CAPTURE_PENDING");
    // Not yet stale: reconcile leaves it alone; a fresh capture request is refused as in-progress.
    expect(await reconcilePayment(prisma, r.order.paymentId, { gateway: pp })).toBe("CAPTURE_PENDING");
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t")).rejects.toMatchObject({ code: "CONFLICT" });
    const later = () => new Date(Date.now() + STALE_CAPTURE_MS + 1_000);
    expect(await reconcilePayment(prisma, r.order.paymentId, { gateway: pp, now: later })).toBe("CAPTURED");
    expect(pp.captureCalls).toBe(1);
  });

  it("network timeout during capture leaves CAPTURE_PENDING (not success) and resumes with the same request id", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    pp.captureBehavior = "network";
    const res = await capturePayment(prisma, r.user, r.order.paymentId, "t");
    expect(res.status).toBe("CAPTURE_PENDING");
    expect(res.message).toMatch(/NOT confirmed/);
    const later = () => new Date(Date.now() + STALE_CAPTURE_MS + 1_000);
    const resumed = await capturePayment(prisma, r.user, r.order.paymentId, "t", { now: later });
    expect(resumed.status).toBe("CAPTURED");
    expect(pp.captureCalls).toBe(2);
  });

  it("tampered provider order (amount) is refused and the approval invalidated", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    pp.tamper = { totalMinor: 1 };
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(pp.captureCalls).toBe(0);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId }, include: { approval: true } });
    expect(p.status).toBe("FAILED");
    expect(p.approval.status).toBe("INVALIDATED");
  });
});

describe("approval binding at capture", () => {
  it("snapshot mismatch (product data changed after approval) fails and requires re-approval", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    await prisma.product.update({ where: { id: r.mp.productId }, data: { sellerId: "someone-else" } });
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(pp.captureCalls).toBe(0);
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: r.approval.id } });
    expect(a.status).toBe("INVALIDATED");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("AWAITING_APPROVAL");
  });

  it("amount change after approval blocks order creation", async () => {
    const r = await approvedMission();
    await prisma.product.update({ where: { id: r.mp.productId }, data: { taxMinor: 13_300 } });
    await expect(createOrderForMission(prisma, r.user, r.mission.id, "t")).rejects.toBeTruthy();
    expect(pp.createCalls).toBe(0);
  });

  it("expired approval cannot be captured", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    const afterExpiry = () => new Date(r.approval.expiresAt.getTime() + 1_000);
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t", { now: afterExpiry })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(pp.captureCalls).toBe(0);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: r.approval.id } })).status).toBe("EXPIRED");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("EXPIRED");
  });

  it("stricter policy at capture time denies and invalidates (BLOCK)", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    const { config, row } = await latestPolicy(prisma, r.user.id);
    await publishPolicy(prisma, r.user, { ...config, maxPurchaseMinor: 100_000, maxAutoPurchaseMinor: 50_000 }, row.version);
    await expect(capturePayment(prisma, r.user, r.order.paymentId, "t")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(pp.captureCalls).toBe(0);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: r.approval.id } })).status).toBe("INVALIDATED");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("BLOCKED");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("BLOCKED");
  });

  it("stricter policy requiring approval invalidates an owner AUTHORIZATION (re-approval required)", async () => {
    const r = await approvedMission(SCENARIO.cables);
    expect(r.approval.kind).toBe("AUTHORIZATION");
    const order = await createOrderForMission(prisma, r.user, r.mission.id, "t");
    pp.buyerApproves(order.providerOrderId!);
    const { config, row } = await latestPolicy(prisma, r.user.id);
    await publishPolicy(prisma, r.user, { ...config, requireApprovalForEveryPayment: true }, row.version);
    await expect(capturePayment(prisma, r.user, order.paymentId, "t")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("AWAITING_APPROVAL");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe("CANCELLED");
  });

  it("looser policy never upgrades an approval: it stays bound to its original version and kind", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    const { config, row } = await latestPolicy(prisma, r.user.id);
    await publishPolicy(prisma, r.user, { ...config, approvalThresholdMinor: 400_000, maxAutoPurchaseMinor: 400_000 }, row.version);
    const res = await capturePayment(prisma, r.user, r.order.paymentId, "t");
    expect(res.status).toBe("CAPTURED");
    const a = await prisma.approval.findUniqueOrThrow({ where: { id: r.approval.id } });
    expect(a).toMatchObject({ policyVersion: 1, kind: "APPROVER_APPROVAL", decisionAtApproval: "REQUIRE_APPROVAL", status: "CONSUMED" });
  });

  it("duplicate purchase within the window requires approval", async () => {
    const first = await approvedMission(SCENARIO.cables);
    const second = await runMission(SCENARIO.cables, first.session);
    expect(second.mission.decision).toBe("REQUIRE_APPROVAL");
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: second.mission.id, productId: second.mission.recommendedProductId! } });
    expect((mp.policyResult as { checks: { id: string; result: string }[] }).checks.find((c) => c.id === "duplicate")?.result).toBe("REQUIRE_APPROVAL");
    await approvePurchase(prisma, second.user, second.mission.id, { productId: mp.productId, expectedTotalMinor: mp.totalMinor! }, "t");
  });
});

describe("webhooks (signature verified upstream; body is only a trigger)", () => {
  const evt = (id: string, type: string, customId: string) => ({ id, event_type: type, resource: { id: "CAPX", custom_id: customId } });

  it("dedupes, re-fetches provider truth, and never regresses a terminal state", async () => {
    const r = await checkout();
    pp.buyerApproves(r.order.providerOrderId!);
    pp.captureBehavior = "pending";
    await capturePayment(prisma, r.user, r.order.paymentId, "t");

    // Out-of-order: a "COMPLETED" event arrives while PayPal still reports PENDING → state unchanged.
    expect((await processWebhookEvent(prisma, evt("WH-1", "PAYMENT.CAPTURE.COMPLETED", r.order.paymentId), pp)).status).toBe("processed");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("CAPTURE_PROVIDER_PENDING");

    pp.setCaptureStatus(r.order.providerOrderId!, "COMPLETED");
    await processWebhookEvent(prisma, evt("WH-2", "PAYMENT.CAPTURE.COMPLETED", r.order.paymentId), pp);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("CAPTURED");

    // Duplicate delivery.
    expect((await processWebhookEvent(prisma, evt("WH-2", "PAYMENT.CAPTURE.COMPLETED", r.order.paymentId), pp)).status).toBe("duplicate");

    pp.setCaptureStatus(r.order.providerOrderId!, "REFUNDED");
    await processWebhookEvent(prisma, evt("WH-3", "PAYMENT.CAPTURE.REFUNDED", r.order.paymentId), pp);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("REFUNDED");

    // Late COMPLETED after refund: provider says REFUNDED anyway; and even a forged COMPLETED cannot regress.
    pp.setCaptureStatus(r.order.providerOrderId!, "COMPLETED");
    await processWebhookEvent(prisma, evt("WH-4", "PAYMENT.CAPTURE.COMPLETED", r.order.paymentId), pp);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId } })).status).toBe("REFUNDED");
    expect(await prisma.auditEvent.count({ where: { eventType: "payment.transition_ignored" } })).toBe(1);
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });
});
