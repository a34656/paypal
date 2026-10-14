import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { capturePayment, createOrderForMission, reconcilePayment, refundPayment, releaseHold, settlePayment, STALE_CAPTURE_MS } from "@/server/payments";
import { setGatewayOverrideForTests } from "@/server/paypal";
import { approvePurchase } from "@/server/approvals";
import { createMission, confirmMission } from "@/server/missions";
import { executeMission } from "@/server/orchestrator";
import { latestPolicy, publishPolicy } from "@/server/policies";
import { processWebhookEvent } from "@/server/webhooks";
import { verifyAuditChain } from "@/server/audit";
import { mapUcpProduct } from "@/domain/providers/channel3";
import type { ProductSearch } from "@/domain/providers/product-provider";
import * as settleRoute from "@/app/api/paypal/settle/route";
import * as refundRoute from "@/app/api/paypal/refund/route";
import { call } from "../helpers/api";
import { MockPayPal } from "../helpers/mock-paypal";
import { approvedMission, SCENARIO, userFor } from "../helpers/fixtures";

/** Channel3 UCP-shaped listing: real catalogues disclose price and seller, not shipping/tax. */
const UCP_PI = {
  id: "canonical_product_id:PI5X8GB",
  title: "Raspberry Pi 5 8GB Single Board Computer",
  description: { plain: "Quad-core Arm Cortex-A76 board." },
  price_range: { min: { amount: 7_999, currency: "USD" }, max: { amount: 8_400, currency: "USD" } },
  metadata: { top_features: ["Model: Raspberry Pi 5", "Memory: 8GB LPDDR4X SDRAM", "Quad-core Arm Cortex-A76 at 2.4GHz"] },
  variants: [
    { id: "PI5X8GB:mc:1", price: { amount: 7_999, currency: "USD" }, list_price: { amount: 8_000, currency: "USD" }, availability: { available: true }, condition: ["new"], url: "https://buy.trychannel3.com/a", seller: { id: "mc", domain: "microcenter.com", name: "Micro Center" } },
    { id: "PI5X8GB:xx:1", price: { amount: 8_400, currency: "USD" }, availability: { available: true }, condition: ["new"], url: "https://buy.trychannel3.com/b", seller: { id: "xx", domain: "pi-deals.example", name: "Pi Deals" } },
    { id: "PI5X8GB:mc:2", price: { amount: 5_000, currency: "USD" }, availability: { available: true }, condition: ["refurbished"], seller: { id: "mc", domain: "microcenter.com", name: "Micro Center" } },
    { id: "PI5X8GB:zz:1", price: { amount: 4_000, currency: "USD" }, availability: { available: false }, seller: { id: "zz", domain: "sold-out.example", name: "Sold Out" } },
  ],
};

const realCatalogue: ProductSearch = {
  name: "channel3",
  isDemo: false,
  search: async (q) => mapUcpProduct(UCP_PI, q),
};

const CAP = 7_999 * 20 + Math.ceil((7_999 * 20 * 15) / 100);

let pp: MockPayPal;
beforeEach(() => {
  pp = new MockPayPal();
  setGatewayOverrideForTests(pp);
});
afterEach(() => setGatewayOverrideForTests(null));

async function cappedMission() {
  const { user, session } = await userFor();
  const m = await createMission(prisma, user, SCENARIO.robotics, "t");
  await confirmMission(prisma, user, m.id, m.parsedProposal, "t");
  await executeMission(prisma, m.id, { products: realCatalogue });
  const mission = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } });
  return { user, session, mission };
}

async function heldPayment() {
  const r = await cappedMission();
  const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: r.mission.id, productId: r.mission.recommendedProductId! } });
  await approvePurchase(prisma, r.user, r.mission.id, { productId: mp.productId, expectedTotalMinor: mp.totalMinor! }, "t");
  const order = await createOrderForMission(prisma, r.user, r.mission.id, "t");
  pp.buyerApproves(order.providerOrderId!);
  const held = await capturePayment(prisma, r.user, order.paymentId, "t");
  return { ...r, mp, order, held };
}

