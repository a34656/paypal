/**
 * Procurement recovery analysis — pure, deterministic, no I/O.
 *
 * Turns a BLOCKED mission's stored evaluation results into an evidence-based diagnosis and
 * concrete recovery options. Rules:
 *  - Failed checks come ONLY from the stored policy evaluation and optimizer eligibility; none
 *    are invented. Unknown data is labelled unknown.
 *  - Every "what if" is computed by re-running the real engines (pricing → risk → optimizer
 *    eligibility → policy) on the offers already found, with the proposed constraint change.
 *    These are PROJECTIONS: a revised mission re-searches the provider and re-evaluates.
 *  - Money is integer minor units throughout; percentages are integer basis points.
 *  - Nothing here can change a decision, a mission, a policy, an approval or a payment.
 */
import { eligibility } from "@/domain/agents/optimizer";
import { evaluate, type PolicyEvaluation } from "@/domain/policy/engine";
import type { PolicyConfig } from "@/domain/policy/schema";
import { snapshotFor } from "@/domain/policy/snapshot";
import { maxFeasibleQuantity, safePurchaseAmounts, type PurchaseAmounts } from "@/domain/pricing";
import { assessRisk, type RiskAssessment } from "@/domain/risk/engine";
import type { DecisionValue, MissionConstraints, ProductCandidate } from "@/domain/types";
import { formatMoney } from "@/lib/money";
import { ADJUSTABILITY_LABEL, checkMeta, type Adjustability } from "./constraints";

// ------------------------------------------------------------------------------------ input

export interface RecoveryOffer {
  /** MissionProduct id. */
  id: string;
  productId: string;
  candidate: ProductCandidate;
  totalMinor: number | null;
  amountBasis: "EXACT" | "CAP" | null;
  allowanceMinor: number | null;
  riskScore: number | null;
  evidenceCoverage: number | null;
  risk: RiskAssessment | null;
  eligible: boolean | null;
  ineligibleReasons: string[];
  evaluation: PolicyEvaluation | null;
  /** When the offer was fetched for this mission (ISO). */
  quotedAt: string;
}

export interface RecoveryInput {
  constraints: MissionConstraints;
  /** Policy version the mission was evaluated against (explains the stored results). */
  evaluatedPolicy: PolicyConfig;
  evaluatedPolicyVersion: number | null;
  /** Current policy (what a revision would be evaluated against). */
  currentPolicy: PolicyConfig;
  currentPolicyVersion: number;
  missionVersion: number;
  decision: DecisionValue | null;
  offers: RecoveryOffer[];
  now: Date;
  /** Safety margin on top of the minimum budget, integer percent 0–25 (EXACT totals only). */
  marginPct?: number;
  staleAfterHours?: number;
}

// ------------------------------------------------------------------------------------ output

export type TotalBasis = "EXACT" | "CAP" | "UNKNOWN";

export interface FailedCheck {
  checkId: string;
  label: string;
  /** BLOCK = policy block; INELIGIBLE = optimizer hard gate; REQUIRE_APPROVAL = still needs a human. */
  result: "BLOCK" | "INELIGIBLE" | "REQUIRE_APPROVAL";
  actual: string;
  permitted: string;
  difference: string | null;
  differenceMinor: number | null;
  adjustability: Adjustability;
  adjustabilityLabel: string;
  overridable: boolean;
  financial: boolean;
  evidence: string;
  source: string;
  nextAction: string;
  budgetWontHelp: string | null;
}

export interface OfferDiagnosis {
  offerId: string;
  productId: string;
  title: string;
  sellerName: string | null;
  provider: string;
  isDemoData: boolean;
  offerUrl: string | null;
  unitPriceMinor: number;
  quantity: number;
  itemTotalMinor: number | null;
  shippingMinor: number | null;
  taxMinor: number | null;
  allowanceMinor: number | null;
  totalMinor: number | null;
  totalBasis: TotalBasis;
  overBudgetMinor: number | null;
  riskScore: number | null;
  evidenceCoverage: number | null;
  blocking: FailedCheck[];
  approvals: FailedCheck[];
  /** Every blocking check is financial: a budget/quantity change alone could resolve this offer. */
  budgetOnly: boolean;
  nonFinancialBlockers: string[];
  missingInformation: string[];
  attributes: AttributeStatus[];
  quotedAt: string;
  stale: boolean;
}

export type AttributeState = "MATCH" | "TITLE_ONLY" | "UNDISCLOSED" | "MISMATCH";
export interface AttributeStatus {
  key: string;
  required: string;
  state: AttributeState;
}

export interface ProjectedBlocker {
  id: string;
  label: string;
  detail: string;
  overridable: boolean;
  adjustability: Adjustability;
}

export interface Projection {
  offerId: string;
  amounts: PurchaseAmounts | null;
  riskScore: number;
  evidenceCoverage: number;
  decision: DecisionValue;
  viable: boolean;
  blockers: ProjectedBlocker[];
  approvalReasons: string[];
}

export interface BudgetUnlock {
  offerId: string;
  title: string;
  basis: TotalBasis;
  minBudgetMinor: number;
  increaseMinor: number;
  increaseBps: number;
  marginPct: number;
  marginMinor: number;
  suggestedBudgetMinor: number;
  exceedsPolicyCap: boolean;
  projectedDecision: DecisionValue;
  approvalReasons: string[];
}

export interface BudgetAnalysis {
  currentBudgetMinor: number;
  lowestTotalMinor: number | null;
  lowestOfferId: string | null;
  lowestBasis: TotalBasis | null;
  highestTotalMinor: number | null;
  shortfallMinor: number | null;
  shortfallBps: number | null;
  /** The cheapest offer that a budget increase ALONE makes viable (projection), if any. */
  unlock: BudgetUnlock | null;
  otherUnlocks: BudgetUnlock[];
  budgetAloneInsufficient: boolean;
  /** Budget needed to fit the lowest identified total, and what would STILL fail at that budget. */
  lowestFit: { offerId: string; title: string; minBudgetMinor: number; increaseMinor: number; increaseBps: number; remainingBlockers: string[] } | null;
  policyCapMinor: number;
}

export interface QuantityCandidate {
  offerId: string;
  title: string;
  quantity: number;
  unitsFewer: number;
  totalMinor: number;
  basis: TotalBasis;
  /** True when the amount relies on assumptions the provider did not confirm (see note). */
  estimate: boolean;
  note: string;
  projectedDecision: DecisionValue;
  approvalReasons: string[];
}

export interface QuantityAnalysis {
  requestedQuantity: number;
  candidates: QuantityCandidate[];
  /** Largest quantity of the cheapest offer that fits the budget, even if other checks still fail. */
  bestEffort: (Omit<QuantityCandidate, "projectedDecision" | "approvalReasons"> & { remainingBlockers: string[] }) | null;
  /** Why no candidate exists, when none does. */
  reason: string | null;
  pricingNote: string;
}

