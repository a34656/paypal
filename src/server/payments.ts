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
 * Amounts always come from stored data; client input is limited to { missionId } / { paymentId }.
 */
import { randomUUID } from "node:crypto";
import type { Approval, Payment, User } from "@/generated/prisma/client";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { checkApproval } from "@/domain/approval/snapshot";
import { reevaluateApproval } from "@/domain/policy/engine";
import { canTransitionPayment, PAYMENT_IN_FLIGHT, PAYMENT_SUCCESS } from "@/domain/state/machines";
import {
  primaryCapture,
  PROVIDER_ORDER_TTL_MS,
  ProviderError,
  verifyOrderMatches,
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
          metadata: { paymentId: p.id, approvalId: approval.id, amountMinor: p.amountMinor, currency: p.currency, provider: p.provider, simulated: p.provider === "simulated", status: "APPROVED" },
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
  if (payment.status === "CAPTURE_PENDING") {
    if (now.getTime() - payment.updatedAt.getTime() < STALE_CAPTURE_MS) throw conflict("Capture already in progress.");
    return resumeInterruptedCapture(db, payment, gateway, { actor: actorOf(user), correlationId, now, outcome });
  }
  if (payment.status !== "CHECKOUT_PENDING") throw conflict(`Payment is ${payment.status}; it cannot be captured.`);
  if (!payment.providerOrderId) throw precondition("Payment has no provider order.");

  // Gate 2 (part 1): PayPal buyer approval, verified server-side.
  let order: ProviderOrder;
  try {
    order = await gateway.getOrder(payment.providerOrderId);
  } catch (err) {
    providerFailure(err);
  }
  if (order.status === "COMPLETED") {
    // Captured outside this request (e.g. an earlier attempt). Record it; never capture twice.
    await db.$transaction(async (tx) => {
      await casPayment(tx, { id: payment.id, from: "CHECKOUT_PENDING", to: "CAPTURE_PENDING", version: payment.version });
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
      await casPayment(tx, { id: payment.id, from: "CHECKOUT_PENDING", to: "CAPTURE_PENDING", version: payment.version });
      await appendAudit(tx, {
        missionId: payment.missionId,
        ownerId: user.id,
        actor: actorOf(user),
        eventType: "payment.capture_started",
        resource: `payment:${payment.id}`,
        outcome: "INFO",
        correlationId,
        metadata: { paymentId: payment.id, approvalId: payment.approvalId, providerOrderId: payment.providerOrderId, amountMinor: payment.amountMinor, currency: payment.currency, policyVersion: current.policyVersion, from: "CHECKOUT_PENDING", to: "CAPTURE_PENDING", simulated: payment.provider === "simulated" },
        mode: payment.mode,
      });
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "CONFLICT") throw conflict("Capture already in progress or completed (duplicate request rejected).");
    throw err;
  }

  return performCapture(db, payment, gateway, { actor: actorOf(user), correlationId, crash: deps.crashAfterProviderCapture, outcome });
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
  if (order.status === "COMPLETED" || order.captures.length > 0) {
    const s = await finalizeFromOrder(db, payment.id, order, { actor: `provider:${payment.provider}`, correlationId: ctx.correlationId });
    return ctx.outcome(s, "Recovered an interrupted capture from provider state.");
  }
  // Provider never captured: retry with the SAME PayPal-Request-Id (idempotent at PayPal).
  await db.$transaction(async (tx) => {
    // Touch the row (CAS no-op on status) so concurrent resumers see a fresh timestamp.
    const res = await tx.payment.updateMany({ where: { id: payment.id, status: "CAPTURE_PENDING", version: payment.version }, data: { version: { increment: 1 } } });
    if (res.count !== 1) throw conflict("Capture already being resumed.");
    await appendAudit(tx, { missionId: payment.missionId, ownerId: null, actor: ctx.actor, eventType: "payment.capture_resumed", resource: `payment:${payment.id}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { paymentId: payment.id, requestId: payment.captureRequestId }, mode: payment.mode });
  });
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
    let target: PaymentStatus | null = null;
    if (!cap) {
      if (order.status === "VOIDED") target = "FAILED";
    } else if (cap.status === "COMPLETED") target = "CAPTURED";
    else if (cap.status === "PENDING") target = "CAPTURE_PROVIDER_PENDING";
    else if (cap.status === "DECLINED" || cap.status === "FAILED") target = "FAILED";
    else if (cap.status === "REFUNDED" || cap.status === "PARTIALLY_REFUNDED") target = cap.status === "REFUNDED" ? "REFUNDED" : "CAPTURED";
    if (!target || target === p.status) return p.status;

    if (cap && (cap.amountMinor !== p.amountMinor || cap.currency !== p.currency) && target !== "FAILED") {
      await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: "system:payments", eventType: "payment.capture_amount_anomaly", resource: `payment:${p.id}`, outcome: "FAILURE", correlationId: ctx.correlationId, metadata: { paymentId: p.id, amountMinor: cap.amountMinor, currency: cap.currency, reason: "Captured amount differs from approved amount; manual review required. Not marked captured." }, mode: p.mode });
      return p.status;
    }

    // Walk legal edges only (e.g. CAPTURE_PENDING → CAPTURED → REFUNDED).
    const path: PaymentStatus[] = [];
    if (canTransitionPayment(p.status, target)) path.push(target);
    else if (target === "REFUNDED" && canTransitionPayment(p.status, "CAPTURED")) path.push("CAPTURED", "REFUNDED");
    if (path.length === 0) {
      await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: ctx.actor, eventType: "payment.transition_ignored", resource: `payment:${p.id}`, outcome: "INFO", correlationId: ctx.correlationId, metadata: { paymentId: p.id, from: p.status, to: target, reason: "Monotonic state machine: late or out-of-order provider update ignored." }, mode: p.mode });
      return p.status;
    }
    let version = p.version;
    let from = p.status;
    for (const to of path) {
      ({ version } = await casPayment(tx, { id: p.id, from, to, version, data: { providerCaptureId: cap?.id ?? null, providerStatus: cap?.status ?? order.status } }));
      await appendAudit(tx, {
        missionId: p.missionId,
        ownerId: p.mission.ownerId,
        actor: ctx.actor,
        eventType: to === "CAPTURED" ? "payment.captured" : to === "CAPTURE_PROVIDER_PENDING" ? "payment.capture_pending_at_provider" : to === "REFUNDED" ? "payment.refunded" : "payment.capture_failed",
        resource: `payment:${p.id}`,
        outcome: to === "FAILED" ? "FAILURE" : "SUCCESS",
        correlationId: ctx.correlationId,
        metadata: { paymentId: p.id, from, to, providerCaptureId: cap?.id ?? null, captureStatus: cap?.status ?? null, amountMinor: p.amountMinor, currency: p.currency, simulated: p.provider === "simulated", debugId: order.debugId },
        mode: p.mode,
      });
      from = to;
    }
    const final = path[path.length - 1];
    if ((final === "CAPTURED" || final === "CAPTURE_PROVIDER_PENDING" || final === "REFUNDED") && p.approval.status === "ACTIVE") {
      await casApproval(tx, { id: p.approval.id, from: "ACTIVE", to: "CONSUMED", version: p.approval.version, reason: `Consumed by payment ${p.id}` });
    }
    if ((final === "CAPTURED" || final === "REFUNDED") && p.mission.status === "READY_FOR_CHECKOUT") {
      await casMission(tx, { id: p.missionId, from: "READY_FOR_CHECKOUT", to: "COMPLETED", version: p.mission.version });
      await appendAudit(tx, { missionId: p.missionId, ownerId: p.mission.ownerId, actor: "system:payments", eventType: "mission.completed", resource: `mission:${p.missionId}`, outcome: "SUCCESS", correlationId: ctx.correlationId, metadata: { from: "READY_FOR_CHECKOUT", to: "COMPLETED", paymentId: p.id, simulated: p.provider === "simulated" }, mode: p.mode });
    }
    return final;
  });
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
  const stale = p.status === "CAPTURE_PENDING" && now.getTime() - p.updatedAt.getTime() >= STALE_CAPTURE_MS;
  if (!(stale || p.status === "CAPTURE_PROVIDER_PENDING") || !p.providerOrderId) return p.status;
  const gateway = ctx.gateway ?? gatewayForPayment(db, p.provider);
  const order = await gateway.getOrder(p.providerOrderId);
  return finalizeFromOrder(db, p.id, order, { actor: ctx.actor ?? "system:reconciler", correlationId });
}

export async function reconcileMissionPayments(db: Db, missionId: string): Promise<void> {
  const pending = await db.payment.findMany({ where: { missionId, status: { in: ["ORDER_CREATED", "CHECKOUT_PENDING", "CAPTURE_PENDING", "CAPTURE_PROVIDER_PENDING"] } } });
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
export async function findPaymentForProviderRef(db: Db | Tx, ref: { customId?: string | null; orderId?: string | null; captureId?: string | null }) {
  if (ref.customId) {
    const p = await db.payment.findUnique({ where: { id: ref.customId } });
    if (p) return p;
  }
  if (ref.orderId) {
    const p = await db.payment.findUnique({ where: { providerOrderId: ref.orderId } });
    if (p) return p;
  }
  if (ref.captureId) return db.payment.findFirst({ where: { providerCaptureId: ref.captureId } });
  return null;
}
