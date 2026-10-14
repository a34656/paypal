/**
 * Optimizer — pure ranking of candidates that pass hard eligibility filters.
 * Weights come from the versioned policy, never from agent or LLM output.
 * No market averages are invented: cost is compared only among the actual candidates.
 * Certainty first: offers with a fully disclosed total always rank ahead of offers that can
 * only be bought under a spending cap (shipping/tax undisclosed). Caps are the fallback.
 */
import type { OptimizerWeights, PolicyConfig } from "@/domain/policy/schema";
import type { MissionConstraints } from "@/domain/types";
import type { RiskAssessment } from "@/domain/risk/engine";

export interface OptimizerCandidate {
  key: string;
  title: string;
  totalMinor: number | null;
  currency: string;
  category: string;
  sellerVerified: boolean;
  risk: RiskAssessment;
  /** CAP = totalMinor is an upper bound (spending cap), not a disclosed total. */
  amountBasis?: "EXACT" | "CAP" | null;
}

export interface OptimizerResult {
  key: string;
  eligible: boolean;
  ineligibleReasons: string[];
  score: number | null;
  rank: number | null;
  components: Record<keyof OptimizerWeights, number> | null;
  explanation: string;
}

function factor(risk: RiskAssessment, id: string) {
  return risk.factors.find((f) => f.id === id);
}

export function eligibility(c: OptimizerCandidate, mission: MissionConstraints, policy: PolicyConfig): string[] {
  const reasons: string[] = [];
  if (c.totalMinor === null) reasons.push("All-in total unknown (shipping or tax not disclosed).");
  if (c.currency !== mission.currency) reasons.push(`Currency ${c.currency} differs from mission currency ${mission.currency}.`);
  if (c.risk.riskScore > 100 - policy.minTrustScore) reasons.push(`Risk ${c.risk.riskScore} exceeds the policy maximum ${100 - policy.minTrustScore}.`);
  if (c.risk.requirementMismatch === true) reasons.push("Does not meet the mission's required attributes.");
  if (mission.maxRiskScore != null && c.risk.riskScore > mission.maxRiskScore) reasons.push(`Risk ${c.risk.riskScore} exceeds this mission's tolerance (max ${mission.maxRiskScore}).`);
  if (c.totalMinor !== null && policy.blockOverBudget && c.totalMinor > mission.budgetMinor) reasons.push("All-in total exceeds the mission budget.");
  if (policy.blockedCategories.map((x) => x.toLowerCase()).includes(c.category.toLowerCase())) reasons.push(`Category "${c.category}" is blocked.`);
  // Mirror the policy's hard gates so ranks are never given to offers the policy will block.
  if (policy.requireSufficientInfo && c.risk.evidenceCoverage < policy.minEvidenceCoverage) {
    reasons.push(`Evidence coverage ${c.risk.evidenceCoverage}% is below the policy minimum ${policy.minEvidenceCoverage}%.`);
  }
  if (policy.blockUnverifiedSellers && !c.sellerVerified) reasons.push("Seller is not verified and policy blocks unverified sellers.");
  if ((c.risk.injectionSignals ?? []).length > 0) reasons.push("Listing text tries to instruct the purchasing agent.");
  return reasons;
}

export function optimize(candidates: OptimizerCandidate[], mission: MissionConstraints, policy: PolicyConfig): OptimizerResult[] {
  const w = policy.optimizerWeights;
  const wSum = w.cost + w.budget + w.compatibility + w.delivery + w.seller;
  const withElig = candidates.map((c) => ({ c, reasons: eligibility(c, mission, policy) }));
  const eligible = withElig.filter((x) => x.reasons.length === 0);
  const totals = eligible.map((x) => x.c.totalMinor as number);
  const minT = Math.min(...totals);

  const scored = eligible.map(({ c }) => {
    const total = c.totalMinor as number;
    const attr = factor(c.risk, "attributes");
    const delivery = factor(c.risk, "delivery");
    const components = {
      // Proportional to the cheapest eligible offer (not min-max), so a 5% price gap moves the
      // score by ~5% of the cost weight instead of the whole weight.
      cost: total <= 0 ? 1 : minT / total,
      budget: Math.max(0, 1 - total / mission.budgetMinor),
      // Ranking only: a requirement stated in the listing title is better than one not stated at all
      // (half credit); the risk score and policy gates still treat it as unverified.
      compatibility: c.risk.attributeEvidence && c.risk.attributeEvidence.required > 0
        ? (c.risk.attributeEvidence.matched + c.risk.attributeEvidence.titleOnly / 2) / c.risk.attributeEvidence.required
        : attr ? 1 - attr.contribution / attr.max : 0,
      delivery: delivery && delivery.status === "OK" ? 1 : 0,
      seller: c.sellerVerified ? 1 : 0,
    };
    const raw =
      (w.cost * components.cost +
        w.budget * components.budget +
        w.compatibility * components.compatibility +
        w.delivery * components.delivery +
        w.seller * components.seller) /
      wSum;
    return { c, components, score: Math.round(raw * 100) };
  });
  const tier = (c: OptimizerCandidate) => (c.amountBasis === "CAP" ? 1 : 0);
  const exactCount = scored.filter((s) => tier(s.c) === 0).length;
  scored.sort((a, b) => tier(a.c) - tier(b.c) || b.score - a.score || (a.c.totalMinor as number) - (b.c.totalMinor as number) || a.c.key.localeCompare(b.c.key));

  const results = new Map<string, OptimizerResult>();
  scored.forEach((s, i) => {
    const strengths = (Object.keys(s.components) as (keyof OptimizerWeights)[])
      .filter((k) => w[k] > 0)
      .sort((a, b) => w[b] * s.components[b] - w[a] * s.components[a])
      .slice(0, 2)
      .map((k) => ({ cost: "lowest relative cost", budget: "budget headroom", compatibility: "requirement match", delivery: "delivery evidence", seller: "verified seller" })[k]);
    const capNote =
      tier(s.c) === 1
        ? exactCount > 0
          ? " Ranked below offers with a disclosed total: shipping/tax unknown, bought only under a spending cap."
          : " No seller disclosed shipping/tax; buying needs a capped PayPal authorization hold."
        : "";
    results.set(s.c.key, {
      key: s.c.key,
      eligible: true,
      ineligibleReasons: [],
      score: s.score,
      rank: i + 1,
      components: s.components,
      explanation:
        (i === 0
          ? `Ranked #1 of ${scored.length} eligible offer${scored.length > 1 ? "s" : ""} (score ${s.score}/100). Strongest on ${strengths.join(" and ")}.`
          : `Ranked #${i + 1} of ${scored.length} (score ${s.score}/100). Strongest on ${strengths.join(" and ")}.`) + capNote,
    });
  });
  for (const { c, reasons } of withElig) {
    if (!results.has(c.key)) {
      results.set(c.key, { key: c.key, eligible: false, ineligibleReasons: reasons, score: null, rank: null, components: null, explanation: `Not ranked: ${reasons.join(" ")}` });
    }
  }
  return candidates.map((c) => results.get(c.key) as OptimizerResult);
}