export interface DeliveryItem {
  offerId: string;
  title: string;
  estimateDays: number;
  deadlineDays: number;
  riskReduction: number;
  unlocks: boolean;
  projectedDecision: DecisionValue;
}

export interface DeliveryAnalysis {
  deadlineDays: number | null;
  /** Offers whose delivery estimate exceeds the deadline (the only case where relaxing it helps). */
  items: DeliveryItem[];
  /** Offers with no delivery estimate at all: relaxing the deadline does not help those. */
  undisclosedCount: number;
  shipping: { offerId: string; title: string; shippingMinor: number; totalMinor: number; shareBps: number }[];
  slowerShippingOptionsAvailable: false;
  relevant: boolean;
}

export interface RequirementAnalysis {
  attributes: {
    key: string;
    value: string;
    counts: Record<AttributeState, number>;
    /** Offers that become viable if ONLY this attribute is made optional (budget unchanged). */
    unlockOfferIds: string[];
  }[];
}

export interface PathChange {
  field: "budgetMinor" | "deadlineDays" | "requiredAttributes";
  label: string;
  from: string;
  to: string;
  relaxesMandatory: boolean;
}

export interface EligibilityPath {
  offerId: string;
  title: string;
  totalMinor: number | null;
  basis: TotalBasis;
  changes: PathChange[];
  proposed: { budgetMinor: number; deadlineDays: number | null; requiredAttributes: Record<string, string> };
  viable: boolean;
  projectedDecision: DecisionValue;
  approvalReasons: string[];
  remainingBlockers: ProjectedBlocker[];
}

export interface OverrideAnalysis {
  eligible: boolean;
  overridable: { checkId: string; label: string; policyField: string | null; offerCount: number }[];
  notOverridable: { checkId: string; label: string; reason: string; offerCount: number }[];
  explanation: string;
}

export type OptionId =
  | "INCREASE_BUDGET"
  | "REDUCE_QUANTITY"
  | "FIND_ALTERNATIVES"
  | "ADJUST_DELIVERY"
  | "CHANGE_REQUIREMENTS"
  | "COMBINED_PATH"
  | "REFRESH_QUOTE"
  | "REQUEST_OVERRIDE";

export const OPTION_IDS: [OptionId, ...OptionId[]] = [
  "INCREASE_BUDGET",
  "REDUCE_QUANTITY",
  "FIND_ALTERNATIVES",
  "ADJUST_DELIVERY",
  "CHANGE_REQUIREMENTS",
  "COMBINED_PATH",
  "REFRESH_QUOTE",
  "REQUEST_OVERRIDE",
];

export interface ProposedMissionChanges {
  budgetMinor?: number;
  quantity?: number;
  deadlineDays?: number | null;
  requiredAttributes?: Record<string, string>;
}

export interface Recommendation {
  id: OptionId;
  title: string;
  whatChanges: string;
  whyItHelps: string;
  estimatedCost: string;
  tradeoffs: string[];
  stillMustPass: string[];
  exactness: "EXACT" | "CAP" | "ESTIMATE" | "PROJECTION" | "N/A";
  /** Mission edits this recommendation proposes; applied only after explicit confirmation. */
  proposedChanges: ProposedMissionChanges | null;
  /** Viable under the projection (false = informational / partial). */
  resolves: boolean;
}

export interface RecoveryAnalysis {
  summary: {
    title: string;
    currency: string;
    budgetMinor: number;
    quantity: number;
    offerCount: number;
    blockedCount: number;
    lowestTotalMinor: number | null;
    highestTotalMinor: number | null;
    shortfallMinor: number | null;
    /** "$574.43 − $400.00 = $174.43" */
    arithmetic: string | null;
    allCapped: boolean;
    anyDemoData: boolean;
    decision: DecisionValue | null;
    missionVersion: number;
    evaluatedPolicyVersion: number | null;
    currentPolicyVersion: number;
    policyChangedSinceEvaluation: boolean;
  };
  whyBlocked: string[];
  offers: OfferDiagnosis[];
  budget: BudgetAnalysis;
  quantity: QuantityAnalysis;
  delivery: DeliveryAnalysis;
  requirements: RequirementAnalysis;
  paths: EligibilityPath[];
  override: OverrideAnalysis;
  staleness: { stale: boolean; oldestQuoteHours: number | null; note: string | null };
  recommendations: Recommendation[];
  nextAction: { optionId: OptionId; label: string };
  /** Every money string the analysis states (AI output may only cite these). */
  citedAmounts: string[];
  projectionNote: string;
}

// ------------------------------------------------------------------------------------ helpers

const bps = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : 0);
export const formatBps = (b: number) => `${(b / 100).toFixed(2)}%`;
const basisOf = (b: string | null | undefined, total: number | null): TotalBasis => (total == null ? "UNKNOWN" : b === "CAP" ? "CAP" : "EXACT");

function money(minor: number | null | undefined, currency: string) {
  return formatMoney(minor ?? null, currency);
}

/** Re-runs pricing → risk → optimizer eligibility → policy for one offer under constraints c. */
export function projectOffer(offer: RecoveryOffer, c: MissionConstraints, policy: PolicyConfig): Projection {
  const cand = offer.candidate;
  const amounts = safePurchaseAmounts(cand, c.quantity, policy.costAllowancePct);
  const risk = assessRisk(cand, c, { costBounded: amounts?.basis === "CAP" });
  const reasons = eligibility(
    {
      key: offer.id,
      title: cand.title,
      totalMinor: amounts?.totalMinor ?? null,
      currency: cand.currency,
      category: cand.category,
      sellerVerified: cand.sellerVerificationStatus === "VERIFIED",
      risk,
      amountBasis: amounts?.basis ?? null,
    },
    c,
    policy,
  );
  const evaluation = evaluate(
    snapshotFor(c, cand, {
      totalMinor: amounts?.totalMinor ?? null,
      riskScore: risk.riskScore,
      evidenceCoverage: risk.evidenceCoverage,
      riskEvidence: risk,
      amountBasis: amounts?.basis ?? null,
      allowanceMinor: amounts ? amounts.allowanceMinor : null,
    }),
    policy,
    // Duplicate detection needs the database; the authoritative run re-checks it.
    { duplicateDetected: false },
  );
  const blockers: ProjectedBlocker[] = evaluation.checks
    .filter((ch) => ch.result === "BLOCK")
    .map((ch) => ({ id: ch.id, label: ch.label, detail: ch.detail, overridable: checkMeta(ch.id).overridable, adjustability: checkMeta(ch.id).adjustability }));
  if (risk.requirementMismatch === true && reasons.length > 0) {
    const m = checkMeta("eligibility.requirements");
    blockers.push({ id: "eligibility.requirements", label: "Contradicts a required attribute", detail: attributeEvidence(risk), overridable: m.overridable, adjustability: m.adjustability });
  }
  const viable = reasons.length === 0 && evaluation.decision !== "BLOCK";
  return {
    offerId: offer.id,
    amounts,
    riskScore: risk.riskScore,
    evidenceCoverage: risk.evidenceCoverage,
    decision: viable ? evaluation.decision : "BLOCK",
    viable,
    blockers,
    approvalReasons: evaluation.checks.filter((ch) => ch.result === "REQUIRE_APPROVAL").map((ch) => ch.label),
  };
}

