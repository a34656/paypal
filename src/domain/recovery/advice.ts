/**
 * Structured procurement advice. The advisor (LLM or deterministic) may EXPLAIN and RECOMMEND;
 * it never decides. Its output is validated against this schema and then against the
 * deterministic analysis: unknown check ids, unavailable options, amounts the analysis does not
 * state, and claims of safety/eligibility/approval are rejected.
 */
import { z } from "zod";
import { OPTION_IDS, type OptionId, type RecoveryAnalysis } from "./analysis";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionId = z.enum(OPTION_IDS);
export const MISSION_FIELDS = ["budgetMinor", "quantity", "deadlineDays", "requiredAttributes", "productQuery", "maxRiskScore"] as const;

export const recoveryAdviceSchema = z.object({
  diagnosis: text(900),
  failedConstraints: z.array(z.object({ checkId: text(60), explanation: text(400) })).max(20),
  recommendations: z.array(z.object({ optionId, title: text(120), rationale: text(500) })).max(8),
  estimatedImpact: z.array(z.object({ optionId, impact: text(300) })).max(8),
  tradeoffs: z.array(text(300)).max(8),
  missingInformation: z.array(text(200)).max(10),
  suggestedMissionChanges: z.array(z.object({ field: z.enum(MISSION_FIELDS), optionId, note: text(300) })).max(6),
  overrideEligibility: z.object({ eligible: z.boolean(), explanation: text(500) }),
  nextAction: z.object({ optionId, label: text(200) }),
});
export type RecoveryAdvice = z.infer<typeof recoveryAdviceSchema>;

/** Phrases an advisor may never use: AEGIS does not promise outcomes. */
const FORBIDDEN_CLAIMS = /\b(guarantee[sd]?|is (now )?safe|will be approved|is approved|pre-?approved|eligible for purchase|authori[sz]ed to (buy|purchase|pay)|bypass|force purchase|skip (the )?approval)\b/i;
const MONEY = /[$€£¥]\s?\d[\d,]*(?:\.\d+)?/g;

export interface AdviceValidation {
  ok: boolean;
  advice: RecoveryAdvice | null;
  problems: string[];
}

function allText(a: RecoveryAdvice): string[] {
  return [
    a.diagnosis,
    ...a.failedConstraints.map((x) => x.explanation),
    ...a.recommendations.flatMap((x) => [x.title, x.rationale]),
    ...a.estimatedImpact.map((x) => x.impact),
    ...a.tradeoffs,
    ...a.missingInformation,
    ...a.suggestedMissionChanges.map((x) => x.note),
    a.overrideEligibility.explanation,
    a.nextAction.label,
  ];
}

/**
 * Validates advisor output against the deterministic analysis. Structural problems that can be
 * repaired (unknown ids, unavailable options) are dropped; fabricated amounts or forbidden claims
 * reject the whole response (the caller falls back to deterministic advice).
 */
export function validateAdvice(raw: unknown, analysis: RecoveryAnalysis): AdviceValidation {
  const parsed = recoveryAdviceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, advice: null, problems: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) };
  const a = parsed.data;
  const problems: string[] = [];
  const normMoney = (m: string) => m.replace(/[\s,]/g, "").replace(/\.0+$/, "");
  const allowedMoney = new Set(analysis.citedAmounts.map(normMoney));
  for (const t of allText(a)) {
    if (FORBIDDEN_CLAIMS.test(t)) problems.push(`Forbidden claim: "${t.slice(0, 80)}"`);
    for (const m of t.match(MONEY) ?? []) {
      if (!allowedMoney.has(normMoney(m))) problems.push(`Amount ${m} is not stated by the deterministic analysis`);
    }
  }
  if (problems.length) return { ok: false, advice: null, problems };

  const checkIds = new Set(analysis.offers.flatMap((o) => [...o.blocking, ...o.approvals].map((b) => b.checkId)));
  const available = new Set<OptionId>(analysis.recommendations.map((r) => r.id));
  const dropped = (what: string, n: number) => n > 0 && problems.push(`Dropped ${n} ${what}`);
  const fc = a.failedConstraints.filter((x) => checkIds.has(x.checkId));
  dropped("failed constraints with unknown check ids", a.failedConstraints.length - fc.length);
  const recs = a.recommendations.filter((x) => available.has(x.optionId));
  dropped("recommendations for unavailable options", a.recommendations.length - recs.length);
  const impact = a.estimatedImpact.filter((x) => available.has(x.optionId));
  const changes = a.suggestedMissionChanges.filter((x) => available.has(x.optionId) && x.optionId !== "REQUEST_OVERRIDE");
  dropped("mission changes for unavailable options", a.suggestedMissionChanges.length - changes.length);
  const det = analysis.nextAction;
  const next = available.has(a.nextAction.optionId) ? a.nextAction : { optionId: det.optionId, label: det.label };
  return {
    ok: true,
    problems,
    advice: {
      ...a,
      failedConstraints: fc,
      recommendations: recs,
      estimatedImpact: impact,
      suggestedMissionChanges: changes,
      // Override eligibility is a deterministic fact; the advisor may only explain it.
      overrideEligibility: { eligible: analysis.override.eligible, explanation: analysis.override.eligible === a.overrideEligibility.eligible ? a.overrideEligibility.explanation : analysis.override.explanation },
      nextAction: next,
    },
  };
}

