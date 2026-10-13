import "server-only";
/**
 * Bounded, resumable step runner ("bounded agent workflow").
 *
 * Agents here are orchestrated FUNCTIONS, not autonomous agents. Each step:
 *  - is an AgentRun row unique on (missionId, step) with a lease (lockedUntil) and attempt counter;
 *  - is idempotent: re-running a COMPLETED step returns its stored output;
 *  - has a timeout and bounded retries with backoff;
 *  - commits its mission transition + audit event in one transaction.
 * A second /execute call (or a call after a serverless timeout) resumes or reports progress;
 * it never duplicates work. No step can create orders or move money: the final step can only
 * mark the mission AWAITING_APPROVAL, BLOCKED or READY_FOR_CHECKOUT and stop.
 */
import type { Mission, MissionProduct, Product } from "@/generated/prisma/client";
import type { WorkflowStatus } from "@/generated/prisma/enums";
import { assessRisk, type RiskAssessment } from "@/domain/risk/engine";
import { optimize } from "@/domain/agents/optimizer";
import { evaluate, purchaseFingerprint, type PolicySnapshot } from "@/domain/policy/engine";
import { normalizeCandidate, getProductProvider, type ProductSearch } from "@/domain/providers/product-provider";
import { DEMO_PRODUCTS } from "@/domain/providers/demo-catalog";
import { DeterministicAi, type AiProvider } from "@/domain/ai/provider";
import type { MissionConstraints, ProductCandidate } from "@/domain/types";
import { allInTotal, formatMoney } from "@/lib/money";
import { appendAudit } from "./audit";
import { casMission } from "./cas";
import type { Db, Tx } from "./db";
import { AppError } from "./errors";
import { confirmedConstraints, MAX_LLM_CALLS_PER_MISSION } from "./missions";
import { latestPolicy } from "./policies";
import { getAiProvider } from "./ai/anthropic";

export type StepName = "SCOUT" | "RISK" | "OPTIMIZE" | "POLICY";

export const STEP_ORDER: StepName[] = ["SCOUT", "RISK", "OPTIMIZE", "POLICY"];
export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 30_000;
export const STEP_TIMEOUT_MS = 15_000;

const AGENT_OF: Record<StepName, string> = { SCOUT: "scout", RISK: "risk", OPTIMIZE: "optimizer", POLICY: "policy-guard" };

/** Status the mission must be in to START the step, the status while running, and on completion. */
const STEP_STATUS: Record<StepName, { ready: WorkflowStatus; running: WorkflowStatus }> = {
  SCOUT: { ready: "CONFIRMED", running: "SCOUTING" },
  RISK: { ready: "SCOUTED", running: "RISK_ANALYSIS" },
  OPTIMIZE: { ready: "OPTIMIZING", running: "OPTIMIZING" },
  POLICY: { ready: "POLICY_EVALUATION", running: "POLICY_EVALUATION" },
};

export interface RunnerDeps {
  products?: ProductSearch;
  ai?: AiProvider;
  now?: () => Date;
  /** Test-only fault injection: throw inside the named step for the first N attempts. */
  faults?: Partial<Record<StepName, number>>;
  /** Test-only: simulate a crash after the step's work but before its completion commit. */
  crashAfterWork?: StepName;
  sleep?: (ms: number) => Promise<void>;
}

interface StepResult {
  output: Record<string, unknown>;
  next: WorkflowStatus;
  auditOutcome?: "SUCCESS" | "BLOCKED";
  extraMissionData?: Record<string, unknown>;
}

const TERMINAL_OR_WAITING: WorkflowStatus[] = [
  "AWAITING_APPROVAL",
  "BLOCKED",
  "READY_FOR_CHECKOUT",
  "FAILED",
  "EXPIRED",
  "DENIED",
  "COMPLETED",
];

export class SimulatedCrash extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function demoBaseline(providerProductId: string): number | null {
  return DEMO_PRODUCTS.find((p) => p.providerProductId === providerProductId)?.baselineUnitPriceMinor ?? null;
}

