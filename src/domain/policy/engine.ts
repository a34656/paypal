/**
 * Policy engine — a pure function. No I/O, no clock, no randomness.
 *
 *   evaluate(snapshot, policy, context) → { decision, reasons, checks }
 *
 * Precedence: BLOCK > REQUIRE_APPROVAL > ALLOW_CHECKOUT (most restrictive wins).
 * The FLOOR checks are hard-coded and cannot be disabled by any configuration.
 * ALLOW_CHECKOUT never means "capture without a human": it only lets the purchase
 * proceed to checkout, where the AEGIS approval record and PayPal buyer approval still apply.
 */
import { isSupportedCurrency, MAX_MINOR, toProviderDecimal } from "@/lib/money";
import type { DecisionValue, SellerVerification } from "@/domain/types";
import { hashCanonical } from "@/lib/canonical";
import type { PolicyConfig } from "./schema";

export type CheckResult = "PASS" | "REQUIRE_APPROVAL" | "BLOCK";

export interface PolicyCheck {
  id: string;
  label: string;
  result: CheckResult;
  detail: string;
  floor: boolean;
}

export interface PolicySnapshot {
  missionBudgetMinor: number;
  missionCurrency: string;
  quantity: number;
  productCurrency: string;
  unitPriceMinor: number;
  shippingMinor: number | null;
  taxMinor: number | null;
  /** All-in total; null when it cannot be determined (unknown shipping/tax). */
  totalMinor: number | null;
  category: string;
  sellerVerification: SellerVerification;
  riskScore: number | null;
  evidenceCoverage: number | null;
  requirementMismatch: boolean | null;
}

export interface PolicyContext {
  /** Same owner bought the same thing (fingerprint match) within the policy window. */
  duplicateDetected: boolean;
}

export interface PolicyEvaluation {
  decision: DecisionValue;
  reasons: string[];
  checks: PolicyCheck[];
}

const RANK: Record<CheckResult, number> = { PASS: 0, REQUIRE_APPROVAL: 1, BLOCK: 2 };
const RANK_DECISION: Record<DecisionValue, number> = { ALLOW_CHECKOUT: 0, REQUIRE_APPROVAL: 1, BLOCK: 2 };

export function mostRestrictive(a: DecisionValue, b: DecisionValue): DecisionValue {
  return RANK_DECISION[a] >= RANK_DECISION[b] ? a : b;
}

function isValidMinor(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_MINOR;
}

const fmt = (minor: number, currency: string) =>
  isSupportedCurrency(currency) && isValidMinor(minor) ? `${toProviderDecimal(minor, currency)} ${currency}` : `${minor} minor units ${currency}`;