function attributeEvidence(risk: RiskAssessment | null): string {
  return risk?.factors.find((f) => f.id === "attributes")?.evidence ?? "Requirement evidence unavailable.";
}

/** Per-attribute match state, using the risk engine's own matching rules one attribute at a time. */
export function attributeStatuses(cand: ProductCandidate, c: MissionConstraints): AttributeStatus[] {
  return Object.entries(c.requiredAttributes).map(([key, required]) => {
    const ev = assessRisk(cand, { ...c, requiredAttributes: { [key]: required } }).attributeEvidence;
    const state: AttributeState = !ev ? "UNDISCLOSED" : ev.mismatched ? "MISMATCH" : ev.matched ? "MATCH" : ev.titleOnly ? "TITLE_ONLY" : "UNDISCLOSED";
    return { key, required, state };
  });
}

function measure(
  id: string,
  o: RecoveryOffer,
  c: MissionConstraints,
  policy: PolicyConfig,
): { actual: string; permitted: string; difference: string | null; differenceMinor: number | null } {
  const cur = c.currency;
  const total = o.totalMinor;
  const risk = o.riskScore;
  switch (id) {
    case "budget.mission":
      return total == null
        ? { actual: "Unknown total", permitted: `≤ ${money(c.budgetMinor, cur)}`, difference: null, differenceMinor: null }
        : { actual: money(total, cur), permitted: `≤ ${money(c.budgetMinor, cur)}`, difference: `${money(total - c.budgetMinor, cur)} over`, differenceMinor: total - c.budgetMinor };
    case "limit.max_purchase":
      return total == null
        ? { actual: "Unknown total", permitted: `≤ ${money(policy.maxPurchaseMinor, cur)}`, difference: null, differenceMinor: null }
        : { actual: money(total, cur), permitted: `≤ ${money(policy.maxPurchaseMinor, cur)}`, difference: `${money(total - policy.maxPurchaseMinor, cur)} over`, differenceMinor: total - policy.maxPurchaseMinor };
    case "floor.mission_budget_cap":
      return { actual: money(c.budgetMinor, cur), permitted: `≤ ${money(policy.maxMissionBudgetMinor, cur)}`, difference: `${money(c.budgetMinor - policy.maxMissionBudgetMinor, cur)} over`, differenceMinor: c.budgetMinor - policy.maxMissionBudgetMinor };
    case "risk.max":
      return { actual: risk == null ? "Unknown" : `Risk ${risk}`, permitted: `≤ ${100 - policy.minTrustScore}`, difference: risk == null ? null : `+${risk - (100 - policy.minTrustScore)} points`, differenceMinor: null };
    case "mission.risk_tolerance":
      return { actual: risk == null ? "Unknown" : `Risk ${risk}`, permitted: `≤ ${c.maxRiskScore ?? "—"}`, difference: risk == null || c.maxRiskScore == null ? null : `+${risk - c.maxRiskScore} points`, differenceMinor: null };
    case "risk.approval":
      return { actual: risk == null ? "Unknown" : `Risk ${risk}`, permitted: `≤ ${policy.approvalRiskScore} without approval`, difference: null, differenceMinor: null };
    case "evidence.coverage":
      return {
        actual: o.evidenceCoverage == null ? "Unknown" : `${o.evidenceCoverage}% of signals`,
        permitted: `≥ ${policy.minEvidenceCoverage}%`,
        difference: o.evidenceCoverage == null ? null : `${policy.minEvidenceCoverage - o.evidenceCoverage} points short`,
        differenceMinor: null,
      };
    case "seller.verification":
      return { actual: o.candidate.sellerVerificationStatus.toLowerCase(), permitted: policy.blockUnverifiedSellers ? "verified" : "verified (otherwise approval)", difference: null, differenceMinor: null };
    case "category":
      return { actual: o.candidate.category, permitted: policy.allowedCategories.length ? `one of: ${policy.allowedCategories.join(", ")}` : `not: ${policy.blockedCategories.join(", ")}`, difference: null, differenceMinor: null };
    case "floor.total_known":
      return {
        actual: [o.candidate.shippingMinor == null ? "shipping unknown" : null, o.candidate.taxMinor == null ? "tax unknown" : null].filter(Boolean).join(", ") || "unknown",
        permitted: "fully stated amount or a policy spending cap",
        difference: null,
        differenceMinor: null,
      };
    case "floor.currency":
      return { actual: o.candidate.currency, permitted: c.currency, difference: null, differenceMinor: null };
    case "floor.untrusted_content":
      return { actual: (o.risk?.injectionSignals ?? []).join(", ") || "instructions detected", permitted: "no agent-directed text", difference: null, differenceMinor: null };
    case "requirements.match":
    case "eligibility.requirements":
      return {
        actual: attributeEvidence(o.risk),
        permitted: Object.entries(c.requiredAttributes).map(([k, v]) => `${k} = ${v}`).join(", ") || "no requirements",
        difference: null,
        differenceMinor: null,
      };
    case "floor.spend_cap":
      return { actual: total == null ? "—" : `cap ${money(total, cur)}`, permitted: "approver sign-off", difference: null, differenceMinor: null };
    case "approval.threshold":
      return { actual: money(total, cur), permitted: `≤ ${money(policy.approvalThresholdMinor, cur)} without approval`, difference: null, differenceMinor: null };
    case "approval.auto_limit":
      return { actual: money(total, cur), permitted: `≤ ${money(policy.maxAutoPurchaseMinor, cur)} without approval`, difference: null, differenceMinor: null };
    default:
      return { actual: "See detail", permitted: "—", difference: null, differenceMinor: null };
  }
}

function riskDrivers(risk: RiskAssessment | null): string {
  if (!risk) return "";
  const top = risk.factors
    .filter((f) => f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 4)
    .map((f) => `${f.label} +${f.contribution}`);
  return top.length ? ` Risk drivers: ${top.join(", ")}.` : "";
}

