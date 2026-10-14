import "server-only";
/**
 * Payment execution. Reachable ONLY from human-authenticated routes (orders, capture, cancel)
 * and the signature-verified webhook. Never from agents, the orchestrator, or replay.
 *
 * Capture requires two independent gates:
 *   1. an AEGIS Approval that is ACTIVE, unexpired and snapshot-hash-matching, re-checked
 *      against the CURRENT policy; and
 *   2. PayPal buyer approval, verified server-side by GET order (status APPROVED, amounts,
 *      intent, custom_id, invoice_id, payee).
 * Amounts always come from stored data; client input is limited to { missionId } / { paymentId },
 * plus, after an authorization hold, a human-entered settlement/refund amount that the server
 * bounds by the stored cap / captured amount.
 *
 * AUTHORIZE intent (spending cap, shipping/tax undisclosed): the same two gates run before
 * the hold is placed; the approval is consumed by the hold; settlement captures ≤ cap.
 */
import { randomUUID } from "node:crypto";
import type { Approval, Payment, User } from "@/generated/prisma/client";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { checkApproval } from "@/domain/approval/snapshot";
import { reevaluateApproval } from "@/domain/policy/engine";
import { canTransitionPayment, PAYMENT_IN_FLIGHT, PAYMENT_SUCCESS } from "@/domain/state/machines";
import {
  AUTHORIZATION_VALIDITY_MS,
  completedRefundMinor,
  primaryAuthorization,
  primaryCapture,
  PROVIDER_ORDER_TTL_MS,
  ProviderError,
  verifyOrderMatches,
  type OrderIntent,
  type PaymentGateway,
  type ProviderOrder,
} from "@/domain/payments/gateway";
import { getEnv } from "@/lib/env";
import { appendAudit } from "./audit";
import { casApproval, casMission, casPayment } from "./cas";
import type { Db, Tx } from "./db";
import { AppError, conflict, notFound, precondition } from "./errors";
import { buildSnapshot, evaluateCurrent, loadPurchase } from "./approvals";
import { confirmedConstraints, loadOwnedMission } from "./missions";
import { gatewayForNewPayment, gatewayForPayment } from "./paypal";
import { SimulatedGateway } from "./paypal/simulated";
import { actorOf } from "./users";
import { formatMoney } from "@/lib/money";

/** A CAPTURE_PENDING payment untouched for this long is considered interrupted. */
export const STALE_CAPTURE_MS = 30_000;

export interface PaymentDeps {
  gateway?: PaymentGateway;
  now?: () => Date;
  /** Test-only: simulate the server dying after PayPal captured but before the DB write. */
  crashAfterProviderCapture?: boolean;
}

export class SimulatedCaptureCrash extends Error {}

function modeForGateway(g: PaymentGateway): "DEMO" | "SANDBOX" | "LIVE" {
  if (g.provider === "simulated") return "DEMO";
  return getEnv().paypal.live ? "LIVE" : "SANDBOX";
}

const intentOf = (p: Pick<Payment, "intent">): OrderIntent => (p.intent === "AUTHORIZE" ? "AUTHORIZE" : "CAPTURE");

function providerFailure(err: unknown): never {
  if (err instanceof ProviderError) {
    throw new AppError("PROVIDER_ERROR", `Payment provider error: ${err.message}`, { issue: err.issue, debugId: err.debugId, outcomeUnknown: err.outcomeUnknown });
  }
  throw err;
}

export async function loadOwnedPayment(db: Db, user: Pick<User, "id">, paymentId: string) {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { mission: true, approval: true } });
  if (!payment || payment.mission.ownerId !== user.id) throw notFound("Payment");
  return payment;
}

// ------------------------------------------------------------------------------- order creation