/** Advice built only from the deterministic analysis (fallback, or when no LLM is configured). */
export function deterministicAdvice(analysis: RecoveryAnalysis): RecoveryAdvice {
  const s = analysis.summary;
  const seen = new Set<string>();
  const failed: RecoveryAdvice["failedConstraints"] = [];
  for (const o of analysis.offers) {
    for (const b of o.blocking) {
      if (seen.has(b.checkId)) continue;
      seen.add(b.checkId);
      const n = analysis.offers.filter((x) => x.blocking.some((y) => y.checkId === b.checkId)).length;
      failed.push({ checkId: b.checkId, explanation: `${b.label}: fails on ${n} of ${s.offerCount} offers. ${b.nextAction}`.slice(0, 400) });
    }
  }
  const recs = analysis.recommendations;
  return {
    diagnosis: analysis.whyBlocked.join(" ").slice(0, 900) || "No blocking checks were recorded.",
    failedConstraints: failed.slice(0, 20),
    recommendations: recs.slice(0, 8).map((r) => ({ optionId: r.id, title: r.title.slice(0, 120), rationale: `${r.whyItHelps}`.slice(0, 500) })),
    estimatedImpact: recs.slice(0, 8).map((r) => ({ optionId: r.id, impact: `${r.whatChanges} Cost: ${r.estimatedCost}.`.slice(0, 300) })),
    tradeoffs: [...new Set(recs.flatMap((r) => r.tradeoffs))].slice(0, 8).map((t) => t.slice(0, 300)),
    missingInformation: [...new Set(analysis.offers.flatMap((o) => o.missingInformation))].slice(0, 10).map((m) => `Not disclosed by the provider: ${m}`.slice(0, 200)),
    suggestedMissionChanges: recs
      .filter((r) => r.proposedChanges && Object.keys(r.proposedChanges).length > 0)
      .flatMap((r) => Object.keys(r.proposedChanges ?? {}).map((f) => ({ field: f as (typeof MISSION_FIELDS)[number], optionId: r.id, note: r.whatChanges.slice(0, 300) })))
      .slice(0, 6),
    overrideEligibility: { eligible: analysis.override.eligible, explanation: analysis.override.explanation.slice(0, 500) },
    nextAction: { optionId: analysis.nextAction.optionId, label: analysis.nextAction.label.slice(0, 200) },
  };
}

/** Compact, data-only evidence for the LLM. Untrusted listing text is truncated and delimited by the caller. */
export function adviceEvidence(analysis: RecoveryAnalysis) {
  return {
    mission: analysis.summary,
    whyBlocked: analysis.whyBlocked,
    offers: analysis.offers.slice(0, 10).map((o) => ({
      title: o.title.slice(0, 80),
      seller: o.sellerName?.slice(0, 40) ?? null,
      total: o.totalMinor,
      totalBasis: o.totalBasis,
      blocking: o.blocking.map((b) => ({ checkId: b.checkId, actual: b.actual, permitted: b.permitted, difference: b.difference, adjustable: b.adjustabilityLabel })),
      approvalsStillNeeded: o.approvals.map((b) => b.checkId),
      missingInformation: o.missingInformation,
    })),
    options: analysis.recommendations.map((r) => ({ optionId: r.id, title: r.title, whatChanges: r.whatChanges, whyItHelps: r.whyItHelps, estimatedCost: r.estimatedCost, tradeoffs: r.tradeoffs, resolves: r.resolves })),
    budgetAloneInsufficient: analysis.budget.budgetAloneInsufficient,
    override: analysis.override,
    citedAmounts: analysis.citedAmounts,
    nextActionDeterministic: analysis.nextAction,
  };
}