function diagnose(o: RecoveryOffer, input: RecoveryInput): OfferDiagnosis {
  const c = input.constraints;
  const policy = input.evaluatedPolicy;
  const source = `Policy engine${input.evaluatedPolicyVersion ? ` (policy v${input.evaluatedPolicyVersion})` : ""}`;
  const toFailed = (id: string, label: string, result: FailedCheck["result"], detail: string, src: string): FailedCheck => {
    const meta = checkMeta(id);
    const m = measure(id, o, c, policy);
    const drivers = id === "risk.max" || id === "mission.risk_tolerance" ? riskDrivers(o.risk) : "";
    return {
      checkId: id,
      label,
      result,
      ...m,
      adjustability: meta.adjustability,
      adjustabilityLabel: ADJUSTABILITY_LABEL[meta.adjustability],
      overridable: meta.overridable,
      financial: meta.financial,
      evidence: detail + drivers,
      source: src,
      nextAction: meta.nextAction,
      budgetWontHelp: meta.financial ? null : (meta.budgetWontHelp ?? null),
    };
  };
  const checks = o.evaluation?.checks ?? [];
  const blocking = checks.filter((ch) => ch.result === "BLOCK").map((ch) => toFailed(ch.id, ch.label, "BLOCK", ch.detail, source));
  if (o.eligible === false && o.risk?.requirementMismatch === true) {
    blocking.push(toFailed("eligibility.requirements", "Contradicts a required attribute", "INELIGIBLE", attributeEvidence(o.risk), "Optimizer eligibility gate (risk engine evidence)"));
  }
  if (!o.evaluation) {
    blocking.push({
      checkId: "evaluation.missing",
      label: "No policy evaluation",
      result: "BLOCK",
      actual: "Unknown",
      permitted: "A completed evaluation",
      difference: null,
      differenceMinor: null,
      adjustability: "NONE",
      adjustabilityLabel: ADJUSTABILITY_LABEL.NONE,
      overridable: false,
      financial: false,
      evidence: "This offer has no stored policy evaluation (the workflow did not complete for it).",
      source: "Mission record",
      nextAction: "Re-run the mission.",
      budgetWontHelp: "Without an evaluation nothing can be authorised.",
    });
  }
  const approvals = checks.filter((ch) => ch.result === "REQUIRE_APPROVAL").map((ch) => toFailed(ch.id, ch.label, "REQUIRE_APPROVAL", ch.detail, source));
  const nonFinancial = blocking.filter((b) => !b.financial);
  const total = o.totalMinor;
  const quoted = new Date(o.quotedAt).getTime();
  const staleMs = (input.staleAfterHours ?? 24) * 3_600_000;
  return {
    offerId: o.id,
    productId: o.productId,
    title: o.candidate.title,
    sellerName: o.candidate.sellerName,
    provider: o.candidate.provider,
    isDemoData: o.candidate.isDemoData,
    offerUrl: o.candidate.offerUrl ?? null,
    unitPriceMinor: o.candidate.unitPriceMinor,
    quantity: c.quantity,
    itemTotalMinor: total == null ? null : total - (o.allowanceMinor ?? 0) - (o.candidate.shippingMinor ?? 0) - (o.candidate.taxMinor ?? 0),
    shippingMinor: o.candidate.shippingMinor,
    taxMinor: o.candidate.taxMinor,
    allowanceMinor: o.amountBasis === "CAP" ? o.allowanceMinor : null,
    totalMinor: total,
    totalBasis: basisOf(o.amountBasis, total),
    overBudgetMinor: total != null && total > c.budgetMinor ? total - c.budgetMinor : null,
    riskScore: o.riskScore,
    evidenceCoverage: o.evidenceCoverage,
    blocking,
    approvals,
    budgetOnly: blocking.length > 0 && nonFinancial.length === 0,
    nonFinancialBlockers: [...new Set(nonFinancial.map((b) => b.label))],
    missingInformation: o.risk?.missingInformation ?? [],
    attributes: attributeStatuses(o.candidate, c),
    quotedAt: o.quotedAt,
    stale: Number.isFinite(quoted) && input.now.getTime() - quoted > staleMs,
  };
}

// ------------------------------------------------------------------------------------ main