export async function createOrderForMission(db: Db, user: User, missionId: string, correlationId: string, deps: PaymentDeps = {}) {
  const now = deps.now?.() ?? new Date();
  const mission = await loadOwnedMission(db, user, missionId);
  if (mission.status === "COMPLETED") throw conflict("This mission already completed its single purchase.");
  if (mission.status !== "READY_FOR_CHECKOUT") throw conflict(`Mission is ${mission.status}; checkout is not available.`);

  // Idempotency: reuse the mission's live payment if there is one.
  const live = await db.payment.findFirst({ where: { missionId, status: { in: [...PAYMENT_IN_FLIGHT, ...PAYMENT_SUCCESS] } } });
  if (live) {
    if (live.status === "ORDER_CREATED" || live.status === "CHECKOUT_PENDING") {
      return { paymentId: live.id, providerOrderId: live.providerOrderId, provider: live.provider, mode: live.mode, status: live.status, reused: true };
    }
    if (live.status !== "APPROVED") throw conflict(`A payment for this mission is already ${live.status}.`);
  }

  const approval = await db.approval.findFirst({ where: { missionId, status: "ACTIVE" } });
  if (!approval) throw precondition("No active approval. A human must approve or authorise this purchase first.");
  const purchase = await loadPurchase(db, mission, approval.productId);
  const fresh = buildSnapshot(purchase, approval.policyVersion, approval.expiresAt);
  const check = checkApproval(approval, fresh, now);
  if (!check.ok) {
    await invalidateApproval(db, { approval, mission, reason: check.reason, code: check.code, correlationId, actor: actorOf(user) });
    throw precondition(check.reason, { code: check.code });
  }

  const gateway = deps.gateway ?? (live ? gatewayForPayment(db, live.provider) : gatewayForNewPayment(db));
  let payment: Payment;
  if (live) {
    payment = live;
  } else {
    const id = randomUUID();
    try {
      payment = await db.$transaction(async (tx) => {
        const p = await tx.payment.create({
          data: {
            id,
            missionId,
            productId: approval.productId,
            approvalId: approval.id,
            provider: gateway.provider,
            mode: modeForGateway(gateway),
            amountMinor: purchase.amounts.totalMinor,
            itemTotalMinor: purchase.amounts.itemTotalMinor,
            shippingMinor: purchase.amounts.shippingMinor,
            taxMinor: purchase.amounts.taxMinor,
            allowanceMinor: purchase.amounts.allowanceMinor,
            intent: purchase.amounts.basis === "CAP" ? "AUTHORIZE" : "CAPTURE",
            currency: fresh.currency,
            status: "APPROVED",
            // Persisted BEFORE any provider call so retries reuse them.
            idempotencyKey: randomUUID(),
            captureRequestId: randomUUID(),
            invoiceId: `AEGIS-${id}`,
          },
        });
        await appendAudit(tx, {
          missionId,
          ownerId: user.id,
          actor: actorOf(user),
          eventType: "payment.initiated",
          resource: `payment:${p.id}`,
          outcome: "SUCCESS",
          correlationId,
          metadata: { paymentId: p.id, approvalId: approval.id, amountMinor: p.amountMinor, currency: p.currency, intent: p.intent, allowanceMinor: p.allowanceMinor, provider: p.provider, simulated: p.provider === "simulated", status: "APPROVED" },
          mode: p.mode,
        });
        return p;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") throw conflict("Another checkout for this mission started concurrently.");
      throw err;
    }
  }

  let order: ProviderOrder;
  try {
    order = await gateway.createOrder({
      requestId: payment.idempotencyKey,
      intent: intentOf(payment),
      amount: { currency: payment.currency, totalMinor: payment.amountMinor, itemTotalMinor: payment.itemTotalMinor, shippingMinor: payment.shippingMinor, taxMinor: payment.taxMinor },
      customId: payment.id,
      invoiceId: payment.invoiceId,
      description: `AEGIS mission ${confirmedConstraints(mission).title}`,
    });
  } catch (err) {
    await db.$transaction((tx) =>
      appendAudit(tx, {
        missionId,
        ownerId: user.id,
        actor: `provider:${gateway.provider}`,
        eventType: "payment.order_create_failed",
        resource: `payment:${payment.id}`,
        outcome: "FAILURE",
        correlationId,
        metadata: { paymentId: payment.id, error: err instanceof Error ? err.message : String(err), debugId: err instanceof ProviderError ? err.debugId : null },
        mode: payment.mode,
      }),
    );
    providerFailure(err);
  }

  const verification = verifyOrderMatches(order, {
    orderId: order.id,
    amount: { currency: payment.currency, totalMinor: payment.amountMinor, itemTotalMinor: payment.itemTotalMinor, shippingMinor: payment.shippingMinor, taxMinor: payment.taxMinor },
    customId: payment.id,
    invoiceId: payment.invoiceId,
    merchantId: null, // payee is checked at capture
    intent: intentOf(payment),
  });
  if (!verification.ok) {
    await db.$transaction(async (tx) => {
      await casPayment(tx, { id: payment.id, from: "APPROVED", to: "FAILED", version: payment.version, data: { statusReason: `Order mismatch: ${verification.problems.join(", ")}`, providerOrderId: order.id || null } });
      await appendAudit(tx, { missionId, ownerId: user.id, actor: "system:payments", eventType: "payment.order_mismatch", resource: `payment:${payment.id}`, outcome: "BLOCKED", correlationId, metadata: { paymentId: payment.id, problems: verification.problems }, mode: payment.mode });
    });
    throw new AppError("PROVIDER_ERROR", "Provider order does not match the approved purchase; aborted.");
  }

  const result = await db.$transaction(async (tx) => {
    const v1 = await casPayment(tx, { id: payment.id, from: "APPROVED", to: "ORDER_CREATED", version: payment.version, data: { providerOrderId: order.id, providerStatus: order.status, requestIds: [payment.idempotencyKey] } });
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "payment.order_created",
      resource: `payment:${payment.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: { paymentId: payment.id, providerOrderId: order.id, providerStatus: order.status, amountMinor: payment.amountMinor, currency: payment.currency, from: "APPROVED", to: "ORDER_CREATED", simulated: payment.provider === "simulated", debugId: order.debugId },
      mode: payment.mode,
    });
    await casPayment(tx, { id: payment.id, from: "ORDER_CREATED", to: "CHECKOUT_PENDING", version: v1.version });
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "payment.checkout_started",
      resource: `payment:${payment.id}`,
      outcome: "INFO",
      correlationId,
      metadata: { paymentId: payment.id, from: "ORDER_CREATED", to: "CHECKOUT_PENDING", simulated: payment.provider === "simulated" },
      mode: payment.mode,
    });
    return { paymentId: payment.id, providerOrderId: order.id, provider: payment.provider, mode: payment.mode, status: "CHECKOUT_PENDING" as PaymentStatus, reused: false };
  });
  return result;
}

// ------------------------------------------------------------------------------- invalidation

async function invalidateApproval(
  db: Db,
  args: {
    approval: Approval;
    mission: { id: string; ownerId: string; status: string; version: number; decision: string | null; mode: "DEMO" | "SANDBOX" | "LIVE" };
    reason: string;
    code: string;
    correlationId: string;
    actor: string;
    payment?: Payment;
    paymentTo?: PaymentStatus;
    missionTo?: "AWAITING_APPROVAL" | "BLOCKED" | null;
  },
) {
  await db.$transaction(async (tx) => {
    const approvalTo = args.code === "EXPIRED" ? "EXPIRED" : "INVALIDATED";
    if (args.approval.status === "ACTIVE") {
      await casApproval(tx, { id: args.approval.id, from: "ACTIVE", to: approvalTo, version: args.approval.version, reason: args.reason });
    }
    if (args.payment && args.paymentTo) {
      await casPayment(tx, { id: args.payment.id, from: args.payment.status, to: args.paymentTo, version: args.payment.version, data: { statusReason: args.reason } });
    }
    const m = await tx.mission.findUniqueOrThrow({ where: { id: args.mission.id } });
    let missionTo = args.missionTo;
    if (missionTo === undefined) missionTo = m.decision === "REQUIRE_APPROVAL" ? "AWAITING_APPROVAL" : null;
    if (missionTo && m.status === "READY_FOR_CHECKOUT") {
      await casMission(tx, { id: m.id, from: "READY_FOR_CHECKOUT", to: missionTo, version: m.version, data: missionTo === "BLOCKED" ? { decision: "BLOCK" } : { decision: "REQUIRE_APPROVAL" } });
    }
    await appendAudit(tx, {
      missionId: args.mission.id,
      ownerId: args.mission.ownerId,
      actor: args.actor,
      eventType: approvalTo === "EXPIRED" ? "approval.expired" : "approval.invalidated",
      resource: `approval:${args.approval.id}`,
      outcome: missionTo === "BLOCKED" ? "BLOCKED" : "DENIED",
      correlationId: args.correlationId,
      metadata: {
        approvalId: args.approval.id,
        code: args.code,
        reason: args.reason,
        paymentId: args.payment?.id ?? null,
        status: args.paymentTo ?? null,
        to: missionTo ?? m.status,
      },
      mode: args.mission.mode,
    });
  });
}

// ------------------------------------------------------------------------------- capture

export interface CaptureOutcome {
  paymentId: string;
  status: PaymentStatus;
  mode: string;
  provider: string;
  simulated: boolean;
  message: string;
}

export async function capturePayment(db: Db, user: User, paymentId: string, correlationId: string, deps: PaymentDeps = {}): Promise<CaptureOutcome> {
  const now = deps.now?.() ?? new Date();
  const payment = await loadOwnedPayment(db, user, paymentId);
  const gateway = deps.gateway ?? gatewayForPayment(db, payment.provider);
  const outcome = (status: PaymentStatus, message: string): CaptureOutcome => ({
    paymentId: payment.id,
    status,
    mode: payment.mode,
    provider: payment.provider,
    simulated: payment.provider === "simulated",
    message,
  });

  if (PAYMENT_SUCCESS.includes(payment.status)) return outcome(payment.status, "Already captured.");
  if (payment.status === "CAPTURE_PROVIDER_PENDING") {
    const s = await reconcilePayment(db, payment.id, { gateway, now: () => now, actor: actorOf(user), correlationId });
    return outcome(s, "Capture is pending at the provider.");
  }
  if (payment.status === "CAPTURE_PENDING" || payment.status === "AUTHORIZE_PENDING") {
    if (now.getTime() - payment.updatedAt.getTime() < STALE_CAPTURE_MS) throw conflict(`${payment.status === "AUTHORIZE_PENDING" ? "Authorization" : "Capture"} already in progress.`);
    return resumeInterruptedCapture(db, payment, gateway, { actor: actorOf(user), correlationId, now, outcome });
  }
  if (payment.status === "AUTHORIZED") return outcome(payment.status, "Hold already placed. Settle the final amount or release the hold.");
  if (payment.status !== "CHECKOUT_PENDING") throw conflict(`Payment is ${payment.status}; it cannot be captured.`);
  if (!payment.providerOrderId) throw precondition("Payment has no provider order.");

  // Gate 2 (part 1): PayPal buyer approval, verified server-side.
  let order: ProviderOrder;
  try {
    order = await gateway.getOrder(payment.providerOrderId);
  } catch (err) {
    providerFailure(err);
  }
  const intent = intentOf(payment);
  const inFlight = intent === "AUTHORIZE" ? "AUTHORIZE_PENDING" : "CAPTURE_PENDING";
  if (order.status === "COMPLETED") {
    // Captured/authorized outside this request (e.g. an earlier attempt). Record it; never twice.
    await db.$transaction(async (tx) => {
      await casPayment(tx, { id: payment.id, from: "CHECKOUT_PENDING", to: inFlight, version: payment.version });
      await appendAudit(tx, { missionId: payment.missionId, ownerId: user.id, actor: actorOf(user), eventType: "payment.capture_reconcile_started", resource: `payment:${payment.id}`, outcome: "INFO", correlationId, metadata: { paymentId: payment.id, orderStatus: order.status }, mode: payment.mode });
    });
    const s = await finalizeFromOrder(db, payment.id, order, { actor: "provider:" + payment.provider, correlationId });
    return outcome(s, "Order was already captured at the provider; recorded.");
  }
  if (order.status !== "APPROVED") {
    if (now.getTime() - payment.createdAt.getTime() > PROVIDER_ORDER_TTL_MS) {
      await expirePayment(db, payment, "Provider order expired before buyer approval", correlationId);
      throw precondition("The provider order expired before buyer approval. Start checkout again.");
    }
    throw precondition(`Buyer has not approved the order at ${payment.provider === "simulated" ? "the simulated checkout" : "PayPal"} yet (status ${order.status}).`);
  }
  const verification = verifyOrderMatches(order, {
    orderId: payment.providerOrderId,
    amount: { currency: payment.currency, totalMinor: payment.amountMinor, itemTotalMinor: payment.itemTotalMinor, shippingMinor: payment.shippingMinor, taxMinor: payment.taxMinor },
    customId: payment.id,
    invoiceId: payment.invoiceId,
    merchantId: payment.provider === "paypal" ? getEnv().paypal.merchantId : null,
    intent,
  });
  if (!verification.ok) {
    await invalidateApproval(db, {
      approval: payment.approval,
      mission: payment.mission,
      reason: `Provider order does not match the approved purchase: ${verification.problems.join(", ")}`,
      code: "ORDER_MISMATCH",
      correlationId,
      actor: "system:payments",
      payment,
      paymentTo: "FAILED",
      missionTo: null,
    });
    throw precondition("Provider order does not match the approved purchase. Capture refused.", { problems: verification.problems });
  }

  // Gate 1: AEGIS approval — active, unexpired, snapshot hash matches freshly recomputed data.
  const purchase = await loadPurchase(db, payment.mission, payment.productId);
  const fresh = buildSnapshot(purchase, payment.approval.policyVersion, payment.approval.expiresAt);
  const check = checkApproval(payment.approval, fresh, now);
  const amountOk = purchase.amounts.totalMinor === payment.amountMinor;
  if (!check.ok || !amountOk) {
    const reason = !check.ok ? check.reason : "Stored payment amount differs from the purchase.";
    await invalidateApproval(db, {
      approval: payment.approval,
      mission: payment.mission,
      reason,
      code: !check.ok ? check.code : "AMOUNT_MISMATCH",
      correlationId,
      actor: "system:payments",
      payment,
      paymentTo: !check.ok && check.code === "EXPIRED" ? "EXPIRED" : "CANCELLED",
    });
    throw precondition(`${reason} Re-approval required.`, { code: !check.ok ? check.code : "AMOUNT_MISMATCH" });
  }

  // Re-evaluate against the CURRENT policy. Stricter → deny/re-approve; looser never upgrades.
  const current = await evaluateCurrent(db, purchase, now);
  const re = reevaluateApproval(current.evaluation.decision, payment.approval.kind);
  if (!re.ok) {
    await invalidateApproval(db, {
      approval: payment.approval,
      mission: payment.mission,
      reason: `${re.reason} (policy v${current.policyVersion})`,
      code: re.outcome,
      correlationId,
      actor: "system:policy-guard",
      payment,
      paymentTo: re.outcome === "BLOCKED" ? "BLOCKED" : "CANCELLED",
      missionTo: re.outcome === "BLOCKED" ? "BLOCKED" : "AWAITING_APPROVAL",
    });
    throw precondition(re.reason, { code: re.outcome, reasons: current.evaluation.reasons });
  }

  // Duplicate-capture guard: compare-and-set + audit in one transaction.
  try {
    await db.$transaction(async (tx) => {
      await casPayment(tx, { id: payment.id, from: "CHECKOUT_PENDING", to: inFlight, version: payment.version });
      await appendAudit(tx, {
        missionId: payment.missionId,
        ownerId: user.id,
        actor: actorOf(user),
        eventType: intent === "AUTHORIZE" ? "payment.authorize_started" : "payment.capture_started",
        resource: `payment:${payment.id}`,
        outcome: "INFO",
        correlationId,
        metadata: { paymentId: payment.id, approvalId: payment.approvalId, providerOrderId: payment.providerOrderId, amountMinor: payment.amountMinor, currency: payment.currency, intent, policyVersion: current.policyVersion, from: "CHECKOUT_PENDING", to: inFlight, simulated: payment.provider === "simulated" },
        mode: payment.mode,
      });
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "CONFLICT") throw conflict(`${intent === "AUTHORIZE" ? "Authorization" : "Capture"} already in progress or completed (duplicate request rejected).`);
    throw err;
  }

  if (intent === "AUTHORIZE") return performAuthorize(db, payment, gateway, { actor: actorOf(user), correlationId, outcome });
  return performCapture(db, payment, gateway, { actor: actorOf(user), correlationId, crash: deps.crashAfterProviderCapture, outcome });
}

async function performAuthorize(
  db: Db,
  payment: Payment,
  gateway: PaymentGateway,
  ctx: { actor: string; correlationId: string; outcome: (s: PaymentStatus, m: string) => CaptureOutcome },
): Promise<CaptureOutcome> {
  let order: ProviderOrder;
  try {
    order = await gateway.authorizeOrder(payment.providerOrderId as string, payment.captureRequestId);
  } catch (err) {
    if (err instanceof ProviderError && err.issue === "ORDER_ALREADY_AUTHORIZED") {
      const fetched = await gateway.getOrder(payment.providerOrderId as string);
      const s = await finalizeFromOrder(db, payment.id, fetched, { actor: `provider:${payment.provider}`, correlationId: ctx.correlationId });
      return ctx.outcome(s, "Order was already authorized; reconciled from provider state.");
    }
    if (err instanceof ProviderError && err.outcomeUnknown) {
      await db.$transaction((tx) =>
        appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: `provider:${payment.provider}`, eventType: "payment.authorize_outcome_unknown", resource: `payment:${payment.id}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { paymentId: payment.id, error: err.message, debugId: err.debugId }, mode: payment.mode }),
      );
      return ctx.outcome("AUTHORIZE_PENDING", "Authorization outcome unknown (provider timeout). It will be reconciled; no hold is confirmed.");
    }
    await db.$transaction(async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (p.status === "AUTHORIZE_PENDING") {
        await casPayment(tx, { id: p.id, from: "AUTHORIZE_PENDING", to: "FAILED", version: p.version, data: { statusReason: err instanceof Error ? err.message.slice(0, 300) : "authorization failed" } });
      }
      await appendAudit(tx, {
        missionId: payment.missionId,
        ownerId: null,
        actor: `provider:${payment.provider}`,
        eventType: "payment.authorize_failed",
        resource: `payment:${payment.id}`,
        outcome: "FAILURE",
        correlationId: ctx.correlationId,
        metadata: { paymentId: payment.id, from: "AUTHORIZE_PENDING", to: "FAILED", error: err instanceof Error ? err.message : String(err), errorCode: err instanceof ProviderError ? err.issue : null, debugId: err instanceof ProviderError ? err.debugId : null },
        mode: payment.mode,
      });
    });
    providerFailure(err);
  }
  const s = await finalizeFromOrder(db, payment.id, order, { actor: `provider:${payment.provider}`, correlationId: ctx.correlationId });
  return ctx.outcome(
    s,
    s === "AUTHORIZED"
      ? `${payment.provider === "simulated" ? "SIMULATED hold" : "PayPal authorization hold"} placed for at most ${formatMoney(payment.amountMinor, payment.currency)}. Settle the real amount once the seller invoices.`
      : "Authorization did not complete.",
  );
}