describe("real catalogue data → spending cap", () => {
  it("maps Channel3 offers per retailer, skips refurbished/unavailable, trusts policy domains", async () => {
    const r = await cappedMission();
    const mps = await prisma.missionProduct.findMany({ where: { missionId: r.mission.id }, include: { product: true } });
    expect(mps.map((m) => m.product.sellerId).sort()).toEqual(["microcenter.com", "pi-deals.example"]);
    const mc = mps.find((m) => m.product.sellerId === "microcenter.com")!;
    const other = mps.find((m) => m.product.sellerId === "pi-deals.example")!;
    expect(mc.product).toMatchObject({ provider: "channel3", isDemoData: false, unitPriceMinor: 7_999, shippingMinor: null, taxMinor: null, sellerVerificationStatus: "VERIFIED" });
    expect(other.product.sellerVerificationStatus).toBe("UNKNOWN");
    expect(mc.product.metadata).toMatchObject({ baselineUnitPriceMinor: 8_000, baselineSource: "retailer-list-price", inStock: true });
    // No list price → the median of the other retailers' prices is the reference.
    expect(other.product.metadata).toMatchObject({ baselineUnitPriceMinor: 7_999, baselineSource: "cross-retailer-median" });
    expect(mc).toMatchObject({ amountBasis: "CAP", totalMinor: CAP, allowanceMinor: CAP - 7_999 * 20 });
    // "Memory: 8GB LPDDR4X SDRAM" satisfies ram=8GB through the key alias and token match.
    expect((mc.riskEvidence as { requirementMismatch: boolean | null }).requirementMismatch).toBe(false);
    expect(r.mission.recommendedProductId).toBe(mc.productId);
    expect(r.mission.decision).toBe("REQUIRE_APPROVAL");
    expect(r.mission.status).toBe("AWAITING_APPROVAL");
  });

  it("with the allowance set to 0, undisclosed shipping/tax BLOCK as before", async () => {
    const { user } = await userFor();
    const { row, config } = await latestPolicy(prisma, user.id);
    await publishPolicy(prisma, user, { ...config, costAllowancePct: 0 }, row.version);
    const m = await createMission(prisma, user, SCENARIO.robotics, "t");
    await confirmMission(prisma, user, m.id, m.parsedProposal, "t");
    await executeMission(prisma, m.id, { products: realCatalogue });
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } });
    expect(mission.status).toBe("BLOCKED");
    const mp = await prisma.missionProduct.findFirstOrThrow({ where: { missionId: m.id } });
    expect(mp.totalMinor).toBeNull();
    expect(mission.recommendationSummary).toMatch(/No offer can proceed\..*not disclosed/);
  });
});