export function analyzeRecovery(input: RecoveryInput): RecoveryAnalysis {
  const c = input.constraints;
  const cur = c.currency;
  const policy = input.currentPolicy;
  const marginPct = Math.max(0, Math.min(25, Math.floor(input.marginPct ?? 5)));
  const offers = input.offers;
  const diagnoses = offers.map((o) => diagnose(o, input));

  const known = offers.filter((o) => o.totalMinor != null).sort((a, b) => (a.totalMinor as number) - (b.totalMinor as number) || a.id.localeCompare(b.id));
  const lowest = known[0] ?? null;
  const highest = known[known.length - 1] ?? null;
  const lowestTotal = lowest?.totalMinor ?? null;
  const shortfall = lowestTotal != null && lowestTotal > c.budgetMinor ? lowestTotal - c.budgetMinor : null;

  // ---- Option A: budget
  const unlocks: BudgetUnlock[] = [];
  for (const o of known) {
    const total = o.totalMinor as number;
    if (total <= c.budgetMinor) continue;
    const p = projectOffer(o, { ...c, budgetMinor: total }, policy);
    if (!p.viable || !p.amounts) continue;
    const exact = p.amounts.basis === "EXACT";
    // A CAP total already contains the allowance for undisclosed costs: no extra margin is suggested.
    const marginMinor = exact ? Math.ceil((p.amounts.totalMinor * marginPct) / 100) : 0;
    unlocks.push({
      offerId: o.id,
      title: o.candidate.title,
      basis: basisOf(p.amounts.basis, p.amounts.totalMinor),
      minBudgetMinor: p.amounts.totalMinor,
      increaseMinor: p.amounts.totalMinor - c.budgetMinor,
      increaseBps: bps(p.amounts.totalMinor - c.budgetMinor, c.budgetMinor),
      marginPct: exact ? marginPct : 0,
      marginMinor,
      suggestedBudgetMinor: Math.min(p.amounts.totalMinor + marginMinor, policy.maxMissionBudgetMinor),
      exceedsPolicyCap: p.amounts.totalMinor > policy.maxMissionBudgetMinor,
      projectedDecision: p.decision,
      approvalReasons: p.approvalReasons,
    });
    if (unlocks.length >= 3) break;
  }
  let lowestFit: BudgetAnalysis["lowestFit"] = null;
  if (lowest && (lowest.totalMinor as number) > c.budgetMinor) {
    const t = lowest.totalMinor as number;
    const p = projectOffer(lowest, { ...c, budgetMinor: t }, policy);
    lowestFit = { offerId: lowest.id, title: lowest.candidate.title, minBudgetMinor: t, increaseMinor: t - c.budgetMinor, increaseBps: bps(t - c.budgetMinor, c.budgetMinor), remainingBlockers: [...new Set(p.blockers.map((b) => b.label))] };
  }
  const budget: BudgetAnalysis = {
    currentBudgetMinor: c.budgetMinor,
    lowestTotalMinor: lowestTotal,
    lowestOfferId: lowest?.id ?? null,
    lowestBasis: lowest ? basisOf(lowest.amountBasis, lowest.totalMinor) : null,
    highestTotalMinor: highest?.totalMinor ?? null,
    shortfallMinor: shortfall,
    shortfallBps: shortfall == null ? null : bps(shortfall, c.budgetMinor),
    unlock: unlocks[0] ?? null,
    otherUnlocks: unlocks.slice(1),
    budgetAloneInsufficient: unlocks.length === 0 && known.some((o) => (o.totalMinor as number) > c.budgetMinor),
    lowestFit,
    policyCapMinor: policy.maxMissionBudgetMinor,
  };

  // ---- Option B: quantity (same budget, fewer units)
  const qNote = (o: RecoveryOffer, q: number, a: PurchaseAmounts) =>
    a.basis === "EXACT"
      ? `${q} × ${money(o.candidate.unitPriceMinor, cur)} + disclosed shipping ${money(a.shippingMinor, cur)} + tax ${money(a.taxMinor, cur)}. The provider quoted shipping and tax once, not per quantity; a smaller order may be taxed differently, so this is an estimate until re-quoted.`
      : `${q} × ${money(o.candidate.unitPriceMinor, cur)} + ${policy.costAllowancePct}% allowance ${money(a.allowanceMinor, cur)} = spending cap. Exact cap under your policy; the final charge (≤ cap) depends on undisclosed shipping/tax.`;
  let bestEffort: QuantityAnalysis["bestEffort"] = null;
  const qCandidates: QuantityCandidate[] = [];
  let qReason: string | null = null;
  if (c.quantity <= 1) qReason = "The mission asks for a single unit; there is no smaller quantity.";
  else {
    for (const o of known) {
      if ((o.totalMinor as number) <= c.budgetMinor) continue;
      const stockCap = o.candidate.stockQuantity ?? c.quantity - 1;
      const fit = maxFeasibleQuantity(o.candidate, c.budgetMinor, policy.costAllowancePct, Math.min(c.quantity - 1, stockCap));
      if (!fit) continue;
      const p = projectOffer(o, { ...c, quantity: fit.quantity }, policy);
      if (!bestEffort && o === lowest) {
        bestEffort = {
          offerId: o.id,
          title: o.candidate.title,
          quantity: fit.quantity,
          unitsFewer: c.quantity - fit.quantity,
          totalMinor: fit.amounts.totalMinor,
          basis: basisOf(fit.amounts.basis, fit.amounts.totalMinor),
          estimate: fit.amounts.basis === "EXACT",
          note: qNote(o, fit.quantity, fit.amounts),
          remainingBlockers: [...new Set(p.blockers.map((b) => b.label))],
        };
      }
      if (!p.viable) continue;
      const exact = fit.amounts.basis === "EXACT";
      qCandidates.push({
        offerId: o.id,
        title: o.candidate.title,
        quantity: fit.quantity,
        unitsFewer: c.quantity - fit.quantity,
        totalMinor: fit.amounts.totalMinor,
        basis: basisOf(fit.amounts.basis, fit.amounts.totalMinor),
        estimate: exact,
        note: qNote(o, fit.quantity, fit.amounts),
        projectedDecision: p.decision,
        approvalReasons: p.approvalReasons,
      });
      if (qCandidates.length >= 3) break;
    }
    if (qCandidates.length === 0) {
      qReason = known.length === 0
        ? "No offer has a statable total, so no quantity can be priced."
        : "Even at a smaller quantity, no offer passes every other check (see the failed checks), or not even one unit fits the budget.";
    }
  }
  const quantity: QuantityAnalysis = {
    requestedQuantity: c.quantity,
    candidates: qCandidates,
    bestEffort,
    reason: qReason,
    pricingNote: "Providers returned one unit price per offer: no quantity-tier discounts or minimum order quantities were disclosed, so a constant unit price is assumed.",
  };

  // ---- Option D: delivery
  const deliveryItems: DeliveryItem[] = [];
  let undisclosedDelivery = 0;
  for (const o of offers) {
    const f = o.risk?.factors.find((x) => x.id === "delivery");
    if (!f) continue;
    if (f.status === "MISSING") undisclosedDelivery += 1;
    const est = o.candidate.shippingEstimateDays;
    if (f.status !== "CONCERN" || est == null || c.deadlineDays == null) continue;
    const p = projectOffer(o, { ...c, deadlineDays: est }, policy);
    deliveryItems.push({ offerId: o.id, title: o.candidate.title, estimateDays: est, deadlineDays: c.deadlineDays, riskReduction: f.contribution, unlocks: p.viable, projectedDecision: p.decision });
  }
  const shipping = offers
    .filter((o) => o.amountBasis !== "CAP" && o.candidate.shippingMinor != null && o.totalMinor != null && o.totalMinor > 0)
    .map((o) => ({ offerId: o.id, title: o.candidate.title, shippingMinor: o.candidate.shippingMinor as number, totalMinor: o.totalMinor as number, shareBps: bps(o.candidate.shippingMinor as number, o.totalMinor as number) }))
    .sort((a, b) => b.shareBps - a.shareBps)
    .slice(0, 5);
  const delivery: DeliveryAnalysis = {
    deadlineDays: c.deadlineDays,
    items: deliveryItems,
    undisclosedCount: undisclosedDelivery,
    shipping,
    slowerShippingOptionsAvailable: false,
    relevant: deliveryItems.length > 0,
  };

  // ---- Option E: requirements (one attribute made optional at a time, budget unchanged)
  const reqAttrs = Object.entries(c.requiredAttributes);
  const baseline = new Map(offers.map((o) => [o.id, projectOffer(o, c, policy).viable]));
  const requirements: RequirementAnalysis = {
    attributes: reqAttrs.map(([key, value]) => {
      const counts: Record<AttributeState, number> = { MATCH: 0, TITLE_ONLY: 0, UNDISCLOSED: 0, MISMATCH: 0 };
      for (const d of diagnoses) {
        const s = d.attributes.find((a) => a.key === key);
        if (s) counts[s.state] += 1;
      }
      const rest = Object.fromEntries(reqAttrs.filter(([k]) => k !== key));
      const unlockOfferIds = offers.filter((o) => !baseline.get(o.id) && projectOffer(o, { ...c, requiredAttributes: rest }, policy).viable).map((o) => o.id);
      return { key, value, counts, unlockOfferIds };
    }),
  };

  // ---- Combined: the smallest set of mission changes that makes each offer viable
  const paths: EligibilityPath[] = [];
  for (const o of known.slice(0, 12)) {
    const d = diagnoses.find((x) => x.offerId === o.id) as OfferDiagnosis;
    const total = o.totalMinor as number;
    const delivF = o.risk?.factors.find((x) => x.id === "delivery");
    const relaxDeadline = delivF?.status === "CONCERN" && o.candidate.shippingEstimateDays != null && c.deadlineDays != null;
    const newBudget = Math.max(c.budgetMinor, total);
    const mismatched = d.attributes.filter((a) => a.state === "MISMATCH").map((a) => a.key);
    const unmatched = d.attributes.filter((a) => a.state !== "MATCH").map((a) => a.key);
    const attempts: string[][] = [[], mismatched, unmatched].filter((set, i, all) => i === 0 || set.length > all[i - 1].length);
    let chosen: { drop: string[]; p: Projection; c2: MissionConstraints } | null = null;
    for (const drop of attempts) {
      const c2: MissionConstraints = {
        ...c,
        budgetMinor: newBudget,
        deadlineDays: relaxDeadline ? (o.candidate.shippingEstimateDays as number) : c.deadlineDays,
        requiredAttributes: Object.fromEntries(reqAttrs.filter(([k]) => !drop.includes(k))),
      };
      const p = projectOffer(o, c2, policy);
      chosen = { drop, p, c2 };
      if (p.viable) break;
    }
    if (!chosen) continue;
    const changes: PathChange[] = [];
    if (newBudget !== c.budgetMinor) changes.push({ field: "budgetMinor", label: "Budget", from: money(c.budgetMinor, cur), to: money(newBudget, cur), relaxesMandatory: false });
    if (chosen.c2.deadlineDays !== c.deadlineDays) changes.push({ field: "deadlineDays", label: "Delivery deadline", from: `${c.deadlineDays} days`, to: `${chosen.c2.deadlineDays} days`, relaxesMandatory: false });
    for (const k of chosen.drop) changes.push({ field: "requiredAttributes", label: `Requirement "${k}"`, from: `${k} = ${c.requiredAttributes[k]} (required)`, to: "optional (not verified)", relaxesMandatory: true });
    paths.push({
      offerId: o.id,
      title: o.candidate.title,
      totalMinor: chosen.p.amounts?.totalMinor ?? total,
      basis: basisOf(o.amountBasis, total),
      changes,
      proposed: { budgetMinor: chosen.c2.budgetMinor, deadlineDays: chosen.c2.deadlineDays, requiredAttributes: chosen.c2.requiredAttributes },
      viable: chosen.p.viable,
      projectedDecision: chosen.p.decision,
      approvalReasons: chosen.p.approvalReasons,
      remainingBlockers: chosen.p.viable ? [] : chosen.p.blockers,
    });
  }
  paths.sort((a, b) => Number(b.viable) - Number(a.viable) || a.changes.filter((x) => x.relaxesMandatory).length - b.changes.filter((x) => x.relaxesMandatory).length || (a.totalMinor ?? 0) - (b.totalMinor ?? 0));

  // ---- Override eligibility (from the STORED evaluation)
  const overridable = new Map<string, { checkId: string; label: string; policyField: string | null; offerCount: number }>();
  const notOverridable = new Map<string, { checkId: string; label: string; reason: string; offerCount: number }>();
  for (const d of diagnoses) {
    for (const b of d.blocking) {
      const meta = checkMeta(b.checkId);
      if (meta.overridable && meta.policyField) {
        const e = overridable.get(b.checkId) ?? { checkId: b.checkId, label: b.label, policyField: meta.policyField, offerCount: 0 };
        e.offerCount += 1;
        overridable.set(b.checkId, e);
      } else {
        const reason =
          meta.adjustability === "MISSION"
            ? "This is one of your own mission constraints. Revise the mission instead of requesting an override."
            : meta.adjustability === "EVIDENCE"
              ? "This needs better offer data; no reviewer can supply missing facts."
              : "System-enforced floor: it cannot be overridden through the application.";
        const e = notOverridable.get(b.checkId) ?? { checkId: b.checkId, label: b.label, reason, offerCount: 0 };
        e.offerCount += 1;
        notOverridable.set(b.checkId, e);
      }
    }
  }
  const overrideEligible = input.decision === "BLOCK" && overridable.size > 0;
  const override: OverrideAnalysis = {
    eligible: overrideEligible,
    overridable: [...overridable.values()].sort((a, b) => b.offerCount - a.offerCount),
    notOverridable: [...notOverridable.values()].sort((a, b) => b.offerCount - a.offerCount),
    explanation: overrideEligible
      ? "You can ask an authorised policy reviewer to review these policy rules. A request is not an authorization: nothing changes, and checkout stays disabled, unless the policy owner publishes a new policy version and the mission is re-evaluated and approved by a human."
      : input.decision !== "BLOCK"
        ? "Overrides apply only to blocked missions."
        : "None of the failing checks is a policy rule a reviewer could change. Revise the mission or choose different offers.",
  };

  // ---- Staleness
  const quoteTimes = offers.map((o) => new Date(o.quotedAt).getTime()).filter(Number.isFinite);
  const oldest = quoteTimes.length ? Math.min(...quoteTimes) : null;
  const oldestHours = oldest == null ? null : Math.floor((input.now.getTime() - oldest) / 3_600_000);
  const stale = diagnoses.some((d) => d.stale);
  const staleness = {
    stale,
    oldestQuoteHours: oldestHours,
    note: stale ? `Some prices were quoted ${oldestHours} hours ago. A revised mission re-fetches every offer, and checkout re-validates the amount before any payment.` : null,
  };

  // ---- Why blocked (plain language)
  const whyBlocked: string[] = [];
  const blockedCount = diagnoses.filter((d) => d.blocking.length > 0).length;
  if (offers.length === 0) whyBlocked.push("The product provider returned no offers for this search, so there was nothing to evaluate.");
  if (shortfall != null && lowest) {
    whyBlocked.push(`The lowest identified ${lowest.amountBasis === "CAP" ? "spending cap" : "total"} (${money(lowestTotal, cur)}, "${lowest.candidate.title}") is ${money(shortfall, cur)} above the ${money(c.budgetMinor, cur)} budget.`);
    if (known.length > 1) whyBlocked.push(`The other ${known.length - 1} offer${known.length > 2 ? "s are" : " is"} more expensive (up to ${money(highest?.totalMinor, cur)}).`);
  }
  const nonFinCounts = new Map<string, number>();
  for (const d of diagnoses) for (const l of d.nonFinancialBlockers) nonFinCounts.set(l, (nonFinCounts.get(l) ?? 0) + 1);
  for (const [label, n] of [...nonFinCounts.entries()].sort((a, b) => b[1] - a[1])) {
    whyBlocked.push(`${n} of ${offers.length} offers also fail "${label}".`);
  }
  if (budget.budgetAloneInsufficient) whyBlocked.push("Raising the budget alone would not unlock any offer: each one also fails a non-financial check.");
  if (known.length > 0 && known.every((o) => o.amountBasis === "CAP")) {
    whyBlocked.push(`No seller disclosed shipping or tax. Every total is a spending cap: item total + ${input.evaluatedPolicy.costAllowancePct}% allowance (the most AEGIS would ever let PayPal capture).`);
  }

  // ---- Recommendations (most practical first)
  const recs: Recommendation[] = [];
  const u = budget.unlock;
  if (u) {
    recs.push({
      id: "INCREASE_BUDGET",
      title: "Increase budget",
      whatChanges: `Budget ${money(c.budgetMinor, cur)} → ${money(u.suggestedBudgetMinor, cur)}${u.marginMinor ? ` (minimum ${money(u.minBudgetMinor, cur)} + ${u.marginPct}% safety margin ${money(u.marginMinor, cur)})` : ""}.`,
      whyItHelps: `"${u.title}" totals ${money(u.minBudgetMinor, cur)}; budget is its only failing check. Increase: ${money(u.increaseMinor, cur)} (+${formatBps(u.increaseBps)}).`,
      estimatedCost: `${money(u.minBudgetMinor, cur)} ${u.basis === "CAP" ? "spending cap (final charge ≤ cap)" : "verified all-in total"}`,
      tradeoffs: ["You spend more than originally planned.", ...(u.exceedsPolicyCap ? ["Exceeds the policy's mission cap: blocked by the floor check unless the policy owner raises it."] : [])],
      stillMustPass: ["Every policy check is re-run on a fresh search", ...u.approvalReasons.map((r) => `${r} (needs a human)`), "Human approval of the exact purchase snapshot"],
      exactness: u.basis === "CAP" ? "CAP" : "EXACT",
      proposedChanges: { budgetMinor: u.suggestedBudgetMinor },
      resolves: !u.exceedsPolicyCap,
    });
  }
  const lf = budget.lowestFit;
  if (!u && lf) {
    recs.push({
      id: "INCREASE_BUDGET",
      title: "Increase budget",
      whatChanges: `Budget ${money(c.budgetMinor, cur)} → ${money(lf.minBudgetMinor, cur)}: the minimum to fit the lowest identified total (+${money(lf.increaseMinor, cur)}, +${formatBps(lf.increaseBps)}).`,
      whyItHelps: lf.remainingBlockers.length
        ? `Makes "${lf.title}" financially eligible, but it would still fail: ${lf.remainingBlockers.join(", ")}. Raising the budget alone unlocks none of the ${known.length} offers.`
        : `Makes "${lf.title}" financially eligible.`,
      estimatedCost: `${money(lf.minBudgetMinor, cur)} ${lowest?.amountBasis === "CAP" ? "spending cap" : "total"}`,
      tradeoffs: ["A larger budget does not make any offer safe or approved; every other check still applies."],
      stillMustPass: lf.remainingBlockers.length ? lf.remainingBlockers : ["Every policy check on a fresh search"],
      exactness: lowest?.amountBasis === "CAP" ? "CAP" : "EXACT",
      proposedChanges: { budgetMinor: lf.minBudgetMinor },
      resolves: false,
    });
  }
  const be = quantity.bestEffort;
  if (quantity.candidates.length === 0 && be && be.quantity > 0) {
    recs.push({
      id: "REDUCE_QUANTITY",
      title: "Reduce quantity",
      whatChanges: `Quantity ${c.quantity} → ${be.quantity} (${be.unitsFewer} fewer) fits the ${money(c.budgetMinor, cur)} budget at ${money(be.totalMinor, cur)}.`,
      whyItHelps: be.remainingBlockers.length ? `Fixes the budget check for "${be.title}", but it would still fail: ${be.remainingBlockers.join(", ")}.` : `Fits "${be.title}" within budget.`,
      estimatedCost: `${money(be.totalMinor, cur)}${be.estimate ? " (estimate)" : be.basis === "CAP" ? " spending cap" : ""}`,
      tradeoffs: ["Partial fulfilment. Only choose this if fewer units are acceptable."],
      stillMustPass: be.remainingBlockers.length ? be.remainingBlockers : ["Every policy check on a fresh search"],
      exactness: be.estimate ? "ESTIMATE" : be.basis === "CAP" ? "CAP" : "EXACT",
      proposedChanges: { quantity: be.quantity },
      resolves: false,
    });
  }
  const q = quantity.candidates[0];
  if (q) {
    recs.push({
      id: "REDUCE_QUANTITY",
      title: "Reduce quantity",
      whatChanges: `Quantity ${c.quantity} → ${q.quantity} (${q.unitsFewer} fewer), budget unchanged.`,
      whyItHelps: `${q.quantity} units of "${q.title}" come to ${money(q.totalMinor, cur)}, within the ${money(c.budgetMinor, cur)} budget.`,
      estimatedCost: `${money(q.totalMinor, cur)}${q.estimate ? " (estimate)" : q.basis === "CAP" ? " spending cap" : ""}`,
      tradeoffs: [`Partial fulfilment: ${q.unitsFewer} unit${q.unitsFewer === 1 ? "" : "s"} short of the request. Only choose this if partial fulfilment is acceptable.`],
      stillMustPass: ["Every policy check on a fresh search", ...q.approvalReasons.map((r) => `${r} (needs a human)`), "Human approval of the exact purchase snapshot"],
      exactness: q.estimate ? "ESTIMATE" : q.basis === "CAP" ? "CAP" : "EXACT",
      proposedChanges: { quantity: q.quantity },
      resolves: true,
    });
  }
  const viablePaths = paths.filter((p) => p.viable && p.changes.length > 0);
  const bestPath = viablePaths[0];
  if (bestPath && !(u && bestPath.offerId === u.offerId && bestPath.changes.length === 1)) {
    const relaxes = bestPath.changes.filter((x) => x.relaxesMandatory);
    recs.push({
      id: relaxes.length ? "CHANGE_REQUIREMENTS" : "COMBINED_PATH",
      title: relaxes.length ? "Adjust requirements" : "Combine adjustments",
      whatChanges: bestPath.changes.map((x) => `${x.label}: ${x.from} → ${x.to}`).join("; ") + ".",
      whyItHelps: `With these changes "${bestPath.title}" (${money(bestPath.totalMinor, cur)}) passes every check in a projection on the offers already found.`,
      estimatedCost: `${money(bestPath.totalMinor, cur)} ${bestPath.basis === "CAP" ? "spending cap" : "total"}`,
      tradeoffs: [
        ...relaxes.map((x) => `${x.label.replace("Requirement ", "")} would no longer be verified: AEGIS cannot confirm the product meets it. Never relax a safety, compatibility or certification requirement.`),
        ...(bestPath.changes.some((x) => x.field === "budgetMinor") ? ["Higher spend than planned."] : []),
      ],
      stillMustPass: ["Every policy check on a fresh search", ...bestPath.approvalReasons.map((r) => `${r} (needs a human)`), "Human approval of the exact purchase snapshot"],
      exactness: "PROJECTION",
      proposedChanges: { budgetMinor: bestPath.proposed.budgetMinor, deadlineDays: bestPath.proposed.deadlineDays, requiredAttributes: bestPath.proposed.requiredAttributes },
      resolves: true,
    });
  }
  const dItem = delivery.items.find((x) => x.unlocks);
  if (dItem && !recs.some((r) => r.proposedChanges?.deadlineDays === dItem.estimateDays)) {
    recs.push({
      id: "ADJUST_DELIVERY",
      title: "Relax delivery deadline",
      whatChanges: `Deadline ${dItem.deadlineDays} → ${dItem.estimateDays} days.`,
      whyItHelps: `"${dItem.title}" estimates ${dItem.estimateDays} days; the missed deadline adds ${dItem.riskReduction} risk points.`,
      estimatedCost: "No price change",
      tradeoffs: ["Items arrive later than originally required."],
      stillMustPass: ["Every policy check on a fresh search", "Human approval of the exact purchase snapshot"],
      exactness: "PROJECTION",
      proposedChanges: { deadlineDays: dItem.estimateDays },
      resolves: true,
    });
  }
  recs.push({
    id: "FIND_ALTERNATIVES",
    title: "Search alternatives",
    whatChanges: "Nothing changes yet: AEGIS searches the product provider again for offers matching your specification and quantity.",
    whyItHelps: "A different seller, brand or listing may meet every requirement within the current budget.",
    estimatedCost: "Depends on results",
    tradeoffs: ["Results are previews; buying still needs a revised mission run and human approval."],
    stillMustPass: ["Requirement match", "Budget", "Seller evidence and risk", "Human approval"],
    exactness: "N/A",
    proposedChanges: null,
    resolves: false,
  });
  if (diagnoses.some((d) => d.blocking.some((b) => b.checkId === "floor.total_known" || b.checkId === "evidence.coverage")) || stale) {
    recs.push({
      id: "REFRESH_QUOTE",
      title: "Refresh quotes",
      whatChanges: "Re-run the mission under the current policy to re-fetch offers and their disclosed data.",
      whyItHelps: "Missing shipping, tax or listing data — and stale prices — can only be fixed by fresher provider data.",
      estimatedCost: "No change",
      tradeoffs: ["The provider may return the same data."],
      stillMustPass: ["Every policy check"],
      exactness: "N/A",
      proposedChanges: {},
      resolves: false,
    });
  }
  if (override.eligible) {
    recs.push({
      id: "REQUEST_OVERRIDE",
      title: "Request policy override",
      whatChanges: "Nothing, until an authorised reviewer decides and the policy owner publishes a new policy version.",
      whyItHelps: `Asks for review of: ${override.overridable.map((x) => x.label).join(", ")}.`,
      estimatedCost: "—",
      tradeoffs: ["Not an authorization to buy; checkout stays disabled.", "You cannot review your own request."],
      stillMustPass: ["Re-evaluation under the new policy", "Every remaining check", "Human approval of the exact purchase snapshot"],
      exactness: "N/A",
      proposedChanges: null,
      resolves: false,
    });
  }

  // Most practical first: something that resolves without relaxing a mandatory requirement, then the rest.
  const order = new Map(recs.map((r, i) => [r, i]));
  const rank = (r: Recommendation) => {
    if (!r.resolves) return 10 + (order.get(r) ?? 0);
    if (r.id === "INCREASE_BUDGET" && u && u.increaseBps <= 5_000) return 0;
    if (r.id === "REDUCE_QUANTITY") return 1;
    if (r.id === "INCREASE_BUDGET") return 2;
    if (r.id === "ADJUST_DELIVERY" || r.id === "COMBINED_PATH") return 3;
    return 4;
  };
  recs.sort((a, b) => rank(a) - rank(b));
  const first = recs[0];
  const nextAction = {
    optionId: first.id,
    label: first.resolves ? `${first.title}: ${first.whatChanges}` : first.id === "FIND_ALTERNATIVES" ? "Search for alternative offers within your budget" : first.title,
  };

  const cited = new Set<string>();
  const cite = (m: number | null | undefined) => {
    if (m != null) cited.add(money(m, cur));
  };
  cite(c.budgetMinor);
  cite(lowestTotal);
  cite(highest?.totalMinor);
  cite(shortfall);
  for (const o of offers) {
    cite(o.totalMinor);
    cite(o.candidate.unitPriceMinor);
    cite(o.candidate.shippingMinor);
    cite(o.candidate.taxMinor);
    cite(o.allowanceMinor);
    if (o.totalMinor != null && o.totalMinor > c.budgetMinor) cite(o.totalMinor - c.budgetMinor);
  }
  for (const x of unlocks) [x.minBudgetMinor, x.increaseMinor, x.suggestedBudgetMinor, x.marginMinor].forEach(cite);
  for (const x of qCandidates) cite(x.totalMinor);
  if (bestEffort) cite((bestEffort as { totalMinor: number }).totalMinor);
  if (lowestFit) [lowestFit.minBudgetMinor, lowestFit.increaseMinor].forEach(cite);
  for (const p of paths) [p.totalMinor, p.proposed.budgetMinor].forEach(cite);
  cite(policy.maxMissionBudgetMinor);
  cite(policy.maxPurchaseMinor);

  return {
    summary: {
      title: c.title,
      currency: cur,
      budgetMinor: c.budgetMinor,
      quantity: c.quantity,
      offerCount: offers.length,
      blockedCount,
      lowestTotalMinor: lowestTotal,
      highestTotalMinor: highest?.totalMinor ?? null,
      shortfallMinor: shortfall,
      arithmetic: shortfall != null ? `${money(lowestTotal, cur)} − ${money(c.budgetMinor, cur)} = ${money(shortfall, cur)}` : null,
      allCapped: known.length > 0 && known.every((o) => o.amountBasis === "CAP"),
      anyDemoData: offers.some((o) => o.candidate.isDemoData),
      decision: input.decision,
      missionVersion: input.missionVersion,
      evaluatedPolicyVersion: input.evaluatedPolicyVersion,
      currentPolicyVersion: input.currentPolicyVersion,
      policyChangedSinceEvaluation: input.evaluatedPolicyVersion != null && input.evaluatedPolicyVersion !== input.currentPolicyVersion,
    },
    whyBlocked,
    offers: diagnoses,
    budget,
    quantity,
    delivery,
    requirements,
    paths: paths.slice(0, 6),
    override,
    staleness,
    recommendations: recs,
    nextAction,
    citedAmounts: [...cited],
    projectionNote:
      "Projections re-run AEGIS's own pricing, risk, eligibility and policy engines on the offers already found, under the current policy. They are not decisions: a revised mission searches the provider again, re-checks duplicates, and every purchase still needs human approval.",
  };
}