async function performCapture(
  db: Db,
  payment: Payment,
  gateway: PaymentGateway,
  ctx: { actor: string; correlationId: string; crash?: boolean; outcome: (s: PaymentStatus, m: string) => CaptureOutcome },
): Promise<CaptureOutcome> {
  let order: ProviderOrder;
  try {
    order = await gateway.captureOrder(payment.providerOrderId as string, payment.captureRequestId);
  } catch (err) {
    if (err instanceof ProviderError && err.issue === "ORDER_ALREADY_CAPTURED") {
      const fetched = await gateway.getOrder(payment.providerOrderId as string);
      const s = await finalizeFromOrder(db, payment.id, fetched, { actor: `provider:${payment.provider}`, correlationId: ctx.correlationId });
      return ctx.outcome(s, "Order was already captured; reconciled from provider state.");
    }
    if (err instanceof ProviderError && err.outcomeUnknown) {
      await db.$transaction((tx) =>
        appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: `provider:${payment.provider}`, eventType: "payment.capture_outcome_unknown", resource: `payment:${payment.id}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { paymentId: payment.id, error: err.message, debugId: err.debugId }, mode: payment.mode }),
      );
      return ctx.outcome("CAPTURE_PENDING", "Capture outcome unknown (provider timeout). It will be reconciled; it is NOT confirmed.");
    }
    await db.$transaction(async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (p.status === "CAPTURE_PENDING") {
        await casPayment(tx, { id: p.id, from: "CAPTURE_PENDING", to: "FAILED", version: p.version, data: { statusReason: err instanceof Error ? err.message.slice(0, 300) : "capture failed" } });
      }
      await appendAudit(tx, {
        missionId: payment.missionId,
        ownerId: null,
        actor: `provider:${payment.provider}`,
        eventType: "payment.capture_failed",
        resource: `payment:${payment.id}`,
        outcome: "FAILURE",
        correlationId: ctx.correlationId,
        metadata: { paymentId: payment.id, from: "CAPTURE_PENDING", to: "FAILED", error: err instanceof Error ? err.message : String(err), errorCode: err instanceof ProviderError ? err.issue : null, debugId: err instanceof ProviderError ? err.debugId : null },
        mode: payment.mode,
      });
    });
    providerFailure(err);
  }
  if (ctx.crash) throw new SimulatedCaptureCrash("Simulated crash after provider capture, before DB write");
  const s = await finalizeFromOrder(db, payment.id, order, { actor: `provider:${payment.provider}`, correlationId: ctx.correlationId });
  return ctx.outcome(
    s,
    s === "CAPTURED"
      ? payment.provider === "simulated"
        ? "SIMULATED capture recorded. No money moved."
        : "Captured. Confirmed by PayPal."
      : s === "CAPTURE_PROVIDER_PENDING"
        ? "PayPal accepted the capture but it is still PENDING; not complete."
        : "Capture did not complete.",
  );
}

async function resumeInterruptedCapture(
  db: Db,
  payment: Payment,
  gateway: PaymentGateway,
  ctx: { actor: string; correlationId: string; now: Date; outcome: (s: PaymentStatus, m: string) => CaptureOutcome },
): Promise<CaptureOutcome> {
  let order: ProviderOrder;
  try {
    order = await gateway.getOrder(payment.providerOrderId as string);
  } catch (err) {
    providerFailure(err);
  }
  if (order.status === "COMPLETED" || order.captures.length > 0 || order.authorizations.length > 0) {
    const s = await finalizeFromOrder(db, payment.id, order, { actor: `provider:${payment.provider}`, correlationId: ctx.correlationId });
    return ctx.outcome(s, `Recovered an interrupted ${payment.status === "AUTHORIZE_PENDING" ? "authorization" : "capture"} from provider state.`);
  }
  // Provider never captured: retry with the SAME PayPal-Request-Id (idempotent at PayPal).
  await db.$transaction(async (tx) => {
    // Touch the row (CAS no-op on status) so concurrent resumers see a fresh timestamp.
    const res = await tx.payment.updateMany({ where: { id: payment.id, status: payment.status, version: payment.version }, data: { version: { increment: 1 } } });
    if (res.count !== 1) throw conflict("Capture already being resumed.");
    await appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: ctx.actor, eventType: payment.status === "AUTHORIZE_PENDING" ? "payment.authorize_resumed" : "payment.capture_resumed", resource: `payment:${payment.id}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { paymentId: payment.id, requestId: payment.captureRequestId }, mode: payment.mode });
  });
  if (payment.status === "AUTHORIZE_PENDING") return performAuthorize(db, payment, gateway, ctx);
  return performCapture(db, payment, gateway, ctx);
}