describe("authorization hold → human settlement → refunds", () => {
  it("places a PayPal hold for exactly the cap after both gates, and consumes the approval", async () => {
    const r = await heldPayment();
    expect(r.held.status).toBe("AUTHORIZED");
    const order = pp.orders.get(r.order.providerOrderId!)!.order;
    expect(order).toMatchObject({ intent: "AUTHORIZE", totalMinor: CAP, itemTotalMinor: null });
    expect(pp.captureCalls).toBe(0);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId }, include: { approval: true, mission: true } });
    expect(p).toMatchObject({ intent: "AUTHORIZE", amountMinor: CAP, itemTotalMinor: 7_999 * 20, allowanceMinor: CAP - 7_999 * 20, providerAuthorizationId: `AUTH${r.order.providerOrderId}` });
    expect(p.approval.status).toBe("CONSUMED");
    expect(p.mission.status).toBe("READY_FOR_CHECKOUT");
    // A second "pay" click never places a second hold.
    expect((await capturePayment(prisma, r.user, r.order.paymentId, "t")).status).toBe("AUTHORIZED");
    expect(pp.authorizeCalls).toBe(1);
  });

  it("settles the real invoice amount ≤ cap, never above it, and completes the mission", async () => {
    const r = await heldPayment();
    const over = await call(settleRoute.POST, { method: "POST", session: r.session, body: { paymentId: r.order.paymentId, finalAmount: "9999.00" } });
    expect(over.status).toBe(422);
    expect(pp.captureCalls).toBe(0);

    const ok = await call(settleRoute.POST, { method: "POST", session: r.session, body: { paymentId: r.order.paymentId, finalAmount: "1712.35" } });
    expect(ok.status).toBe(200);
    expect(ok.data.status).toBe("CAPTURED");
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.order.paymentId }, include: { mission: true } });
    expect(p).toMatchObject({ status: "CAPTURED", settledMinor: 171_235, providerCaptureId: `CAPAUTH${r.order.providerOrderId}` });
    expect(p.mission.status).toBe("COMPLETED");
    // Settling twice is idempotent and does not capture again.
    expect((await settlePayment(prisma, r.user, p.id, 171_235, "t")).status).toBe("CAPTURED");
    expect(pp.captureCalls).toBe(1);
    const audit = await prisma.auditEvent.findMany({ where: { missionId: r.mission.id, eventType: { in: ["payment.authorized", "payment.settle_started", "payment.captured"] } }, orderBy: { seq: "asc" } });
    expect(audit.map((a) => a.eventType)).toEqual(["payment.authorized", "payment.settle_started", "payment.captured"]);
    expect((await verifyAuditChain(prisma)).ok).toBe(true);
  });

  it("a settlement timeout stays SETTLE_PENDING and retries with the same PayPal-Request-Id", async () => {
    const r = await heldPayment();
    pp.captureBehavior = "network-after-capture";
    const first = await settlePayment(prisma, r.user, r.order.paymentId, 170_000, "t");
    expect(first.status).toBe("SETTLE_PENDING");
    await expect(settlePayment(prisma, r.user, r.order.paymentId, 170_000, "t")).rejects.toMatchObject({ code: "CONFLICT" }); // not stale yet
    const later = () => new Date(Date.now() + STALE_CAPTURE_MS + 1_000);
    await expect(settlePayment(prisma, r.user, r.order.paymentId, 150_000, "t", { now: later })).rejects.toMatchObject({ code: "CONFLICT" }); // amount is locked
    expect((await settlePayment(prisma, r.user, r.order.paymentId, 170_000, "t", { now: later })).status).toBe("CAPTURED");
    expect(pp.captureCalls).toBe(2); // second call was an idempotent replay at the provider
  });

  it("releasing the hold voids it at PayPal and closes the mission", async () => {
    const r = await heldPayment();
    const res = await releaseHold(prisma, r.user, r.order.paymentId, "Seller cancelled the order", "t");
    expect(res.status).toBe("CANCELLED");
    expect(pp.orders.get(r.order.providerOrderId!)!.order.authorizations[0].status).toBe("VOIDED");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("DENIED");
    await expect(settlePayment(prisma, r.user, r.order.paymentId, 100_000, "t")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("an expired hold reconciles to EXPIRED", async () => {
    const r = await heldPayment();
    pp.expireAuthorization(r.order.providerOrderId!);
    expect(await reconcilePayment(prisma, r.order.paymentId, { gateway: pp })).toBe("EXPIRED");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: r.mission.id } })).status).toBe("EXPIRED");
  });

  it("partial then full refunds, bounded by the captured amount", async () => {
    const r = await heldPayment();
    await settlePayment(prisma, r.user, r.order.paymentId, 170_000, "t");
    const part = await call(refundRoute.POST, { method: "POST", session: r.session, body: { paymentId: r.order.paymentId, amount: "200.00", reason: "Two boards arrived damaged" } });
    expect(part.status).toBe(200);
    expect(part.data).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedMinor: 20_000, amountMinor: 20_000 });
    const tooMuch = await call(refundRoute.POST, { method: "POST", session: r.session, body: { paymentId: r.order.paymentId, amount: "1600.00", reason: "x-too-much" } });
    expect(tooMuch.status).toBe(422);
    const rest = await refundPayment(prisma, r.user, r.order.paymentId, { reason: "Order returned" }, "t");
    expect(rest).toMatchObject({ status: "REFUNDED", amountMinor: 150_000, refundedMinor: 170_000 });
    expect(await prisma.refund.count({ where: { paymentId: r.order.paymentId, status: "COMPLETED" } })).toBe(2);
    await expect(refundPayment(prisma, r.user, r.order.paymentId, { reason: "again" }, "t")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("concurrent refunds can never exceed the capture", async () => {
    const r = await approvedMission();
    const order = await createOrderForMission(prisma, r.user, r.mission.id, "t");
    pp.buyerApproves(order.providerOrderId!);
    await capturePayment(prisma, r.user, order.paymentId, "t");
    const results = await Promise.allSettled([1, 2, 3].map(() => refundPayment(prisma, r.user, order.paymentId, { amountMinor: 100_000, reason: "dup click" }, "t")));
    expect(results.filter((x) => x.status === "fulfilled").length).toBe(1);
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } });
    expect(p).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedMinor: 100_000 });
    expect(pp.refundCalls).toBe(1);
  });

  it("a refund issued in the PayPal dashboard is picked up from the refund webhook", async () => {
    const r = await approvedMission();
    const order = await createOrderForMission(prisma, r.user, r.mission.id, "t");
    pp.buyerApproves(order.providerOrderId!);
    await capturePayment(prisma, r.user, order.paymentId, "t");
    const captureId = `CAP-${order.providerOrderId}`;
    await pp.refundCapture(captureId, { amountMinor: 176_700, currency: "USD", requestId: "dashboard", note: "manual" });
    const res = await processWebhookEvent(prisma, { id: "WH-REF-1", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFX", custom_id: order.paymentId } }, pp);
    expect(res.status).toBe("processed");
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).toMatchObject({ status: "REFUNDED", refundedMinor: 176_700 });
  });
});
