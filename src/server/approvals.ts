import "server-only";
/**
 * Human approval gate. Only reachable from an authenticated, CSRF-checked route; agents and
 * the orchestrator have no path here. The approval binds to the exact purchase through the
 * snapshot hash, to the policy version in force, and to an expiry.
 *
 *  - REQUIRE_APPROVAL → needs a user holding the APPROVER role (kind APPROVER_APPROVAL)
 *  - ALLOW_CHECKOUT   → still needs the owner's explicit authorization (kind AUTHORIZATION)
 *  - BLOCK            → cannot be approved by anyone (re-evaluated server-side here)
 */
import type { Mission, MissionProduct, Product, User } from "@/generated/prisma/client";
import { snapshotHash, type ApprovalSnapshot } from "@/domain/approval/snapshot";
import { evaluate, type PolicyEvaluation } from "@/domain/policy/engine";
import { allInTotal } from "@/lib/money";
import { appendAudit } from "./audit";
import { casApproval, casMission, casPayment } from "./cas";
import type { Db, Tx } from "./db";
import { AppError, conflict, forbidden, precondition } from "./errors";
import { confirmedConstraints, loadOwnedMission } from "./missions";
import { duplicateDetected, snapshotFor } from "./orchestrator";
import { latestPolicy } from "./policies";
import { actorOf, hasRole } from "./users";

export interface PurchaseContext {
  mission: Mission;
  mp: MissionProduct & { product: Product };
  amounts: { itemTotalMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number };
}

/** Recomputes the purchase from stored data. Never trusts client-provided amounts. */
export async function loadPurchase(db: Db | Tx, mission: Mission, productId?: string | null): Promise<PurchaseContext> {
  const pid = productId ?? mission.recommendedProductId;
  if (!pid) throw precondition("Mission has no recommended purchase");
  const mp = await db.missionProduct.findUnique({ where: { missionId_productId: { missionId: mission.id, productId: pid } }, include: { product: true } });
  if (!mp) throw precondition("Purchase not found on this mission");
  const c = confirmedConstraints(mission);
  const breakdown = allInTotal({ unitPriceMinor: mp.product.unitPriceMinor, quantity: c.quantity, shippingMinor: mp.product.shippingMinor, taxMinor: mp.product.taxMinor });
  if (!breakdown) throw precondition("All-in total is unknown; this purchase cannot be authorised.");
  if (mp.totalMinor !== breakdown.totalMinor) throw conflict("Stored total no longer matches product data; re-run the mission.");
  return { mission, mp, amounts: breakdown };
}