/**
 * Applies provider truth to a payment through the monotonic state machine. Idempotent.
 * Late or out-of-order inputs that would regress a state are recorded and ignored.
 */
export async function finalizeFromOrder(db: Db, paymentId: string, order: ProviderOrder, ctx: { actor: string; correlationId: string }): Promise<PaymentStatus> {
  return db.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { mission: true, approval: true } });
    const cap = primaryCapture(order);
    const auth = primaryAuthorization(order);
    const refunded = completedRefundMinor(order);
    const authorizeIntent = p.intent === "AUTHORIZE";
    // What a capture must equal: the exact amount, or the human-entered settlement (≤ cap).
    const expectedCapture = authorizeIntent ? p.settledMinor : p.amountMinor;
    const anomaly = (reason: string, amountMinor: number | null) =>
      appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: "system:payments", eventType: "payment.capture_amount_anomaly", resource: `payment:${p.id}`, outcome: "FAILURE", correlationId: ctx.correlationId, metadata: { paymentId: p.id, amountMinor, currency: cap?.currency ?? auth?.currency ?? null, reason }, mode: p.mode });

    let target: PaymentStatus | null = null;
    if (cap) {
      if (cap.status === "COMPLETED") target = "CAPTURED";
      else if (cap.status === "PENDING") target = "CAPTURE_PROVIDER_PENDING";
      else if (cap.status === "DECLINED" || cap.status === "FAILED") target = "FAILED";
      else if (cap.status === "REFUNDED") target = "REFUNDED";
      else if (cap.status === "PARTIALLY_REFUNDED") target = "PARTIALLY_REFUNDED";
    } else if (auth && authorizeIntent) {
      if (auth.status === "CREATED") target = "AUTHORIZED";
      else if (auth.status === "VOIDED") target = "CANCELLED";
      else if (auth.status === "EXPIRED") target = "EXPIRED";
      else if (auth.status === "DENIED") target = "FAILED";
      // PENDING (under PayPal review) and CAPTURED-without-capture-record: wait for more state.
    } else if (order.status === "VOIDED") target = "FAILED";
    if (!target) return p.status;

    if (cap && target !== "FAILED") {
      if (expectedCapture == null) {
        await anomaly("A capture exists at the provider but no settlement was recorded in AEGIS; manual review required. Not marked captured.", cap.amountMinor);
        return p.status;
      }
      if (cap.amountMinor !== expectedCapture || cap.currency !== p.currency) {
        await anomaly("Captured amount differs from the approved/settled amount; manual review required. Not marked captured.", cap.amountMinor);
        return p.status;
      }
    }
    if (target === "AUTHORIZED" && (auth?.amountMinor !== p.amountMinor || auth?.currency !== p.currency)) {
      await anomaly("Authorized amount differs from the approved spending cap; manual review required. Hold not accepted.", auth?.amountMinor ?? null);
      return p.status;
    }

    const data = {
      providerCaptureId: cap?.id ?? p.providerCaptureId,
      providerStatus: cap?.status ?? auth?.status ?? order.status,
      providerAuthorizationId: auth?.id ?? p.providerAuthorizationId,
      authorizationExpiresAt: auth?.expirationTime ? new Date(auth.expirationTime) : (p.authorizationExpiresAt ?? (auth ? new Date(Date.now() + AUTHORIZATION_VALIDITY_MS) : null)),
      refundedMinor: Math.max(p.refundedMinor, refunded),
    };

    // Same status but more money refunded at the provider (e.g. a second partial refund, or one
    // issued from the PayPal dashboard): record the amount, keep the status.
    if (target === p.status) {
      if (data.refundedMinor !== p.refundedMinor) {
        const res = await tx.payment.updateMany({ where: { id: p.id, status: p.status, version: p.version }, data: { ...data, version: { increment: 1 } } });
        if (res.count !== 1) throw conflict("Payment changed concurrently");
        await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: ctx.actor, eventType: "payment.refund_reconciled", resource: `payment:${p.id}`, outcome: "SUCCESS", correlationId: ctx.correlationId, metadata: { paymentId: p.id, status: p.status, refundedMinor: data.refundedMinor, currency: p.currency, simulated: p.provider === "simulated" }, mode: p.mode });
      }
      return p.status;
    }

    // Walk legal edges only (e.g. CAPTURE_PENDING → CAPTURED → REFUNDED).
    const path: PaymentStatus[] = [];
    if (canTransitionPayment(p.status, target)) path.push(target);
    else if ((target === "REFUNDED" || target === "PARTIALLY_REFUNDED") && canTransitionPayment(p.status, "CAPTURED")) path.push("CAPTURED", target);
    if (path.length === 0) {
      await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: ctx.actor, eventType: "payment.transition_ignored", resource: `payment:${p.id}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { paymentId: p.id, from: p.status, to: target, reason: "Monotonic state machine: late or out-of-order provider update ignored." }, mode: p.mode });
      return p.status;
    }
    const EVENT: Partial<Record<PaymentStatus, string>> = {
      CAPTURED: "payment.captured",
      CAPTURE_PROVIDER_PENDING: "payment.capture_pending_at_provider",
      REFUNDED: "payment.refunded",
      PARTIALLY_REFUNDED: "payment.partially_refunded",
      AUTHORIZED: "payment.authorized",
      CANCELLED: "payment.hold_released",
      EXPIRED: "payment.hold_expired",
      FAILED: "payment.capture_failed",
    };
    let version = p.version;
    let from = p.status;
    for (const to of path) {
      ({ version } = await casPayment(tx, { id: p.id, from, to, version, data }));
      await appendAudit(tx, {
        missionId: p.missionId,
        ownerId: p.mission.ownerId,
        actor: ctx.actor,
        eventType: EVENT[to] ?? "payment.status_changed",
        resource: `payment:${p.id}`,
        outcome: to === "FAILED" ? "FAILURE" : to === "CANCELLED" || to === "EXPIRED" ? "INFO" : "SUCCESS",
        correlationId: ctx.correlationId,
        metadata: {
          paymentId: p.id,
          from,
          to,
          intent: p.intent,
          providerCaptureId: cap?.id ?? null,
          captureStatus: cap?.status ?? null,
          providerAuthorizationId: auth?.id ?? null,
          authorizationStatus: auth?.status ?? null,
          amountMinor: to === "AUTHORIZED" ? p.amountMinor : (expectedCapture ?? p.amountMinor),
          capMinor: authorizeIntent ? p.amountMinor : null,
          refundedMinor: data.refundedMinor,
          currency: p.currency,
          simulated: p.provider === "simulated",
          debugId: order.debugId,
        },
        mode: p.mode,
      });
      from = to;
    }
    const final = path[path.length - 1];
    const consumes: PaymentStatus[] = ["AUTHORIZED", "CAPTURED", "CAPTURE_PROVIDER_PENDING", "REFUNDED", "PARTIALLY_REFUNDED"];
    if (consumes.includes(final) && p.approval.status === "ACTIVE") {
      await casApproval(tx, { id: p.approval.id, from: "ACTIVE", to: "CONSUMED", version: p.approval.version, reason: `Consumed by payment ${p.id}` });
    }
    const m = await tx.mission.findUniqueOrThrow({ where: { id: p.missionId } });
    if ((final === "CAPTURED" || final === "REFUNDED" || final === "PARTIALLY_REFUNDED") && m.status === "READY_FOR_CHECKOUT") {
      await casMission(tx, { id: m.id, from: "READY_FOR_CHECKOUT", to: "COMPLETED", version: m.version });
      await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: "system:payments", eventType: "mission.completed", resource: `mission:${p.missionId}`, outcome: "SUCCESS", correlationId: ctx.correlationId, metadata: { from: "READY_FOR_CHECKOUT", to: "COMPLETED", paymentId: p.id, simulated: p.provider === "simulated" }, mode: p.mode });
    }
    // A released or lapsed hold ends the mission: the approval was consumed by the hold.
    if ((final === "CANCELLED" || final === "EXPIRED") && from !== p.status && m.status === "READY_FOR_CHECKOUT" && authorizeIntent && p.status === "AUTHORIZED") {
      const to = final === "EXPIRED" ? "EXPIRED" : "DENIED";
      await casMission(tx, { id: m.id, from: "READY_FOR_CHECKOUT", to, version: m.version, data: { failureReason: final === "EXPIRED" ? "Authorization hold expired before settlement." : "Authorization hold released." } });
      await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: "system:payments", eventType: "mission.closed", resource: `mission:${p.missionId}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { from: "READY_FOR_CHECKOUT", to, paymentId: p.id, reason: final === "EXPIRED" ? "hold expired" : "hold released" }, mode: p.mode });
    }
    return final;
  });
}

