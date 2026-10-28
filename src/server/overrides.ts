import "server-only";
/**
 * Policy override REQUESTS. A request asks an authorised policy reviewer to look at a policy
 * decision; it is never an authorization:
 *  - no status of a request is read by the approval or payment paths (checkout stays disabled);
 *  - floor checks and the requester's own mission constraints cannot be challenged;
 *  - a reviewer must hold APPROVER, be listed in AEGIS_POLICY_ADMIN_IDS, and not be the requester
 *    (also enforced by a DB CHECK constraint); agents and the AI have no route here;
 *  - an APPROVED request changes nothing by itself. The policy owner must publish a new,
 *    versioned policy; the mission is then re-evaluated (revision) and needs human approval.
 */
import { z } from "zod";
import type { User } from "@/generated/prisma/client";
import { checkMeta } from "@/domain/recovery/constraints";
import { positiveMinorSchema } from "@/domain/types";
import { getEnv } from "@/lib/env";
import { appendAudit } from "./audit";
import type { Db } from "./db";
import { AppError, conflict, forbidden, notFound, precondition } from "./errors";
import { confirmedConstraints, loadOwnedMission } from "./missions";
import { getRecovery, overrideView } from "./recovery";
import { actorOf, hasRole } from "./users";

export const createOverrideSchema = z
  .object({
    checkIds: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
    proposedBudgetMinor: positiveMinorSchema.optional(),
    proposedChange: z.string().trim().max(500).optional(),
    justification: z.string().trim().min(20, "Explain the business need in at least 20 characters").max(2000),
  })
  .strict();

export const reviewOverrideSchema = z
  .object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().min(5).max(1000) })
  .strict();

export async function createOverrideRequest(db: Db, user: User, missionId: string, input: z.infer<typeof createOverrideSchema>, correlationId: string) {
  const mission = await loadOwnedMission(db, user, missionId);
  if (mission.status !== "BLOCKED" || mission.decision !== "BLOCK") throw conflict(`Mission is ${mission.status}; override requests apply only to blocked missions.`);
  const c = confirmedConstraints(mission);
  const { analysis } = await getRecovery(db, user, missionId);

  const checkIds = [...new Set(input.checkIds)];
  const challenged = checkIds.map((checkId) => {
    const offers = analysis.offers.filter((o) => o.blocking.some((b) => b.checkId === checkId));
    const label = offers[0]?.blocking.find((b) => b.checkId === checkId)?.label ?? checkId;
    return {
      checkId,
      label,
      policyField: checkMeta(checkId).policyField,
      overridable: checkMeta(checkId).overridable && checkMeta(checkId).policyField != null,
      offers: offers.slice(0, 10).map((o) => ({ productId: o.productId, title: o.title.slice(0, 120), detail: (o.blocking.find((b) => b.checkId === checkId)?.evidence ?? "").slice(0, 300) })),
      offerCount: offers.length,
    };
  });
  const notBlocking = challenged.filter((x) => x.offerCount === 0);
  if (notBlocking.length) throw new AppError("VALIDATION", `Not a failing check on this mission: ${notBlocking.map((x) => x.checkId).join(", ")}`);

  const refused = challenged.filter((x) => !x.overridable);
  if (refused.length) {
    const reasons = refused.map((x) => ({ checkId: x.checkId, label: x.label, reason: analysis.override.notOverridable.find((n) => n.checkId === x.checkId)?.reason ?? "This restriction cannot be overridden through the application." }));
    await db.$transaction(async (tx) => {
      await appendAudit(tx, {
        missionId,
        ownerId: user.id,
        actor: actorOf(user),
        eventType: "override.refused",
        resource: `mission:${missionId}`,
        outcome: "DENIED",
        correlationId,
        metadata: { checkIds, refused: reasons, missionVersion: mission.version, policyVersion: mission.policyVersion },
        mode: mission.mode,
      });
    });
    throw precondition(`Cannot be overridden through the application: ${reasons.map((r) => r.label).join(", ")}.`, { refused: reasons });
  }

  const pending = await db.policyOverrideRequest.findFirst({ where: { missionId, status: "PENDING_REVIEW" } });
  if (pending) throw conflict("An override request for this mission is already pending review.");

  return db.$transaction(async (tx) => {
    const row = await tx.policyOverrideRequest.create({
      data: {
        missionId,
        missionVersion: mission.version,
        policyVersion: mission.policyVersion ?? 0,
        requestedById: user.id,
        challengedChecks: challenged.map(({ checkId, label, policyField, offers }) => ({ checkId, label, policyField, offers })),
        currentBudgetMinor: c.budgetMinor,
        proposedBudgetMinor: input.proposedBudgetMinor ?? null,
        currency: c.currency,
        proposedChange: input.proposedChange || null,
        justification: input.justification,
      },
    });
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "override.requested",
      resource: `override:${row.id}`,
      outcome: "INFO",
      correlationId,
      metadata: {
        requestId: row.id,
        status: row.status,
        checkIds,
        policyFields: challenged.map((x) => x.policyField),
        affectedOffers: challenged.reduce((n, x) => n + x.offerCount, 0),
        missionVersion: mission.version,
        policyVersion: mission.policyVersion,
        currentBudgetMinor: c.budgetMinor,
        proposedBudgetMinor: input.proposedBudgetMinor ?? null,
        justification: input.justification.slice(0, 500),
        effect: "None. A request is not an authorization; checkout remains disabled.",
      },
      mode: mission.mode,
    });
    return overrideView(row);
  });
}