export function buildSnapshot(p: PurchaseContext, policyVersion: number, expiresAt: Date): ApprovalSnapshot {
  const c = confirmedConstraints(p.mission);
  return {
    missionId: p.mission.id,
    productId: p.mp.productId,
    providerProductId: p.mp.product.providerProductId,
    sellerId: p.mp.product.sellerId,
    quantity: c.quantity,
    unitPriceMinor: p.mp.product.unitPriceMinor,
    shippingMinor: p.amounts.shippingMinor,
    taxMinor: p.amounts.taxMinor,
    totalMinor: p.amounts.totalMinor,
    currency: p.mp.product.currency,
    policyVersion,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Fresh policy evaluation of the stored purchase against the CURRENT policy. */
export async function evaluateCurrent(db: Db | Tx, p: PurchaseContext, now: Date): Promise<{ evaluation: PolicyEvaluation; policyVersion: number; ttlMinutes: number; fingerprint: string | null }> {
  const c = confirmedConstraints(p.mission);
  const { row, config } = await latestPolicy(db, p.mission.ownerId);
  const dup = await duplicateDetected(db, {
    ownerId: p.mission.ownerId,
    missionId: p.mission.id,
    providerProductId: p.mp.product.providerProductId,
    quantity: c.quantity,
    totalMinor: p.amounts.totalMinor,
    currency: c.currency,
    windowHours: config.duplicateWindowHours,
    now,
  });
  const evaluation = evaluate(snapshotFor(c, p.mp.product, p.mp), config, { duplicateDetected: dup.detected });
  return { evaluation, policyVersion: row.version, ttlMinutes: config.approvalTtlMinutes, fingerprint: dup.fingerprint };
}

export async function approvePurchase(
  db: Db,
  user: User,
  missionId: string,
  input: { productId: string; expectedTotalMinor: number },
  correlationId: string,
  now = new Date(),
) {
  const mission = await loadOwnedMission(db, user, missionId);
  if (mission.status !== "AWAITING_APPROVAL" && mission.status !== "READY_FOR_CHECKOUT") {
    throw conflict(`Mission is ${mission.status}; nothing to approve.`);
  }
  if (input.productId !== mission.recommendedProductId) throw conflict("Only the recommended purchase can be approved.");
  const purchase = await loadPurchase(db, mission, input.productId);
  if (purchase.amounts.totalMinor !== input.expectedTotalMinor) {
    throw conflict("The purchase amount changed since you reviewed it. Review again before approving.");
  }

  const { evaluation, policyVersion, ttlMinutes, fingerprint } = await evaluateCurrent(db, purchase, now);
  if (evaluation.decision === "BLOCK") {
    await db.$transaction(async (tx) => {
      await appendAudit(tx, {
        missionId,
        ownerId: user.id,
        actor: actorOf(user),
        eventType: "approval.rejected_by_policy",
        resource: `mission:${missionId}`,
        outcome: "BLOCKED",
        correlationId,
        metadata: { decision: "BLOCK", reasons: evaluation.reasons, policyVersion },
        mode: mission.mode,
      });
    });
    throw new AppError("PRECONDITION_FAILED", "Current policy blocks this purchase. It cannot be approved.", { reasons: evaluation.reasons });
  }
  // Most restrictive wins: if either the original or the current evaluation required approval, it is required.
  const needsApprover = evaluation.decision === "REQUIRE_APPROVAL" || mission.decision === "REQUIRE_APPROVAL" || mission.status === "AWAITING_APPROVAL";
  if (needsApprover && !hasRole(user, "APPROVER")) throw forbidden("This purchase requires a user with the APPROVER role.");
  const kind = needsApprover ? "APPROVER_APPROVAL" : "AUTHORIZATION";

  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);
  const snapshot = buildSnapshot(purchase, policyVersion, expiresAt);
  const hash = snapshotHash(snapshot);

  return db.$transaction(async (tx) => {
    // Expire / supersede any previous ACTIVE approval (partial unique index allows one).
    const prev = await tx.approval.findFirst({ where: { missionId, status: "ACTIVE" } });
    if (prev) {
      if (prev.expiresAt > now && prev.snapshotHash) {
        const inflight = await tx.payment.count({ where: { approvalId: prev.id, status: { in: ["ORDER_CREATED", "CHECKOUT_PENDING", "CAPTURE_PENDING", "CAPTURE_PROVIDER_PENDING"] } } });
        if (inflight > 0) throw conflict("A checkout is already in progress under the existing approval.");
      }
      await casApproval(tx, { id: prev.id, from: "ACTIVE", to: prev.expiresAt <= now ? "EXPIRED" : "REVOKED", version: prev.version, reason: "Superseded by a new approval" });
    }
    const approval = await tx.approval.create({
      data: {
        missionId,
        productId: purchase.mp.productId,
        approvedById: user.id,
        kind,
        decisionAtApproval: evaluation.decision,
        snapshot: snapshot as unknown as object,
        snapshotHash: hash,
        approvedAmountMinor: purchase.amounts.totalMinor,
        currency: snapshot.currency,
        policyVersion,
        fingerprint: fingerprint ?? "",
        expiresAt,
      },
    });
    if (mission.status === "AWAITING_APPROVAL") {
      await casMission(tx, { id: missionId, from: "AWAITING_APPROVAL", to: "READY_FOR_CHECKOUT", version: mission.version });
    }
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: kind === "APPROVER_APPROVAL" ? "approval.granted" : "approval.authorized",
      resource: `approval:${approval.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: {
        approvalId: approval.id,
        kind,
        approvedBy: user.displayName,
        roles: user.roles,
        productId: purchase.mp.productId,
        totalMinor: purchase.amounts.totalMinor,
        currency: snapshot.currency,
        policyVersion,
        decision: evaluation.decision,
        snapshotHash: hash,
        expiresAt: expiresAt.toISOString(),
        from: mission.status,
        to: "READY_FOR_CHECKOUT",
      },
      mode: mission.mode,
    });
    return approval;
  });
}

export async function denyMission(db: Db, user: User, missionId: string, reason: string, correlationId: string) {
  const mission = await loadOwnedMission(db, user, missionId);
  if (mission.status !== "AWAITING_APPROVAL" && mission.status !== "READY_FOR_CHECKOUT") {
    throw conflict(`Mission is ${mission.status}; it cannot be denied.`);
  }
  const inflight = await db.payment.count({ where: { missionId, status: { in: ["CAPTURE_PENDING", "CAPTURE_PROVIDER_PENDING", "CAPTURED"] } } });
  if (inflight > 0) throw conflict("A capture is in progress or complete; the mission can no longer be denied.");
  return db.$transaction(async (tx) => {
    const active = await tx.approval.findMany({ where: { missionId, status: "ACTIVE" } });
    for (const a of active) await casApproval(tx, { id: a.id, from: "ACTIVE", to: "REVOKED", version: a.version, reason: "Mission denied" });
    const open = await tx.payment.findMany({ where: { missionId, status: { in: ["APPROVED", "ORDER_CREATED", "CHECKOUT_PENDING"] } } });
    for (const p of open) {
      await casPayment(tx, { id: p.id, from: p.status, to: "CANCELLED", version: p.version, data: { statusReason: "Mission denied" } });
    }
    await casMission(tx, { id: missionId, from: mission.status, to: "DENIED", version: mission.version, data: { failureReason: reason } });
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "approval.denied",
      resource: `mission:${missionId}`,
      outcome: "DENIED",
      correlationId,
      metadata: { from: mission.status, to: "DENIED", reason, count: active.length },
      mode: mission.mode,
    });
    return tx.mission.findUniqueOrThrow({ where: { id: missionId } });
  });
}