// ------------------------------------------------------------------------------- settlement

/**
 * Settles an authorization hold: a human enters the real final amount from the seller's
 * invoice (≤ the approved cap). AEGIS captures exactly that against the authorization with
 * final_capture=true, so PayPal releases the remainder of the hold.
 */
export async function settlePayment(db: Db, user: User, paymentId: string, finalAmountMinor: number, correlationId: string, deps: PaymentDeps = {}): Promise<CaptureOutcome> {
  const now = deps.now?.() ?? new Date();
  let payment = await loadOwnedPayment(db, user, paymentId);
  const gateway = deps.gateway ?? gatewayForPayment(db, payment.provider);
  const outcome = (status: PaymentStatus, message: string): CaptureOutcome => ({ paymentId: payment.id, status, mode: payment.mode, provider: payment.provider, simulated: payment.provider === "simulated", message });

  if (payment.intent !== "AUTHORIZE") throw conflict("This payment was captured at the exact amount; there is no hold to settle.");
  if (PAYMENT_SUCCESS.includes(payment.status)) return outcome(payment.status, "Already settled.");
  if (payment.status === "SETTLE_PENDING") {
    if (now.getTime() - payment.updatedAt.getTime() < STALE_CAPTURE_MS) throw conflict("Settlement already in progress.");
    if (payment.settledMinor !== finalAmountMinor) throw conflict(`A settlement of ${formatMoney(payment.settledMinor ?? 0, payment.currency)} is already in progress; it cannot be changed.`);
  } else {
    if (payment.status !== "AUTHORIZED") throw conflict(`Payment is ${payment.status}; only an authorization hold can be settled.`);
    if (!Number.isSafeInteger(finalAmountMinor) || finalAmountMinor <= 0) throw precondition("Final amount must be a positive amount.");
    if (finalAmountMinor > payment.amountMinor) {
      throw precondition(`Final amount ${formatMoney(finalAmountMinor, payment.currency)} exceeds the approved spending cap ${formatMoney(payment.amountMinor, payment.currency)}. A new mission and approval are required.`);
    }
    if (payment.authorizationExpiresAt && payment.authorizationExpiresAt.getTime() <= now.getTime()) {
      throw precondition("The authorization hold has expired. Reconcile the payment; a new approval is required.");
    }
    if (finalAmountMinor < payment.itemTotalMinor) {
      // Allowed (seller discount), but recorded loudly for the audit trail.
      console.warn(`[aegis] settlement below item total for payment ${payment.id}`);
    }
    const settleRequestId = randomUUID();
    await db.$transaction(async (tx) => {
      await casPayment(tx, { id: payment.id, from: "AUTHORIZED", to: "SETTLE_PENDING", version: payment.version, data: { settledMinor: finalAmountMinor, settleRequestId } });
      await appendAudit(tx, {
        missionId: payment.missionId,
        ownerId: user.id,
        actor: actorOf(user),
        eventType: "payment.settle_started",
        resource: `payment:${payment.id}`,
        outcome: "INFO",
        correlationId,
        metadata: { paymentId: payment.id, providerAuthorizationId: payment.providerAuthorizationId, settledMinor: finalAmountMinor, capMinor: payment.amountMinor, releasedMinor: payment.amountMinor - finalAmountMinor, currency: payment.currency, from: "AUTHORIZED", to: "SETTLE_PENDING", simulated: payment.provider === "simulated" },
        mode: payment.mode,
      });
    });
    payment = await loadOwnedPayment(db, user, paymentId);
  }
  if (!payment.providerAuthorizationId || !payment.settleRequestId || payment.settledMinor == null) throw precondition("Payment has no authorization to settle.");

  try {
    await gateway.captureAuthorization(payment.providerAuthorizationId, { amountMinor: payment.settledMinor, currency: payment.currency, requestId: payment.settleRequestId, finalCapture: true });
  } catch (err) {
    if (err instanceof ProviderError && err.outcomeUnknown) {
      await db.$transaction((tx) =>
        appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: `provider:${payment.provider}`, eventType: "payment.capture_outcome_unknown", resource: `payment:${payment.id}`, outcome: "INFO", correlationId, metadata: { paymentId: payment.id, error: err.message, debugId: err.debugId }, mode: payment.mode }),
      );
      return outcome("SETTLE_PENDING", "Settlement outcome unknown (provider timeout). Retry settles idempotently; it is NOT confirmed.");
    }
    await db.$transaction(async (tx) => {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (p.status === "SETTLE_PENDING") await casPayment(tx, { id: p.id, from: "SETTLE_PENDING", to: "FAILED", version: p.version, data: { statusReason: err instanceof Error ? err.message.slice(0, 300) : "settlement failed" } });
      await appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: `provider:${payment.provider}`, eventType: "payment.capture_failed", resource: `payment:${payment.id}`, outcome: "FAILURE", correlationId, metadata: { paymentId: payment.id, from: "SETTLE_PENDING", to: "FAILED", error: err instanceof Error ? err.message : String(err), errorCode: err instanceof ProviderError ? err.issue : null, debugId: err instanceof ProviderError ? err.debugId : null }, mode: payment.mode });
    });
    providerFailure(err);
  }
  // Provider truth comes from a fresh order read, never from the capture response alone.
  const order = await gateway.getOrder(payment.providerOrderId as string);
  const s = await finalizeFromOrder(db, payment.id, order, { actor: `provider:${payment.provider}`, correlationId });
  const released = payment.amountMinor - payment.settledMinor;
  return outcome(
    s,
    s === "CAPTURED"
      ? `${payment.provider === "simulated" ? "SIMULATED settlement" : "Captured by PayPal"}: ${formatMoney(payment.settledMinor, payment.currency)}. ${released > 0 ? `${formatMoney(released, payment.currency)} of the hold released.` : "Full cap used."}`
      : s === "CAPTURE_PROVIDER_PENDING"
        ? "PayPal accepted the settlement but it is still PENDING; not complete."
        : "Settlement did not complete.",
  );
}

