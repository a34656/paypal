import "server-only";
import type { Mission, User } from "@/generated/prisma/client";
import { missionConstraintsSchema, type MissionConstraints } from "@/domain/types";
import { deriveDisplayStatus, PAYMENT_LIVE } from "@/domain/state/machines";
import { currentMode } from "@/lib/env";
import { appendAudit } from "./audit";
import { casMission } from "./cas";
import type { Db } from "./db";
import { AppError, notFound } from "./errors";
import { actorOf } from "./users";
import { getAiProvider } from "./ai/gemini";

export const MAX_LLM_CALLS_PER_MISSION = 3;

/** Ownership middleware for every mission-scoped route. Unknown and foreign ids look the same. */
export async function loadOwnedMission(db: Db, user: Pick<User, "id">, missionId: string): Promise<Mission> {
  const m = await db.mission.findUnique({ where: { id: missionId } });
  if (!m || m.ownerId !== user.id) throw notFound("Mission");
  return m;
}

export function confirmedConstraints(m: Mission): MissionConstraints {
  const parsed = missionConstraintsSchema.safeParse(m.confirmedConstraints);
  if (!parsed.success) throw new AppError("PRECONDITION_FAILED", "Mission has no confirmed constraints");
  return parsed.data;
}

export async function createMission(db: Db, user: User, text: string, correlationId: string) {
  const ai = getAiProvider();
  const proposal = await ai.interpretMission(text);
  const mode = currentMode();
  return db.$transaction(async (tx) => {
    const created = await tx.mission.create({
      data: {
        ownerId: user.id,
        title: proposal.constraints.title,
        description: proposal.constraints.objective,
        rawInputText: text,
        mode,
        llmCalls: ai.isLlm ? 1 : 0,
      },
    });
    await appendAudit(tx, {
      missionId: created.id,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "mission.created",
      resource: `mission:${created.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: { title: created.title },
      mode,
    });
    await casMission(tx, {
      id: created.id,
      from: "CREATED",
      to: "PARSED",
      version: created.version,
      data: { parsedProposal: { ...proposal.constraints, uncertain: proposal.uncertain }, parserSource: proposal.source },
    });
    await appendAudit(tx, {
      missionId: created.id,
      ownerId: user.id,
      actor: ai.isLlm ? "agent:mission-interpreter(llm)" : "agent:mission-interpreter(deterministic)",
      eventType: "mission.parsed",
      resource: `mission:${created.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: {
        from: "CREATED",
        to: "PARSED",
        parserSource: proposal.source,
        budgetMinor: proposal.constraints.budgetMinor,
        currency: proposal.constraints.currency,
        quantity: proposal.constraints.quantity,
        reason: "Proposal only. Awaiting user confirmation; raw text never reaches the policy engine.",
      },
      mode,
    });
    return tx.mission.findUniqueOrThrow({ where: { id: created.id } });
  });
}

export async function confirmMission(db: Db, user: User, missionId: string, input: unknown, correlationId: string) {
  const constraints = missionConstraintsSchema.parse(input);
  const m = await loadOwnedMission(db, user, missionId);
  if (m.status !== "PARSED") throw new AppError("CONFLICT", `Mission is ${m.status}; only a parsed mission can be confirmed.`);
  const proposal = (m.parsedProposal ?? {}) as Record<string, unknown>;
  const edited = (Object.keys(constraints) as (keyof MissionConstraints)[]).filter(
    (k) => JSON.stringify(proposal[k]) !== JSON.stringify(constraints[k]),
  );
  return db.$transaction(async (tx) => {
    await casMission(tx, {
      id: m.id,
      from: "PARSED",
      to: "CONFIRMED",
      version: m.version,
      data: {
        confirmedConstraints: constraints,
        title: constraints.title,
        description: constraints.objective,
        budgetMinor: constraints.budgetMinor,
        currency: constraints.currency,
        quantity: constraints.quantity,
      },
    });
    await appendAudit(tx, {
      missionId: m.id,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "mission.confirmed",
      resource: `mission:${m.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: {
        from: "PARSED",
        to: "CONFIRMED",
        budgetMinor: constraints.budgetMinor,
        currency: constraints.currency,
        quantity: constraints.quantity,
        category: constraints.category,
        deadlineDays: constraints.deadlineDays,
        requiredAttributes: constraints.requiredAttributes,
        changes: edited,
      },
      mode: m.mode,
    });
    return tx.mission.findUniqueOrThrow({ where: { id: m.id } });
  });
}

export async function listMissions(db: Db, user: User, opts: { status?: string; q?: string; take: number; cursor?: string }) {
  const missions = await db.mission.findMany({
    where: {
      ownerId: user.id,
      ...(opts.q ? { title: { contains: opts.q, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take, 100) + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, mode: true, amountMinor: true } } },
  });
  const rows = missions.map((m) => {
    const p = m.payments[0] ?? null;
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      displayStatus: deriveDisplayStatus(m.status, p?.status ?? null),
      decision: m.decision,
      budgetMinor: m.budgetMinor,
      currency: m.currency,
      quantity: m.quantity,
      mode: m.mode,
      paymentStatus: p?.status ?? null,
      paymentMode: p?.mode ?? null,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  });
  const filtered = opts.status ? rows.filter((r) => r.displayStatus === opts.status) : rows;
  const hasMore = filtered.length > opts.take;
  return { items: filtered.slice(0, opts.take), nextCursor: hasMore ? filtered[opts.take - 1].id : null };
}

export async function missionDetail(db: Db, user: User, missionId: string) {
  const m = await loadOwnedMission(db, user, missionId);
  const [products, approvals, payments, runs, revisions] = await Promise.all([
    db.missionProduct.findMany({ where: { missionId }, include: { product: true }, orderBy: [{ recommendationRank: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
    db.approval.findMany({ where: { missionId }, orderBy: { createdAt: "desc" }, include: { approvedBy: { select: { displayName: true, roles: true } } } }),
    db.payment.findMany({ where: { missionId }, orderBy: { createdAt: "desc" }, include: { refunds: { orderBy: { createdAt: "asc" } } } }),
    db.agentRun.findMany({ where: { missionId }, orderBy: { startedAt: "asc" } }),
    db.mission.findMany({ where: { revisedFromId: missionId, ownerId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, decision: true, revisionNumber: true, createdAt: true } }),
  ]);
  const livePayment = payments.find((p) => PAYMENT_LIVE.includes(p.status)) ?? payments[0] ?? null;
  return {
    mission: {
      ...m,
      displayStatus: deriveDisplayStatus(m.status, livePayment?.status ?? null),
    },
    products: products.map((mp) => ({
      ...mp,
      // Derived only; never stored.
      trustScore: mp.riskScore == null ? null : 100 - mp.riskScore,
    })),
    approvals,
    payments,
    agentRuns: runs,
    revisions,
    llmCallsRemaining: Math.max(0, MAX_LLM_CALLS_PER_MISSION - m.llmCalls),
  };
}