export async function withdrawOverride(db: Db, user: User, requestId: string, correlationId: string) {
  const row = await db.policyOverrideRequest.findUnique({ where: { id: requestId }, include: { mission: { select: { mode: true, ownerId: true } } } });
  if (!row || row.requestedById !== user.id) throw notFound("Override request");
  if (row.status !== "PENDING_REVIEW") throw conflict(`Request is ${row.status}; only a pending request can be withdrawn.`);
  return db.$transaction(async (tx) => {
    const res = await tx.policyOverrideRequest.updateMany({ where: { id: row.id, status: "PENDING_REVIEW", version: row.version }, data: { status: "WITHDRAWN", version: { increment: 1 } } });
    if (res.count !== 1) throw conflict("Request changed concurrently.");
    await appendAudit(tx, {
      missionId: row.missionId,
      ownerId: row.mission.ownerId,
      actor: actorOf(user),
      eventType: "override.withdrawn",
      resource: `override:${row.id}`,
      outcome: "INFO",
      correlationId,
      metadata: { requestId: row.id, from: "PENDING_REVIEW", to: "WITHDRAWN" },
      mode: row.mission.mode,
    });
    return overrideView(await tx.policyOverrideRequest.findUniqueOrThrow({ where: { id: row.id } }));
  });
}

const isPolicyAdmin = (user: Pick<User, "id">) => getEnv().policyAdminIds.includes(user.id);

/** Requester or configured policy administrator only; everyone else gets 404. */
export async function getOverride(db: Db, user: User, requestId: string) {
  const row = await db.policyOverrideRequest.findUnique({ where: { id: requestId } });
  if (!row || (row.requestedById !== user.id && !isPolicyAdmin(user))) throw notFound("Override request");
  return overrideView(row);
}

export async function reviewOverride(db: Db, reviewer: User, requestId: string, input: z.infer<typeof reviewOverrideSchema>, correlationId: string) {
  const row = await db.policyOverrideRequest.findUnique({ where: { id: requestId }, include: { mission: { select: { mode: true, ownerId: true } } } });
  const admin = isPolicyAdmin(reviewer);
  if (!row || (row.requestedById !== reviewer.id && !admin)) throw notFound("Override request");
  const deny = async (reason: string) => {
    await db.$transaction(async (tx) => {
      await appendAudit(tx, {
        missionId: row.missionId,
        ownerId: row.mission.ownerId,
        actor: actorOf(reviewer),
        eventType: "override.review_denied",
        resource: `override:${row.id}`,
        outcome: "DENIED",
        correlationId,
        metadata: { requestId: row.id, reason, attemptedDecision: input.decision },
        mode: row.mission.mode,
      });
    });
    throw forbidden(reason);
  };
  if (row.requestedById === reviewer.id) await deny("Separation of duties: you cannot review your own override request.");
  if (!hasRole(reviewer, "APPROVER")) await deny("Reviewing an override needs the APPROVER role.");
  if (!admin) await deny("Only a configured policy administrator can review override requests.");
  if (row.status !== "PENDING_REVIEW") throw conflict(`Request is ${row.status}; it has already been decided.`);

  return db.$transaction(async (tx) => {
    const res = await tx.policyOverrideRequest.updateMany({
      where: { id: row.id, status: "PENDING_REVIEW", version: row.version },
      data: { status: input.decision, reviewedById: reviewer.id, reviewNote: input.note, reviewedAt: new Date(), version: { increment: 1 } },
    });
    if (res.count !== 1) throw conflict("Request changed concurrently.");
    await appendAudit(tx, {
      missionId: row.missionId,
      ownerId: row.mission.ownerId,
      actor: actorOf(reviewer),
      eventType: "override.reviewed",
      resource: `override:${row.id}`,
      outcome: input.decision === "APPROVED" ? "SUCCESS" : "DENIED",
      correlationId,
      metadata: {
        requestId: row.id,
        from: "PENDING_REVIEW",
        to: input.decision,
        reviewer: reviewer.displayName,
        roles: reviewer.roles,
        policyVersion: row.policyVersion,
        missionVersion: row.missionVersion,
        effect: "None by itself. Policy changes require a new versioned policy; the mission must be re-evaluated and a human must approve the exact purchase.",
      },
      mode: row.mission.mode,
    });
    return overrideView(await tx.policyOverrideRequest.findUniqueOrThrow({ where: { id: row.id } }));
  });
}