/** Releases an authorization hold without capturing (seller cancelled, item unavailable, …). */
export async function releaseHold(db: Db, user: User, paymentId: string, reason: string, correlationId: string, deps: PaymentDeps = {}) {
  const payment = await loadOwnedPayment(db, user, paymentId);
  const gateway = deps.gateway ?? gatewayForPayment(db, payment.provider);
  if (payment.status !== "AUTHORIZED" || !payment.providerAuthorizationId) throw conflict(`Payment is ${payment.status}; only an active authorization hold can be released.`);
  try {
    await gateway.voidAuthorization(payment.providerAuthorizationId, `void-${payment.id}`);
  } catch (err) {
    providerFailure(err);
  }
  await db.$transaction((tx) =>
    appendAudit(tx, { missionId: payment.missionId, ownerId: user.id, actor: actorOf(user), eventType: "payment.hold_release_requested", resource: `payment:${payment.id}`, outcome: "INFO", correlationId, metadata: { paymentId: payment.id, providerAuthorizationId: payment.providerAuthorizationId, reason: reason.slice(0, 300), amountMinor: payment.amountMinor, currency: payment.currency }, mode: payment.mode }),
  );
  const order = await gateway.getOrder(payment.providerOrderId as string);
  const s = await finalizeFromOrder(db, payment.id, order, { actor: actorOf(user), correlationId });
  return { paymentId: payment.id, status: s };
}