export function evaluate(snapshot: PolicySnapshot, policy: PolicyConfig, context: PolicyContext): PolicyEvaluation {
  const checks: PolicyCheck[] = [];
  const add = (id: string, label: string, result: CheckResult, detail: string, floor = false) =>
    checks.push({ id, label, result, detail, floor });

  // ---------------------------------------------------------------- FLOOR (not configurable)
  const amountsValid =
    isValidMinor(snapshot.unitPriceMinor) &&
    isValidMinor(snapshot.missionBudgetMinor) &&
    snapshot.missionBudgetMinor > 0 &&
    Number.isSafeInteger(snapshot.quantity) &&
    snapshot.quantity > 0 &&
    (snapshot.shippingMinor === null || isValidMinor(snapshot.shippingMinor)) &&
    (snapshot.taxMinor === null || isValidMinor(snapshot.taxMinor)) &&
    (snapshot.totalMinor === null || (isValidMinor(snapshot.totalMinor) && snapshot.totalMinor > 0));
  add(
    "floor.amounts_valid",
    "Amounts are valid integers",
    amountsValid ? "PASS" : "BLOCK",
    amountsValid ? "All amounts are non-negative integer minor units." : "Malformed, negative, or out-of-range amount.",
    true,
  );

  const currencyOk =
    isSupportedCurrency(snapshot.productCurrency) &&
    snapshot.productCurrency === snapshot.missionCurrency &&
    snapshot.missionCurrency === policy.currency;
  add(
    "floor.currency",
    "Single supported currency",
    currencyOk ? "PASS" : "BLOCK",
    currencyOk
      ? `Product, mission and policy all use ${policy.currency}.`
      : `Currency mismatch or unsupported (product ${snapshot.productCurrency}, mission ${snapshot.missionCurrency}, policy ${policy.currency}). No currency conversion in this MVP.`,
    true,
  );

  const totalKnown = snapshot.totalMinor !== null;
  add(
    "floor.total_known",
    "All-in total is known",
    totalKnown ? "PASS" : "BLOCK",
    totalKnown
      ? "Unit price × quantity + shipping + tax is fully determined."
      : `Cannot authorise an amount that cannot be stated: ${[
          snapshot.shippingMinor === null ? "shipping" : null,
          snapshot.taxMinor === null ? "tax" : null,
        ]
          .filter(Boolean)
          .join(" and ")} not disclosed.`,
    true,
  );

  const riskKnown = snapshot.riskScore !== null && snapshot.evidenceCoverage !== null;
  add(
    "floor.risk_evaluated",
    "Risk assessment present",
    riskKnown ? "PASS" : "BLOCK",
    riskKnown ? "Deterministic risk assessment completed." : "No risk assessment: fail closed.",
    true,
  );

  const budgetWithinPolicy = snapshot.missionBudgetMinor <= policy.maxMissionBudgetMinor;
  add(
    "floor.mission_budget_cap",
    "Mission budget within policy cap",
    budgetWithinPolicy ? "PASS" : "BLOCK",
    budgetWithinPolicy
      ? "Mission budget does not exceed the policy maximum."
      : `Mission budget ${fmt(snapshot.missionBudgetMinor, snapshot.missionCurrency)} exceeds the policy cap ${fmt(policy.maxMissionBudgetMinor, policy.currency)}. Mission text cannot raise limits.`,
    true,
  );

  // ---------------------------------------------------------------- CONFIGURABLE
  const total = snapshot.totalMinor;
  if (total !== null && amountsValid) {
    const overBudget = total > snapshot.missionBudgetMinor;
    add(
      "budget.mission",
      "Within mission budget",
      !overBudget ? "PASS" : policy.blockOverBudget ? "BLOCK" : "REQUIRE_APPROVAL",
      !overBudget
        ? `Total ${fmt(total, snapshot.missionCurrency)} ≤ budget ${fmt(snapshot.missionBudgetMinor, snapshot.missionCurrency)}.`
        : `Total ${fmt(total, snapshot.missionCurrency)} exceeds the mission budget ${fmt(snapshot.missionBudgetMinor, snapshot.missionCurrency)}.`,
    );

    const overMax = total > policy.maxPurchaseMinor;
    add(
      "limit.max_purchase",
      "Within max individual purchase",
      overMax ? "BLOCK" : "PASS",
      overMax
        ? `Total exceeds the max individual purchase ${fmt(policy.maxPurchaseMinor, policy.currency)}.`
        : `Below max individual purchase ${fmt(policy.maxPurchaseMinor, policy.currency)}.`,
    );

    const overThreshold = total > policy.approvalThresholdMinor;
    add(
      "approval.threshold",
      "Approval threshold",
      overThreshold ? "REQUIRE_APPROVAL" : "PASS",
      overThreshold
        ? `Total exceeds the approval threshold ${fmt(policy.approvalThresholdMinor, policy.currency)}.`
        : "Below the approval threshold.",
    );

    const overAuto = total > policy.maxAutoPurchaseMinor;
    add(
      "approval.auto_limit",
      "Automatic purchase limit",
      overAuto ? "REQUIRE_APPROVAL" : "PASS",
      overAuto
        ? `Total exceeds the max automatic purchase ${fmt(policy.maxAutoPurchaseMinor, policy.currency)}.`
        : "Within the automatic purchase limit.",
    );
  }

  add(
    "approval.every_payment",
    "Approval for every payment",
    policy.requireApprovalForEveryPayment ? "REQUIRE_APPROVAL" : "PASS",
    policy.requireApprovalForEveryPayment ? "Policy requires approver sign-off on every payment." : "Not required by policy.",
  );

  add(
    "approval.auto_order_creation",
    "Automatic order creation",
    policy.autoOrderCreation ? "PASS" : "REQUIRE_APPROVAL",
    policy.autoOrderCreation ? "Enabled." : "Disabled by policy: every order needs approver sign-off.",
  );

  const category = snapshot.category.toLowerCase();
  const blockedCat = policy.blockedCategories.map((c) => c.toLowerCase()).includes(category);
  const notAllowedCat =
    policy.allowedCategories.length > 0 && !policy.allowedCategories.map((c) => c.toLowerCase()).includes(category);
  add(
    "category",
    "Category permitted",
    blockedCat || notAllowedCat ? "BLOCK" : "PASS",
    blockedCat
      ? `Category "${snapshot.category}" is blocked by policy.`
      : notAllowedCat
        ? `Category "${snapshot.category}" is not on the allow list.`
        : `Category "${snapshot.category}" is permitted.`,
  );

  const seller = snapshot.sellerVerification;
  add(
    "seller.verification",
    "Seller verification",
    seller === "VERIFIED" ? "PASS" : policy.blockUnverifiedSellers ? "BLOCK" : "REQUIRE_APPROVAL",
    seller === "VERIFIED" ? "Seller is verified." : `Seller verification is ${seller.toLowerCase()}.`,
  );

  if (riskKnown) {
    const risk = snapshot.riskScore as number;
    const coverage = snapshot.evidenceCoverage as number;
    const maxRisk = 100 - policy.minTrustScore;
    add(
      "risk.max",
      "Minimum trust score",
      risk > maxRisk ? "BLOCK" : "PASS",
      risk > maxRisk
        ? `Risk ${risk} exceeds the maximum ${maxRisk} (trust ${100 - risk} < minimum ${policy.minTrustScore}).`
        : `Trust ${100 - risk} ≥ minimum ${policy.minTrustScore}.`,
    );
    add(
      "risk.approval",
      "Risk approval threshold",
      risk > policy.approvalRiskScore ? "REQUIRE_APPROVAL" : "PASS",
      risk > policy.approvalRiskScore
        ? `Risk ${risk} is above the approval threshold ${policy.approvalRiskScore}.`
        : `Risk ${risk} is within the approval threshold.`,
    );
    // Fail closed on thin evidence: never ALLOW with coverage below the floor.
    add(
      "evidence.coverage",
      "Evidence coverage",
      coverage < policy.minEvidenceCoverage ? (policy.requireSufficientInfo ? "BLOCK" : "REQUIRE_APPROVAL") : "PASS",
      coverage < policy.minEvidenceCoverage
        ? `Only ${coverage}% of mandatory signals present (minimum ${policy.minEvidenceCoverage}%).`
        : `${coverage}% of mandatory signals present.`,
    );
  }

  add(
    "requirements.match",
    "Matches mission requirements",
    snapshot.requirementMismatch === false ? "PASS" : "REQUIRE_APPROVAL",
    snapshot.requirementMismatch === false
      ? "All required attributes match."
      : snapshot.requirementMismatch === null
        ? "Requirement match could not be established."
        : "One or more required attributes do not match.",
  );

  add(
    "duplicate",
    "Duplicate purchase check",
    context.duplicateDetected ? policy.duplicateAction : "PASS",
    context.duplicateDetected
      ? `An identical purchase was authorised within the last ${policy.duplicateWindowHours}h.`
      : "No identical purchase in the window.",
  );

  // ---------------------------------------------------------------- aggregate
  let worst: CheckResult = "PASS";
  for (const c of checks) if (RANK[c.result] > RANK[worst]) worst = c.result;
  const decision: DecisionValue = worst === "PASS" ? "ALLOW_CHECKOUT" : worst;
  const reasons = checks.filter((c) => c.result !== "PASS").map((c) => c.detail);
  if (decision === "ALLOW_CHECKOUT") reasons.push("All checks passed. A human must still authorise before any order is created.");
  return { decision, reasons, checks };
}

