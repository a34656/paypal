import "server-only";
/**
 * Procurement recovery for blocked missions: diagnosis, what-if projections, linked mission
 * revisions, alternative-offer search and advisor guidance.
 *
 * Boundaries (see docs/security.md):
 *  - Read-only except reviseMission (creates a NEW linked mission; the original is never mutated)
 *    and audit events. Nothing here touches approvals, payments or policy versions.
 *  - Revisions only happen on an explicit, confirmed human request; relaxing a mandatory
 *    requirement needs a separate acknowledgement. The AI advisor cannot reach any write.
 */
import { z } from "zod";
import type { Mission, User } from "@/generated/prisma/client";
import { missionConstraintsSchema, type MissionConstraints, type ProductCandidate } from "@/domain/types";
import type { PolicyEvaluation } from "@/domain/policy/engine";
import type { RiskAssessment } from "@/domain/risk/engine";
import { analyzeRecovery, attributeStatuses, projectOffer, projectRevision, type RecoveryOffer } from "@/domain/recovery/analysis";
import { deterministicAdvice, validateAdvice } from "@/domain/recovery/advice";
import { getProductProvider, normalizeCandidate, type ProductSearch } from "@/domain/providers/product-provider";
import type { AiProvider } from "@/domain/ai/provider";
import { currentMode, getEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { appendAudit } from "./audit";
import { casMission } from "./cas";
import type { Db } from "./db";
import { AppError, conflict, precondition } from "./errors";
import { confirmedConstraints, loadOwnedMission, MAX_LLM_CALLS_PER_MISSION } from "./missions";
import { applyTrustedDomains, toCandidate, withTimeout } from "./orchestrator";
import { latestPolicy, policyByVersion } from "./policies";
import { actorOf } from "./users";
import { getAiProvider } from "./ai/gemini";

/** Missions a user may revise: finished without a purchase. */
export const REVISABLE_STATUSES = ["BLOCKED", "DENIED", "EXPIRED", "FAILED"] as const;

// ------------------------------------------------------------------------------------ context

async function loadContext(db: Db, user: User, missionId: string) {
  const mission = await loadOwnedMission(db, user, missionId);
  const c = confirmedConstraints(mission);
  const [mps, current] = await Promise.all([
    db.missionProduct.findMany({ where: { missionId }, include: { product: true }, orderBy: { createdAt: "asc" } }),
    latestPolicy(db, mission.ownerId),
  ]);
  const evaluated = mission.policyVersion ? await policyByVersion(db, mission.ownerId, mission.policyVersion) : current.config;
  const offers: RecoveryOffer[] = mps.map((mp) => ({
    id: mp.id,
    productId: mp.productId,
    candidate: toCandidate(mp.product),
    totalMinor: mp.totalMinor,
    amountBasis: mp.amountBasis === "CAP" ? "CAP" : mp.amountBasis === "EXACT" ? "EXACT" : null,
    allowanceMinor: mp.allowanceMinor,
    riskScore: mp.riskScore,
    evidenceCoverage: mp.evidenceCoverage,
    risk: (mp.riskEvidence ?? null) as RiskAssessment | null,
    eligible: mp.eligible,
    ineligibleReasons: Array.isArray(mp.ineligibleReasons) ? (mp.ineligibleReasons as string[]) : [],
    evaluation: (mp.policyResult ?? null) as PolicyEvaluation | null,
    quotedAt: mp.createdAt.toISOString(),
  }));
  return { mission, c, offers, current, evaluated };
}

function analysisFor(ctx: Awaited<ReturnType<typeof loadContext>>, marginPct: number | undefined, now: Date) {
  return analyzeRecovery({
    constraints: ctx.c,
    evaluatedPolicy: ctx.evaluated,
    evaluatedPolicyVersion: ctx.mission.policyVersion,
    currentPolicy: ctx.current.config,
    currentPolicyVersion: ctx.current.row.version,
    missionVersion: ctx.mission.version,
    decision: ctx.mission.decision,
    offers: ctx.offers,
    now,
    marginPct,
  });
}

export async function getRecovery(db: Db, user: User, missionId: string, opts: { marginPct?: number; now?: Date } = {}) {
  const ctx = await loadContext(db, user, missionId);
  const analysis = analysisFor(ctx, opts.marginPct, opts.now ?? new Date());
  const [overrides, revisions] = await Promise.all([
    db.policyOverrideRequest.findMany({ where: { missionId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.mission.findMany({ where: { revisedFromId: missionId, ownerId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, decision: true, revisionNumber: true, createdAt: true, budgetMinor: true, quantity: true } }),
  ]);
  const env = getEnv();
  return {
    analysis,
    constraints: ctx.c,
    mission: { id: ctx.mission.id, status: ctx.mission.status, version: ctx.mission.version, revisedFromId: ctx.mission.revisedFromId, revisionNumber: ctx.mission.revisionNumber },
    canRevise: (REVISABLE_STATUSES as readonly string[]).includes(ctx.mission.status),
    policyCapMinor: ctx.current.config.maxMissionBudgetMinor,
    overrides: overrides.map(overrideView),
    revisions,
    advisor: { llmConfigured: env.ai.configured, llmCallsRemaining: Math.max(0, MAX_LLM_CALLS_PER_MISSION - ctx.mission.llmCalls) },
    overrideReviewersConfigured: env.policyAdminIds.length > 0,
  };
}

export function overrideView(r: {
  id: string;
  status: string;
  challengedChecks: unknown;
  currentBudgetMinor: number;
  proposedBudgetMinor: number | null;
  currency: string;
  proposedChange: string | null;
  justification: string;
  missionVersion: number;
  policyVersion: number;
  requestedById: string;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    status: r.status,
    challengedChecks: r.challengedChecks as { checkId: string; label: string; policyField: string | null; offers: { productId: string; title: string; detail: string }[] }[],
    currentBudgetMinor: r.currentBudgetMinor,
    proposedBudgetMinor: r.proposedBudgetMinor,
    currency: r.currency,
    proposedChange: r.proposedChange,
    justification: r.justification,
    missionVersion: r.missionVersion,
    policyVersion: r.policyVersion,
    requestedById: r.requestedById,
    reviewedById: r.reviewedById,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt,
    createdAt: r.createdAt,
  };
}

// ------------------------------------------------------------------------------------ revisions

/** Only these mission fields can be changed by a recovery revision. */
export const revisionChangesSchema = missionConstraintsSchema
  .pick({ budgetMinor: true, quantity: true, deadlineDays: true, requiredAttributes: true, productQuery: true, maxRiskScore: true })
  .partial()
  .strict();
export type RevisionChanges = z.infer<typeof revisionChangesSchema>;

export interface ConstraintChange {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  display: { before: string; after: string };
  /** Loosens an explicitly mandatory requirement (needs a separate acknowledgement). */
  relaxesMandatory: boolean;
}

export function diffConstraints(a: MissionConstraints, b: MissionConstraints): ConstraintChange[] {
  const out: ConstraintChange[] = [];
  const cur = a.currency;
  if (a.budgetMinor !== b.budgetMinor)
    out.push({ field: "budgetMinor", label: "Budget", before: a.budgetMinor, after: b.budgetMinor, display: { before: formatMoney(a.budgetMinor, cur), after: formatMoney(b.budgetMinor, cur) }, relaxesMandatory: false });
  if (a.quantity !== b.quantity) out.push({ field: "quantity", label: "Quantity", before: a.quantity, after: b.quantity, display: { before: String(a.quantity), after: String(b.quantity) }, relaxesMandatory: false });
  if (a.deadlineDays !== b.deadlineDays)
    out.push({ field: "deadlineDays", label: "Delivery deadline", before: a.deadlineDays, after: b.deadlineDays, display: { before: a.deadlineDays == null ? "none" : `${a.deadlineDays} days`, after: b.deadlineDays == null ? "none" : `${b.deadlineDays} days` }, relaxesMandatory: false });
  if (a.productQuery !== b.productQuery) out.push({ field: "productQuery", label: "Search query", before: a.productQuery, after: b.productQuery, display: { before: a.productQuery, after: b.productQuery }, relaxesMandatory: false });
  if ((a.maxRiskScore ?? null) !== (b.maxRiskScore ?? null)) {
    const loosens = a.maxRiskScore != null && (b.maxRiskScore == null || b.maxRiskScore > a.maxRiskScore);
    out.push({ field: "maxRiskScore", label: "Mission risk tolerance", before: a.maxRiskScore ?? null, after: b.maxRiskScore ?? null, display: { before: a.maxRiskScore == null ? "policy default" : `max ${a.maxRiskScore}`, after: b.maxRiskScore == null ? "policy default" : `max ${b.maxRiskScore}` }, relaxesMandatory: loosens });
  }
  const keys = new Set([...Object.keys(a.requiredAttributes), ...Object.keys(b.requiredAttributes)]);
  for (const k of [...keys].sort()) {
    const before = a.requiredAttributes[k] ?? null;
    const after = b.requiredAttributes[k] ?? null;
    if (before === after) continue;
    out.push({
      field: `requiredAttributes.${k}`,
      label: `Requirement "${k}"`,
      before,
      after,
      display: { before: before == null ? "not required" : `${before} (required)`, after: after == null ? "optional (not verified)" : `${after} (required)` },
      // Removing or changing a stated requirement loosens it; adding one only tightens.
      relaxesMandatory: before != null,
    });
  }
  return out;
}

function applyChanges(c: MissionConstraints, changes: RevisionChanges): MissionConstraints {
  return missionConstraintsSchema.parse({ ...c, ...changes });
}

/** Read-only preview of a proposed revision: diff + projection on the offers already found. */
export async function previewRevision(db: Db, user: User, missionId: string, rawChanges: unknown) {
  const changes = revisionChangesSchema.parse(rawChanges);
  const ctx = await loadContext(db, user, missionId);
  const next = applyChanges(ctx.c, changes);
  const diff = diffConstraints(ctx.c, next);
  const warnings: string[] = [];
  if (next.budgetMinor > ctx.current.config.maxMissionBudgetMinor) {
    warnings.push(`Budget exceeds the policy mission cap ${formatMoney(ctx.current.config.maxMissionBudgetMinor, next.currency)}: the policy floor would block it. Only the policy owner can raise the cap.`);
  }
  if (diff.some((d) => d.field === "productQuery")) warnings.push("The search query changed: the revised mission will search the provider for different offers, so this projection is only indicative.");
  return {
    diff,
    relaxations: diff.filter((d) => d.relaxesMandatory),
    warnings,
    projection: projectRevision(ctx.offers, next, ctx.current.config),
    policyVersion: ctx.current.row.version,
    policyChangedSinceEvaluation: ctx.mission.policyVersion !== ctx.current.row.version,
    missionVersion: ctx.mission.version,
  };
}

export const reviseInputSchema = z
  .object({
    changes: revisionChangesSchema,
    expectedVersion: z.number().int().min(0),
    confirm: z.literal(true),
    acknowledgeRelaxedRequirements: z.boolean().default(false),
    /** Re-run with unchanged constraints to re-fetch offers (stale or incomplete quotes). */
    refreshQuotes: z.boolean().default(false),
  })
  .strict();

/**
 * Creates a NEW linked mission (revisedFromId → original) with the revised constraints, already
 * confirmed by this explicit user action. The original keeps its constraints, decision and
 * history; both missions get audit events naming every changed field.
 */
export async function reviseMission(db: Db, user: User, missionId: string, input: z.infer<typeof reviseInputSchema>, correlationId: string): Promise<{ mission: Mission; reused: boolean }> {
  const original = await loadOwnedMission(db, user, missionId);
  if (!(REVISABLE_STATUSES as readonly string[]).includes(original.status)) {
    throw conflict(`Mission is ${original.status}; only a blocked, denied, expired or failed mission can be revised.`);
  }
  if (original.version !== input.expectedVersion) throw conflict("The mission changed since you reviewed it. Reload and review the revision again.");
  const c = confirmedConstraints(original);
  const next = applyChanges(c, input.changes);
  const diff = diffConstraints(c, next);
  const { row: policyRow, config } = await latestPolicy(db, original.ownerId);
  const policyChanged = original.policyVersion !== policyRow.version;
  if (diff.length === 0 && !policyChanged && !input.refreshQuotes) {
    throw new AppError("VALIDATION", "Nothing changed. Edit at least one constraint, refresh quotes, or wait for a policy change before re-running.");
  }
  const relaxations = diff.filter((d) => d.relaxesMandatory);
  if (relaxations.length > 0 && !input.acknowledgeRelaxedRequirements) {
    throw precondition("This revision relaxes mandatory requirements. Confirm explicitly that you accept them.", { relaxations: relaxations.map((r) => ({ field: r.field, before: r.display.before, after: r.display.after })) });
  }
  if (next.budgetMinor > config.maxMissionBudgetMinor) {
    throw new AppError("VALIDATION", `Budget ${formatMoney(next.budgetMinor, next.currency)} exceeds the policy mission cap ${formatMoney(config.maxMissionBudgetMinor, next.currency)}. Mission edits cannot raise policy limits; request a policy change instead.`);
  }

  // Idempotent double-submit: the same revision within a minute returns the existing mission.
  const recent = await db.mission.findFirst({
    where: { revisedFromId: original.id, ownerId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) }, confirmedConstraints: { equals: next as unknown as object } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return { mission: recent, reused: true };

  const mode = currentMode();
  const actor = actorOf(user);
  const mission = await db.$transaction(async (tx) => {
    const created = await tx.mission.create({
      data: {
        ownerId: user.id,
        title: next.title,
        description: next.objective,
        rawInputText: original.rawInputText,
        mode,
        revisedFromId: original.id,
        revisionNumber: original.revisionNumber + 1,
      },
    });
    const changes = diff.map((d) => ({ field: d.field, before: d.before, after: d.after, relaxesMandatory: d.relaxesMandatory }));
    await appendAudit(tx, {
      missionId: created.id,
      ownerId: user.id,
      actor,
      eventType: "mission.created",
      resource: `mission:${created.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: { title: created.title, revisedFrom: original.id, revisionNumber: created.revisionNumber },
      mode,
    });
    const v1 = await casMission(tx, { id: created.id, from: "CREATED", to: "PARSED", version: created.version, data: { parsedProposal: { ...next, uncertain: [] }, parserSource: "revision" } });
    await appendAudit(tx, {
      missionId: created.id,
      ownerId: user.id,
      actor,
      eventType: "mission.parsed",
      resource: `mission:${created.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: { from: "CREATED", to: "PARSED", parserSource: "revision", reason: `Revision of mission ${original.id}: constraints edited by the user in recovery guidance, not by an AI.` },
      mode,
    });
    await casMission(tx, {
      id: created.id,
      from: "PARSED",
      to: "CONFIRMED",
      version: v1.version,
      data: { confirmedConstraints: next, budgetMinor: next.budgetMinor, currency: next.currency, quantity: next.quantity },
    });
    await appendAudit(tx, {
      missionId: created.id,
      ownerId: user.id,
      actor,
      eventType: "mission.confirmed",
      resource: `mission:${created.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: {
        from: "PARSED",
        to: "CONFIRMED",
        budgetMinor: next.budgetMinor,
        currency: next.currency,
        quantity: next.quantity,
        category: next.category,
        deadlineDays: next.deadlineDays,
        requiredAttributes: next.requiredAttributes,
        changes: diff.map((d) => d.field),
        revisedFrom: original.id,
      },
      mode,
    });
    await appendAudit(tx, {
      missionId: original.id,
      ownerId: user.id,
      actor,
      eventType: "mission.revised",
      resource: `mission:${original.id}`,
      outcome: "SUCCESS",
      correlationId,
      metadata: {
        revisionId: created.id,
        revisionNumber: created.revisionNumber,
        missionVersion: original.version,
        evaluatedPolicyVersion: original.policyVersion,
        currentPolicyVersion: policyRow.version,
        changes,
        relaxesMandatory: relaxations.map((r) => r.field),
        acknowledgedRelaxations: input.acknowledgeRelaxedRequirements && relaxations.length > 0,
        refreshQuotes: input.refreshQuotes,
        note: "Original mission unchanged. The revision is re-evaluated from scratch under the current policy; no purchase is made.",
      },
      mode: original.mode,
    });
    return tx.mission.findUniqueOrThrow({ where: { id: created.id } });
  });
  return { mission, reused: false };
}

// ------------------------------------------------------------------------------------ alternatives

const ALTERNATIVES_TIMEOUT_MS = 20_000;

/**
 * Searches the configured product provider again for offers matching the original specification
 * and quantity, and PROJECTS each through the real engines. Nothing is persisted; no result is
 * purchasable until a revised mission runs and a human approves it.
 */
export async function searchAlternatives(db: Db, user: User, missionId: string, correlationId: string, deps: { products?: ProductSearch } = {}) {
  const ctx = await loadContext(db, user, missionId);
  const c = ctx.c;
  const provider = deps.products ?? getProductProvider();
  const trusted = new Set(ctx.current.config.trustedSellerDomains.map((d) => d.toLowerCase()));
  const refined = [c.productQuery, ...Object.values(c.requiredAttributes)].join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
  const queries = [...new Set([refined, c.productQuery])];
  const seen = new Map<string, { cand: ProductCandidate; query: string }>();
  let fallbackReason: string | null = null;
  const errors: string[] = [];
  for (const query of queries) {
    try {
      const raw = await withTimeout(provider.search({ query, category: c.category, quantity: c.quantity, currency: c.currency }), ALTERNATIVES_TIMEOUT_MS, "Alternative search");
      fallbackReason ??= provider.lastFallbackReason ?? null;
      for (const r of raw) {
        const n = normalizeCandidate(r);
        if (!n) continue;
        const key = `${n.provider}:${n.providerProductId}`;
        if (!seen.has(key)) seen.set(key, { cand: applyTrustedDomains(n, trusted), query });
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message.slice(0, 160) : "search failed");
    }
  }
  if (seen.size === 0 && errors.length > 0) throw new AppError("PROVIDER_UNAVAILABLE", `Product search failed: ${errors[0]}`);

  const evaluatedKeys = new Set(ctx.offers.map((o) => `${o.candidate.provider}:${o.candidate.providerProductId}`));
  const results = [...seen.entries()].map(([key, { cand, query }]) => {
    const offer: RecoveryOffer = {
      id: key,
      productId: key,
      candidate: cand,
      totalMinor: null,
      amountBasis: null,
      allowanceMinor: null,
      riskScore: null,
      evidenceCoverage: null,
      risk: null,
      eligible: null,
      ineligibleReasons: [],
      evaluation: null,
      quotedAt: new Date().toISOString(),
    };
    const p = projectOffer(offer, c, ctx.current.config);
    const attrs = attributeStatuses(cand, c);
    const compatibility = attrs.some((a) => a.state === "MISMATCH") ? "MISMATCH" : attrs.every((a) => a.state === "MATCH") ? "MATCH" : "UNVERIFIED";
    return {
      key,
      query,
      title: cand.title,
      sellerName: cand.sellerName,
      sellerVerification: cand.sellerVerificationStatus,
      provider: cand.provider,
      isDemoData: cand.isDemoData,
      offerUrl: cand.offerUrl ?? null,
      unitPriceMinor: cand.unitPriceMinor,
      totalMinor: p.amounts?.totalMinor ?? null,
      basis: p.amounts ? p.amounts.basis : ("UNKNOWN" as const),
      withinBudget: p.amounts != null && p.amounts.totalMinor <= c.budgetMinor,
      compatibility: compatibility as "MATCH" | "UNVERIFIED" | "MISMATCH",
      attributes: attrs,
      riskScore: p.riskScore,
      evidenceCoverage: p.evidenceCoverage,
      deliveryDays: cand.shippingEstimateDays,
      projectedDecision: p.decision,
      viable: p.viable,
      blockers: p.blockers,
      approvalReasons: p.approvalReasons,
      alreadyEvaluated: evaluatedKeys.has(key),
    };
  });
  const compatRank = { MATCH: 0, UNVERIFIED: 1, MISMATCH: 2 } as const;
  // 1 compatibility, 2 total delivered cost, 3 risk, 4 delivery evidence, 5 data completeness.
  results.sort(
    (a, b) =>
      compatRank[a.compatibility] - compatRank[b.compatibility] ||
      (a.totalMinor ?? Number.MAX_SAFE_INTEGER) - (b.totalMinor ?? Number.MAX_SAFE_INTEGER) ||
      a.riskScore - b.riskScore ||
      Number(a.deliveryDays == null) - Number(b.deliveryDays == null) ||
      b.evidenceCoverage - a.evidenceCoverage,
  );
  const top = results.slice(0, 12);
  const viable = top.filter((r) => r.viable);
  const out = {
    provider: provider.name,
    isDemo: provider.isDemo,
    fallbackReason,
    queries,
    searchedAt: new Date().toISOString(),
    total: results.length,
    viableCount: results.filter((r) => r.viable).length,
    results: top,
    /** Suggested query for a revised mission when it surfaced viable offers the original query missed. */
    suggestedQuery: viable.some((r) => r.query === refined && !r.alreadyEvaluated) && refined !== c.productQuery ? refined : null,
    note: provider.isDemo
      ? "DEMO DATA: fictional catalogue. Not live offers."
      : "Live provider results, projected through AEGIS's engines under your current policy. Not decisions: run a revised mission to evaluate and approve a purchase.",
  };
  await db.$transaction(async (tx) => {
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: actorOf(user),
      eventType: "recovery.alternatives_searched",
      resource: `mission:${missionId}`,
      outcome: "INFO",
      correlationId,
      metadata: { provider: out.provider, demo: out.isDemo, queries, results: out.total, viable: out.viableCount, fallbackReason },
      mode: ctx.mission.mode,
    });
  });
  return out;
}

// ------------------------------------------------------------------------------------ advisor

export async function recoveryAdvice(db: Db, user: User, missionId: string, correlationId: string, deps: { ai?: AiProvider; now?: Date } = {}) {
  const ctx = await loadContext(db, user, missionId);
  const analysis = analysisFor(ctx, undefined, deps.now ?? new Date());
  const ai = deps.ai ?? getAiProvider();
  let source: "llm" | "deterministic" = "deterministic";
  let problems: string[] = [];
  let advice = deterministicAdvice(analysis);
  let fallbackReason: string | null = ai.isLlm ? null : "No LLM provider configured.";
  if (ai.isLlm) {
    // Reserve one LLM call atomically against the per-mission cap.
    const reserved = await db.mission.updateMany({ where: { id: missionId, llmCalls: { lt: MAX_LLM_CALLS_PER_MISSION } }, data: { llmCalls: { increment: 1 } } });
    if (reserved.count === 1) {
      const out = await ai.adviseRecovery(analysis);
      const v = out.source === "llm" ? validateAdvice(out.raw, analysis) : { ok: true, advice: deterministicAdvice(analysis), problems: [] };
      problems = v.problems;
      if (v.ok && v.advice && out.source === "llm") {
        advice = v.advice;
        source = "llm";
      } else if (out.source === "llm") {
        fallbackReason = "The advisor's answer failed validation; showing deterministic guidance.";
      } else {
        fallbackReason = "The LLM was unavailable; showing deterministic guidance.";
      }
    } else {
      fallbackReason = `LLM call limit for this mission reached (${MAX_LLM_CALLS_PER_MISSION}); showing deterministic guidance.`;
    }
  }
  await db.$transaction(async (tx) => {
    await appendAudit(tx, {
      missionId,
      ownerId: user.id,
      actor: source === "llm" ? "agent:procurement-advisor(llm)" : "agent:procurement-advisor(deterministic)",
      eventType: "recovery.advice_generated",
      resource: `mission:${missionId}`,
      outcome: "INFO",
      correlationId,
      metadata: { source, nextAction: advice.nextAction.optionId, validationProblems: problems.slice(0, 5), fallbackReason, note: "Advisory only; cannot change constraints, decisions, policy, approvals or payments." },
      mode: ctx.mission.mode,
    });
  });
  return { advice, source, problems, fallbackReason };
}