// ------------------------------------------------------------------------------- refunds

const REFUNDABLE: readonly PaymentStatus[] = ["CAPTURED", "PARTIALLY_REFUNDED"];

/**
 * Refunds part or all of a captured payment. The Refund row and its PayPal-Request-Id are
 * written before the provider call; the remaining refundable amount counts in-flight refunds,
 * so concurrent requests cannot refund more than was captured.
 */
export async function refundPayment(
  db: Db,
  user: User,
  paymentId: string,
  input: { amountMinor?: number | null; reason: string },
  correlationId: string,
  deps: PaymentDeps = {},
) {
  const payment = await loadOwnedPayment(db, user, paymentId);
  const gateway = deps.gateway ?? gatewayForPayment(db, payment.provider);
  if (!REFUNDABLE.includes(payment.status)) throw conflict(`Payment is ${payment.status}; only captured payments can be refunded.`);
  if (!payment.providerCaptureId) throw precondition("Payment has no provider capture to refund.");
  const reason = input.reason.trim();
  if (reason.length < 3) throw precondition("A refund reason is required.");

  const refund = await db.$transaction(async (tx) => {
    // Bump the version so two concurrent refund requests serialise on the payment row.
    const bump = await tx.payment.updateMany({ where: { id: payment.id, status: payment.status, version: payment.version }, data: { version: { increment: 1 } } });
    if (bump.count !== 1) throw conflict("Payment changed concurrently; retry the refund.");
    const captured = payment.settledMinor ?? payment.amountMinor;
    const inFlight = await tx.refund.aggregate({ where: { paymentId: payment.id, status: { in: ["PENDING", "PROVIDER_PENDING"] } }, _sum: { amountMinor: true } });
    const remaining = captured - payment.refundedMinor - (inFlight._sum.amountMinor ?? 0);
    const amount = input.amountMinor ?? remaining;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw precondition("Nothing left to refund.");
    if (amount > remaining) throw precondition(`Refund ${formatMoney(amount, payment.currency)} exceeds the refundable ${formatMoney(remaining, payment.currency)}.`);
    const r = await tx.refund.create({ data: { paymentId: payment.id, amountMinor: amount, currency: payment.currency, reason: reason.slice(0, 300), requestedById: user.id, requestId: randomUUID(), status: "PENDING" } });
    await appendAudit(tx, { missionId: payment.missionId, ownerId: user.id, actor: actorOf(user), eventType: "payment.refund_requested", resource: `payment:${payment.id}`, outcome: "INFO", correlationId, metadata: { paymentId: payment.id, refundId: r.id, amountMinor: amount, remainingMinor: remaining - amount, currency: payment.currency, reason: r.reason, simulated: payment.provider === "simulated" }, mode: payment.mode });
    return r;
  });

  let providerRefund;
  try {
    providerRefund = await gateway.refundCapture(payment.providerCaptureId, { amountMinor: refund.amountMinor, currency: refund.currency, requestId: refund.requestId, note: refund.reason });
  } catch (err) {
    const unknown = err instanceof ProviderError && err.outcomeUnknown;
    await db.$transaction(async (tx) => {
      await tx.refund.update({ where: { id: refund.id }, data: { status: unknown ? "PROVIDER_PENDING" : "FAILED", statusReason: err instanceof Error ? err.message.slice(0, 300) : "refund failed" } });
      await appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: `provider:${payment.provider}`, eventType: unknown ? "payment.refund_outcome_unknown" : "payment.refund_failed", resource: `payment:${payment.id}`, outcome: unknown ? "INFO" : "FAILURE", correlationId, metadata: { paymentId: payment.id, refundId: refund.id, error: err instanceof Error ? err.message : String(err), errorCode: err instanceof ProviderError ? err.issue : null, debugId: err instanceof ProviderError ? err.debugId : null }, mode: payment.mode });
    });
    providerFailure(err);
  }
  await db.refund.update({
    where: { id: refund.id },
    data: { providerRefundId: providerRefund.id || null, status: providerRefund.status === "COMPLETED" ? "COMPLETED" : providerRefund.status === "PENDING" ? "PROVIDER_PENDING" : "FAILED" },
  });
  // Apply provider truth (refund totals, capture status) through the state machine.
  const order = await gateway.getOrder(payment.providerOrderId as string);
  const status = await finalizeFromOrder(db, payment.id, order, { actor: `provider:${payment.provider}`, correlationId });
  const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  return {
    paymentId: payment.id,
    refundId: refund.id,
    providerRefundId: providerRefund.id,
    refundStatus: providerRefund.status,
    amountMinor: refund.amountMinor,
    refundedMinor: after.refundedMinor,
    status,
    simulated: payment.provider === "simulated",
  };
}