export function toCandidate(p: Product): ProductCandidate {
  const meta = (p.metadata ?? {}) as { baselineUnitPriceMinor?: number | null };
  return {
    provider: p.provider,
    providerProductId: p.providerProductId,
    title: p.title,
    description: p.description,
    category: p.category,
    unitPriceMinor: p.unitPriceMinor,
    shippingMinor: p.shippingMinor,
    taxMinor: p.taxMinor,
    currency: p.currency,
    imageUrl: p.imageUrl,
    sellerId: p.sellerId,
    sellerName: p.sellerName,
    sellerVerificationStatus: p.sellerVerificationStatus,
    shippingEstimateDays: p.shippingEstimateDays,
    stockQuantity: p.stockQuantity,
    attributes: (p.attributes ?? {}) as Record<string, string>,
    isDemoData: p.isDemoData,
    baselineUnitPriceMinor: meta.baselineUnitPriceMinor ?? (p.isDemoData ? demoBaseline(p.providerProductId) : null),
  };
}

export function snapshotFor(
  mission: { budgetMinor: number; currency: string; quantity: number },
  product: Product,
  mp: Pick<MissionProduct, "totalMinor" | "riskScore" | "evidenceCoverage" | "riskEvidence">,
): PolicySnapshot {
  const evidence = (mp.riskEvidence ?? null) as RiskAssessment | null;
  return {
    missionBudgetMinor: mission.budgetMinor,
    missionCurrency: mission.currency,
    quantity: mission.quantity,
    productCurrency: product.currency,
    unitPriceMinor: product.unitPriceMinor,
    shippingMinor: product.shippingMinor,
    taxMinor: product.taxMinor,
    totalMinor: mp.totalMinor,
    category: product.category,
    sellerVerification: product.sellerVerificationStatus,
    riskScore: mp.riskScore,
    evidenceCoverage: mp.evidenceCoverage,
    requirementMismatch: evidence ? evidence.requirementMismatch : null,
  };
}

export async function duplicateDetected(
  db: Db | Tx,
  args: { ownerId: string; missionId: string; providerProductId: string; quantity: number; totalMinor: number | null; currency: string; windowHours: number; now: Date },
): Promise<{ detected: boolean; fingerprint: string | null }> {
  if (args.totalMinor == null || args.windowHours <= 0) return { detected: false, fingerprint: null };
  const fingerprint = purchaseFingerprint({
    ownerId: args.ownerId,
    providerProductId: args.providerProductId,
    quantity: args.quantity,
    totalMinor: args.totalMinor,
    currency: args.currency,
  });
  const since = new Date(args.now.getTime() - args.windowHours * 3_600_000);
  const count = await db.approval.count({
    where: { fingerprint, missionId: { not: args.missionId }, status: { in: ["ACTIVE", "CONSUMED"] }, createdAt: { gte: since } },
  });
  return { detected: count > 0, fingerprint };
}

// ------------------------------------------------------------------------------------ steps

async function stepScout(db: Db, mission: Mission, c: MissionConstraints, deps: RunnerDeps): Promise<StepResult> {
  const provider = deps.products ?? getProductProvider();
  const raw = await provider.search({ query: c.productQuery, category: c.category, quantity: c.quantity, currency: c.currency });
  const valid = raw.map(normalizeCandidate).filter((x): x is ProductCandidate => x !== null);
  const rejected = raw.length - valid.length;
  const ids: string[] = [];
  for (const cand of valid) {
    const data = {
      title: cand.title,
      description: cand.description,
      category: cand.category,
      unitPriceMinor: cand.unitPriceMinor,
      shippingMinor: cand.shippingMinor,
      taxMinor: cand.taxMinor,
      currency: cand.currency,
      imageUrl: cand.imageUrl,
      sellerId: cand.sellerId,
      sellerName: cand.sellerName,
      sellerVerificationStatus: cand.sellerVerificationStatus,
      shippingEstimateDays: cand.shippingEstimateDays,
      stockQuantity: cand.stockQuantity,
      attributes: cand.attributes,
      isDemoData: cand.isDemoData,
      metadata: { baselineUnitPriceMinor: cand.baselineUnitPriceMinor, baselineSource: cand.isDemoData ? "seeded-demo" : "provider" },
    };
    const product = await db.product.upsert({
      where: { provider_providerProductId: { provider: cand.provider, providerProductId: cand.providerProductId } },
      create: { provider: cand.provider, providerProductId: cand.providerProductId, ...data },
      update: data,
    });
    let totalMinor: number | null = null;
    try {
      totalMinor = allInTotal({ unitPriceMinor: product.unitPriceMinor, quantity: c.quantity, shippingMinor: product.shippingMinor, taxMinor: product.taxMinor })?.totalMinor ?? null;
    } catch {
      totalMinor = null; // overflow → unknown → fails closed downstream
    }
    await db.missionProduct.upsert({
      where: { missionId_productId: { missionId: mission.id, productId: product.id } },
      create: { missionId: mission.id, productId: product.id, quantity: c.quantity, totalMinor },
      update: { quantity: c.quantity, totalMinor },
    });
    ids.push(product.providerProductId);
  }
  return {
    output: { provider: provider.name, candidates: ids.length, rejected, providerProductIds: ids, demo: provider.isDemo },
    next: "SCOUTED",
  };
}