/** Projects a full set of proposed constraints across all offers (revision preview). */
export function projectRevision(offers: RecoveryOffer[], c: MissionConstraints, policy: PolicyConfig) {
  const projections = offers.map((o) => ({ offer: o, p: projectOffer(o, c, policy) }));
  const viable = projections.filter((x) => x.p.viable).sort((a, b) => (a.p.amounts?.totalMinor ?? 0) - (b.p.amounts?.totalMinor ?? 0));
  const best = viable[0] ?? null;
  return {
    viableCount: viable.length,
    offerCount: offers.length,
    projectedDecision: (best ? best.p.decision : "BLOCK") as DecisionValue,
    best: best ? { offerId: best.offer.id, title: best.offer.candidate.title, totalMinor: best.p.amounts?.totalMinor ?? null, basis: basisOf(best.p.amounts?.basis, best.p.amounts?.totalMinor ?? null) } : null,
    offers: projections.map(({ offer, p }) => ({
      offerId: offer.id,
      title: offer.candidate.title,
      totalMinor: p.amounts?.totalMinor ?? null,
      basis: basisOf(p.amounts?.basis, p.amounts?.totalMinor ?? null),
      riskScore: p.riskScore,
      evidenceCoverage: p.evidenceCoverage,
      decision: p.decision,
      viable: p.viable,
      blockers: p.blockers,
      approvalReasons: p.approvalReasons,
    })),
  };
}
export type RevisionProjection = ReturnType<typeof projectRevision>;