async function expirePayment(db: Db, payment: Payment, reason: string, correlationId: string) {
  await db.$transaction(async (tx) => {
    await casPayment(tx, { id: payment.id, from: payment.status, to: "EXPIRED", version: payment.version, data: { statusReason: reason } });
    await appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: "system:payments", eventType: "payment.expired", resource: `payment:${payment.id}`, outcome: "INFO", correlationId, metadata: { paymentId: payment.id, from: payment.status, to: "EXPIRED", reason }, mode: payment.mode });
  });
}

/**
 * Read-side reconciliation (never calls capture): resolves stuck CAPTURE_PENDING and
 * CAPTURE_PROVIDER_PENDING payments from provider state, and expires abandoned checkouts.
 */
export async function reconcilePayment(
  db: Db,
  paymentId: string,
  ctx: { gateway?: PaymentGateway; now?: () => Date; actor?: string; correlationId?: string } = {},
): Promise<PaymentStatus> {
  const now = ctx.now?.() ?? new Date();
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const correlationId = ctx.correlationId ?? randomUUID();
  if (p.status === "CHECKOUT_PENDING" || p.status === "ORDER_CREATED") {
    if (now.getTime() - p.createdAt.getTime() > PROVIDER_ORDER_TTL_MS) {
      await expirePayment(db, p, "Provider order approval window elapsed", correlationId);
      return "EXPIRED";
    }
    return p.status;
  }
  const stale =
    (p.status === "CAPTURE_PENDING" || p.status === "AUTHORIZE_PENDING" || p.status === "SETTLE_PENDING") && now.getTime() - p.updatedAt.getTime() >= STALE_CAPTURE_MS;
  // An open hold is re-read so voids/expiry/out-of-band captures at PayPal are reflected.
  const holdCheck = p.status === "AUTHORIZED";
  if (!(stale || holdCheck || p.status === "CAPTURE_PROVIDER_PENDING") || !p.providerOrderId) return p.status;
  const gateway = ctx.gateway ?? gatewayForPayment(db, p.provider);
  const order = await gateway.getOrder(p.providerOrderId);
  return finalizeFromOrder(db, p.id, order, { actor: ctx.actor ?? "system:reconciler", correlationId });
}

export async function reconcileMissionPayments(db: Db, missionId: string): Promise<void> {
  const pending = await db.payment.findMany({
    where: { missionId, status: { in: ["ORDER_CREATED", "CHECKOUT_PENDING", "CAPTURE_PENDING", "CAPTURE_PROVIDER_PENDING", "AUTHORIZE_PENDING", "SETTLE_PENDING"] } },
  });
  for (const p of pending) {
    try {
      await reconcilePayment(db, p.id);
    } catch (err) {
      console.warn(`[aegis] reconcile skipped for payment ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export async function cancelPayment(db: Db, user: User, paymentId: string, correlationId: string) {
  const p = await loadOwnedPayment(db, user, paymentId);
  if (!["APPROVED", "ORDER_CREATED", "CHECKOUT_PENDING"].includes(p.status)) throw conflict(`Payment is ${p.status}; it cannot be cancelled.`);
  await db.$transaction(async (tx) => {
    await casPayment(tx, { id: p.id, from: p.status, to: "CANCELLED", version: p.version, data: { statusReason: "Buyer cancelled checkout" } });
    await appendAudit(tx, { missionId: p.missionId, ownerId: user.id, actor: actorOf(user), eventType: "payment.cancelled", resource: `payment:${p.id}`, outcome: "INFO", correlationId, metadata: { paymentId: p.id, from: p.status, to: "CANCELLED" }, mode: p.mode });
  });
  return { paymentId: p.id, status: "CANCELLED" as const };
}

/** DEMO only: stands in for the buyer approving in the PayPal popup. Clearly labelled simulated. */
export async function simulateBuyerApproval(db: Db, user: User, paymentId: string, correlationId: string) {
  const p = await loadOwnedPayment(db, user, paymentId);
  if (p.provider !== "simulated") throw new AppError("FORBIDDEN", "Buyer approval can only be simulated for DEMO payments. Real PayPal approval happens in PayPal checkout.");
  if (p.status !== "CHECKOUT_PENDING" || !p.providerOrderId) throw conflict(`Payment is ${p.status}.`);
  const order = await new SimulatedGateway(db).simulateBuyerApproval(p.providerOrderId);
  await db.$transaction((tx) =>
    appendAudit(tx, { missionId: p.missionId, ownerId: user.id, actor: actorOf(user), eventType: "payment.simulated_buyer_approval", resource: `payment:${p.id}`, outcome: "INFO", correlationId, metadata: { paymentId: p.id, orderStatus: order.status, simulated: true, reason: "DEMO mode stand-in for PayPal buyer approval. No money moves." }, mode: p.mode }),
  );
  return { paymentId: p.id, orderStatus: order.status, simulated: true };
}

/** Payment ownership check usable by webhook processing (no user). */
export async function findPaymentForProviderRef(db: Db | Tx, ref: { customId?: string | null; orderId?: string | null; captureId?: string | null; authorizationId?: string | null }) {
  if (ref.customId) {
    const p = await db.payment.findUnique({ where: { id: ref.customId } });
    if (p) return p;
  }
  if (ref.orderId) {
    const p = await db.payment.findUnique({ where: { providerOrderId: ref.orderId } });
    if (p) return p;
  }
  if (ref.captureId) {
    const p = await db.payment.findFirst({ where: { providerCaptureId: ref.captureId } });
    if (p) return p;
  }
  if (ref.authorizationId) return db.payment.findFirst({ where: { providerAuthorizationId: ref.authorizationId } });
  return null;
}