async function stepRisk(db: Db, mission: Mission, c: MissionConstraints): Promise<StepResult> {
  const mps = await db.missionProduct.findMany({ where: { missionId: mission.id }, include: { product: true } });
  const summary: Array<Record<string, unknown>> = [];
  for (const mp of mps) {
    const a = assessRisk(toCandidate(mp.product), c);
    await db.missionProduct.update({
      where: { id: mp.id },
      data: { riskScore: a.riskScore, riskLevel: a.level, evidenceCoverage: a.evidenceCoverage, riskEvidence: a as unknown as object },
    });
    summary.push({ providerProductId: mp.product.providerProductId, riskScore: a.riskScore, evidenceCoverage: a.evidenceCoverage, riskLevel: a.level });
  }
  return { output: { assessed: mps.length, candidates: summary }, next: "OPTIMIZING" };
}

async function stepOptimize(db: Db, mission: Mission, c: MissionConstraints): Promise<StepResult> {
  const { config } = await latestPolicy(db, mission.ownerId);
  const mps = await db.missionProduct.findMany({ where: { missionId: mission.id }, include: { product: true } });
  const results = optimize(
    mps.map((mp) => ({
      key: mp.id,
      title: mp.product.title,
      totalMinor: mp.totalMinor,
      currency: mp.product.currency,
      category: mp.product.category,
      sellerVerified: mp.product.sellerVerificationStatus === "VERIFIED",
      risk: mp.riskEvidence as unknown as RiskAssessment,
    })),
    c,
    config,
  );
  for (const r of results) {
    await db.missionProduct.update({
      where: { id: r.key },
      data: { eligible: r.eligible, ineligibleReasons: r.ineligibleReasons, recommendationRank: r.rank, optimizerScore: r.score, optimizerExplanation: r.explanation },
    });
  }
  return { output: { ranked: results.filter((r) => r.eligible).length, eligible: results.filter((r) => r.eligible).length, candidates: results.length }, next: "POLICY_EVALUATION" };
}