/** Duplicate-purchase fingerprint. */
export function purchaseFingerprint(input: {
  ownerId: string;
  providerProductId: string;
  quantity: number;
  totalMinor: number;
  currency: string;
}): string {
  return hashCanonical(input);
}

/**
 * Decision on re-evaluation at capture time (Section 8):
 * - current BLOCK → deny, approval INVALIDATED
 * - current REQUIRE_APPROVAL but the approval was only an owner AUTHORIZATION → INVALIDATED, re-approve
 * - otherwise the existing approval stands. A looser current policy never upgrades a decision.
 */
export function reevaluateApproval(
  current: DecisionValue,
  approvalKind: "AUTHORIZATION" | "APPROVER_APPROVAL",
): { ok: true } | { ok: false; outcome: "BLOCKED" | "REAPPROVAL_REQUIRED"; reason: string } {
  if (current === "BLOCK") return { ok: false, outcome: "BLOCKED", reason: "Current policy now blocks this purchase." };
  if (current === "REQUIRE_APPROVAL" && approvalKind !== "APPROVER_APPROVAL") {
    return {
      ok: false,
      outcome: "REAPPROVAL_REQUIRED",
      reason: "Current policy requires approver sign-off that the existing authorization does not satisfy.",
    };
  }
  return { ok: true };
}