async function stepPolicy(db: Db, mission: Mission, c: MissionConstraints, deps: RunnerDeps): Promise<StepResult> {
  const now = deps.now?.() ?? new Date();
  const { row, config } = await latestPolicy(db, mission.ownerId);
  const mps = await db.missionProduct.findMany({ where: { missionId: mission.id }, include: { product: true } });
  const decisions: Array<Record<string, unknown>> = [];
  let recommended: (typeof mps)[number] | null = null;
  let recommendedDecision: "ALLOW_CHECKOUT" | "REQUIRE_APPROVAL" | "BLOCK" = "BLOCK";

  for (const mp of mps) {
    const dup = await duplicateDetected(db, {
      ownerId: mission.ownerId,
      missionId: mission.id,
      providerProductId: mp.product.providerProductId,
      quantity: c.quantity,
      totalMinor: mp.totalMinor,
      currency: c.currency,
      windowHours: config.duplicateWindowHours,
      now,
    });
    const result = evaluate(snapshotFor(c, mp.product, mp), config, { duplicateDetected: dup.detected });
    await db.missionProduct.update({ where: { id: mp.id }, data: { policyDecision: result.decision, policyResult: result as unknown as object } });
    decisions.push({ providerProductId: mp.product.providerProductId, decision: result.decision, rank: mp.recommendationRank });
    if (mp.eligible && result.decision !== "BLOCK" && mp.recommendationRank != null) {
      if (!recommended || (recommended.recommendationRank ?? 99) > mp.recommendationRank) {
        recommended = mp;
        recommendedDecision = result.decision;
      }
    }
  }

  const next: WorkflowStatus = !recommended ? "BLOCKED" : recommendedDecision === "REQUIRE_APPROVAL" ? "AWAITING_APPROVAL" : "READY_FOR_CHECKOUT";

  // Optional LLM explanation: display-only, capped per mission, never affects the decision.
  const ai = deps.ai ?? getAiProvider();
  const canCallLlm = ai.isLlm && mission.llmCalls < MAX_LLM_CALLS_PER_MISSION;
  const explainInput = {
    missionTitle: c.title,
    recommended: recommended
      ? {
          title: recommended.product.title,
          sellerName: recommended.product.sellerName,
          totalFormatted: formatMoney(recommended.totalMinor, c.currency),
          riskScore: recommended.riskScore ?? 100,
          evidenceCoverage: recommended.evidenceCoverage ?? 0,
        }
      : null,
    decision: recommended ? recommendedDecision : "BLOCK",
    deterministicExplanation: recommended?.optimizerExplanation ?? "",
    reasons: recommended ? [] : mps.flatMap((mp) => ((mp.policyResult as { reasons?: string[] } | null)?.reasons ?? []).slice(0, 1)),
  };
  const explanation = canCallLlm
    ? await ai.explainRecommendation(explainInput)
    : await new DeterministicAi().explainRecommendation(explainInput);

  return {
    output: { decisions, recommendedProductId: recommended?.productId ?? null, decision: recommended ? recommendedDecision : "BLOCK", policyVersion: row.version, explanation: explanation.text, explanationSource: explanation.source },
    next,
    auditOutcome: next === "BLOCKED" ? "BLOCKED" : "SUCCESS",
    extraMissionData: {
      policyVersion: row.version,
      decision: recommended ? recommendedDecision : "BLOCK",
      recommendedProductId: recommended?.productId ?? null,
      recommendationSummary: explanation.text,
      recommendationSource: explanation.source,
      ...(canCallLlm ? { llmCalls: { increment: 1 } } : {}),
    },
  };
}

// ------------------------------------------------------------------------------------ runner

type StepOutcome = "done" | "busy" | "failed";

async function runStep(db: Db, missionId: string, step: StepName, deps: RunnerDeps): Promise<StepOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const agent = AGENT_OF[step];

  for (;;) {
    const existing = await db.agentRun.findUnique({ where: { missionId_step: { missionId, step } } });
    if (existing?.status === "COMPLETED") return "done";
    if (existing && existing.attempt >= MAX_ATTEMPTS && existing.status === "FAILED") return "failed";
    if (existing?.status === "RUNNING" && existing.lockedUntil && existing.lockedUntil > now()) return "busy";

    // Claim the step (CAS on attempt as a fencing token).
    let attempt: number;
    if (!existing) {
      try {
        const created = await db.agentRun.create({
          data: { missionId, step, agentType: agent, status: "RUNNING", attempt: 1, lockedUntil: new Date(now().getTime() + LEASE_MS) },
        });
        attempt = created.attempt;
      } catch {
        return "busy"; // another executor created it first
      }
    } else {
      const claimed = await db.agentRun.updateMany({
        where: { id: existing.id, attempt: existing.attempt, status: { in: ["FAILED", "RUNNING"] } },
        data: { status: "RUNNING", attempt: existing.attempt + 1, lockedUntil: new Date(now().getTime() + LEASE_MS), error: null },
      });
      if (claimed.count !== 1) return "busy";
      attempt = existing.attempt + 1;
    }

    const mission = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
    const st = STEP_STATUS[step];
    // Enter the running status (skipped when resuming a step that already entered it).
    if (mission.status === st.ready && st.ready !== st.running) {
      await db.$transaction(async (tx) => {
        await casMission(tx, { id: mission.id, from: st.ready, to: st.running, version: mission.version });
        await appendAudit(tx, {
          missionId,
          ownerId: mission.ownerId,
          actor: `agent:${agent}`,
          eventType: "agent.step_started",
          resource: `mission:${missionId}`,
          outcome: "INFO",
          metadata: { step, agent, attempt, from: st.ready, to: st.running },
          mode: mission.mode,
        });
      });
    } else if (mission.status !== st.running) {
      throw new AppError("CONFLICT", `Mission is ${mission.status}; cannot run step ${step}`);
    }

    const started = Date.now();
    try {
      if ((deps.faults?.[step] ?? 0) >= attempt) throw new Error(`Injected fault in ${step} (attempt ${attempt})`);
      const c = confirmedConstraints(mission);
      const work = (async () => {
        switch (step) {
          case "SCOUT":
            return stepScout(db, mission, c, deps);
          case "RISK":
            return stepRisk(db, mission, c);
          case "OPTIMIZE":
            return stepOptimize(db, mission, c);
          case "POLICY":
            return stepPolicy(db, mission, c, deps);
        }
      })();
      const result = await withTimeout(work, STEP_TIMEOUT_MS, `${step} step`);
      if (deps.crashAfterWork === step) throw new SimulatedCrash(`Simulated crash after ${step} work`);

      const fresh = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
      await db.$transaction(async (tx) => {
        const done = await tx.agentRun.updateMany({
          where: { missionId, step, attempt, status: "RUNNING" },
          data: { status: "COMPLETED", completedAt: now(), lockedUntil: null, outputSummary: result.output as object, durationMs: Date.now() - started, inputSummary: { step, attempt } },
        });
        if (done.count !== 1) throw new AppError("CONFLICT", `Lost lease for step ${step}`);
        await casMission(tx, { id: missionId, from: st.running, to: result.next, version: fresh.version, data: result.extraMissionData as never });
        await appendAudit(tx, {
          missionId,
          ownerId: fresh.ownerId,
          actor: `agent:${agent}`,
          eventType: step === "POLICY" ? "policy.evaluated" : "agent.step_completed",
          resource: `mission:${missionId}`,
          outcome: result.auditOutcome ?? "SUCCESS",
          metadata: { step, agent, attempt, from: st.running, to: result.next, durationMs: Date.now() - started, ...result.output },
          mode: fresh.mode,
        });
      });
      return "done";
    } catch (err) {
      if (err instanceof SimulatedCrash) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const finalAttempt = attempt >= MAX_ATTEMPTS;
      await db.$transaction(async (tx) => {
        await tx.agentRun.updateMany({ where: { missionId, step, attempt }, data: { status: "FAILED", error: message.slice(0, 500), lockedUntil: null, durationMs: Date.now() - started } });
        const m = await tx.mission.findUniqueOrThrow({ where: { id: missionId } });
        await appendAudit(tx, {
          missionId,
          ownerId: m.ownerId,
          actor: `agent:${agent}`,
          eventType: finalAttempt ? "agent.step_failed" : "agent.step_retry",
          resource: `mission:${missionId}`,
          outcome: "FAILURE",
          metadata: { step, agent, attempt, maxAttempts: MAX_ATTEMPTS, error: message },
          mode: m.mode,
        });
        if (finalAttempt && m.status === st.running) {
          await casMission(tx, { id: missionId, from: st.running, to: "FAILED", version: m.version, data: { failureReason: `${step} failed after ${attempt} attempts: ${message.slice(0, 200)}` } });
          await appendAudit(tx, {
            missionId,
            ownerId: m.ownerId,
            actor: "system:orchestrator",
            eventType: "mission.failed",
            resource: `mission:${missionId}`,
            outcome: "FAILURE",
            metadata: { from: st.running, to: "FAILED", step, reason: message },
            mode: m.mode,
          });
        }
      });
      if (finalAttempt) return "failed";
      await sleep(100 * 2 ** (attempt - 1));
    }
  }
}

export interface ExecuteResult {
  state: "COMPLETED_WORKFLOW" | "IN_PROGRESS" | "FAILED" | "NOOP";
  status: WorkflowStatus;
}

export async function executeMission(db: Db, missionId: string, deps: RunnerDeps = {}): Promise<ExecuteResult> {
  const mission = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
  if (TERMINAL_OR_WAITING.includes(mission.status)) return { state: "NOOP", status: mission.status };
  if (mission.status === "CREATED" || mission.status === "PARSED") {
    throw new AppError("PRECONDITION_FAILED", "Confirm the parsed mission before executing it.");
  }
  for (const step of STEP_ORDER) {
    const outcome = await runStep(db, missionId, step, deps);
    if (outcome === "busy") {
      const m = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
      return { state: "IN_PROGRESS", status: m.status };
    }
    if (outcome === "failed") {
      const m = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
      return { state: "FAILED", status: m.status };
    }
  }
  const final = await db.mission.findUniqueOrThrow({ where: { id: missionId } });
  return { state: "COMPLETED_WORKFLOW", status: final.status };
}
