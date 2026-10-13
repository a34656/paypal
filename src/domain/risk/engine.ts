/**
 * Deterministic risk model.
 *
 * riskScore: 0 = lowest risk, 100 = highest. trustScore = 100 − riskScore is derived
 * in presentation only and never stored.
 *
 * Fail-closed rule: a missing mandatory signal is scored at that factor's MAXIMUM
 * contribution ("assume the worst"). Therefore a product with sparse data can never
 * score as safer than a well-documented one. Missing signals also lower evidenceCoverage,
 * which the policy engine treats as its own gate.
 *
 * Only structured fields are read. Free text (title, description, seller text) is never
 * interpreted, so instructions embedded in product text cannot influence the score.
 */
import type { MissionConstraints, ProductCandidate } from "@/domain/types";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskFactor {
  id: string;
  label: string;
  /** Points added to riskScore. */
  contribution: number;
  max: number;
  status: "OK" | "CONCERN" | "MISSING";
  evidence: string;
}

export interface RiskAssessment {
  riskScore: number;
  level: RiskLevel;
  evidenceCoverage: number;
  factors: RiskFactor[];
  reasons: string[];
  missingInformation: string[];
  /** true = explicit mismatch, false = all required attributes match, null = could not establish. */
  requirementMismatch: boolean | null;
  recommendedAction: string;
  /** Always shown with demo data. */
  basis: string;
}

/** Factor maxima. They sum to 100 so the worst case is exactly 100. */
export const RISK_WEIGHTS = {
  price: 15,
  sellerIdentity: 10,
  sellerVerification: 15,
  shippingCost: 10,
  tax: 5,
  delivery: 12,
  attributes: 18,
  stock: 8,
  consistency: 7,
} as const;

export function riskLevel(score: number): RiskLevel {
  if (score < 25) return "LOW";
  if (score < 50) return "MEDIUM";
  if (score < 75) return "HIGH";
  return "CRITICAL";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function assessRisk(product: ProductCandidate, mission: MissionConstraints): RiskAssessment {
  const factors: RiskFactor[] = [];
  const missing: string[] = [];
  let signalsTotal = 0;
  let signalsPresent = 0;
  const signal = (present: boolean, name: string) => {
    signalsTotal += 1;
    if (present) signalsPresent += 1;
    else missing.push(name);
  };

  // 1. Price deviation from the seeded baseline.
  {
    const max = RISK_WEIGHTS.price;
    const base = product.baselineUnitPriceMinor;
    signal(base != null && base > 0, "price baseline");
    if (base == null || base <= 0) {
      factors.push({ id: "price", label: "Price deviation", contribution: max, max, status: "MISSING", evidence: "No reference price available; deviation cannot be assessed." });
    } else {
      // Integer basis points to keep this exact.
      const bps = Math.round(((product.unitPriceMinor - base) * 10_000) / base);
      let c = 0;
      if (bps > 5_000) c = max;
      else if (bps > 2_500) c = 8;
      else if (bps < -4_000) c = 12; // suspiciously cheap
      else if (bps < -2_000) c = 6;
      const pct = (bps / 100).toFixed(1);
      factors.push({
        id: "price",
        label: "Price deviation",
        contribution: c,
        max,
        status: c > 0 ? "CONCERN" : "OK",
        evidence: `Unit price is ${bps >= 0 ? "+" : ""}${pct}% vs the seeded reference price.`,
      });
    }
  }

  // 2. Seller identity.
  {
    const max = RISK_WEIGHTS.sellerIdentity;
    const has = !!product.sellerName && product.sellerName.trim().length > 0 && !!product.sellerId;
    signal(has, "seller identity");
    factors.push({ id: "seller_identity", label: "Seller identity", contribution: has ? 0 : max, max, status: has ? "OK" : "MISSING", evidence: has ? "Seller name and identifier disclosed." : "Seller name or identifier missing." });
  }

  // 3. Seller verification.
  {
    const max = RISK_WEIGHTS.sellerVerification;
    const v = product.sellerVerificationStatus;
    signal(v !== "UNKNOWN", "seller verification status");
    const c = v === "VERIFIED" ? 0 : v === "UNVERIFIED" ? 12 : max;
    factors.push({ id: "seller_verification", label: "Seller verification", contribution: c, max, status: v === "VERIFIED" ? "OK" : v === "UNKNOWN" ? "MISSING" : "CONCERN", evidence: `Provider reports seller as ${v.toLowerCase()}.` });
  }

  // 4. Shipping cost.
  {
    const max = RISK_WEIGHTS.shippingCost;
    const has = product.shippingMinor != null;
    signal(has, "shipping cost");
    factors.push({ id: "shipping_cost", label: "Shipping cost", contribution: has ? 0 : max, max, status: has ? "OK" : "MISSING", evidence: has ? "Shipping cost disclosed." : "Shipping cost not disclosed; the all-in total is unknown." });
  }

  // 5. Tax.
  {
    const max = RISK_WEIGHTS.tax;
    const has = product.taxMinor != null;
    signal(has, "tax");
    factors.push({ id: "tax", label: "Tax", contribution: has ? 0 : max, max, status: has ? "OK" : "MISSING", evidence: has ? "Tax disclosed." : "Tax not disclosed." });
  }

  // 6. Delivery estimate vs deadline.
  {
    const max = RISK_WEIGHTS.delivery;
    const est = product.shippingEstimateDays;
    signal(est != null, "delivery estimate");
    if (est == null) {
      factors.push({ id: "delivery", label: "Delivery evidence", contribution: max, max, status: "MISSING", evidence: "No delivery estimate." });
    } else if (mission.deadlineDays != null && est > mission.deadlineDays) {
      factors.push({ id: "delivery", label: "Delivery evidence", contribution: max, max, status: "CONCERN", evidence: `Estimated ${est} days exceeds the ${mission.deadlineDays}-day deadline.` });
    } else {
      factors.push({ id: "delivery", label: "Delivery evidence", contribution: 0, max, status: "OK", evidence: `Estimated delivery in ${est} days${mission.deadlineDays != null ? ` (deadline ${mission.deadlineDays})` : ""}.` });
    }
  }

  // 7. Required attributes.
  let requirementMismatch: boolean | null = false;
  {
    const max = RISK_WEIGHTS.attributes;
    const required = Object.entries(mission.requiredAttributes);
    if (required.length === 0) {
      factors.push({ id: "attributes", label: "Requirement match", contribution: 0, max, status: "OK", evidence: "Mission states no required attributes." });
    } else {
      const productAttrs = new Map(Object.entries(product.attributes).map(([k, v]) => [norm(k), norm(v)]));
      const mismatched: string[] = [];
      const absent: string[] = [];
      for (const [k, v] of required) {
        const pv = productAttrs.get(norm(k));
        signal(pv !== undefined, `attribute "${k}"`);
        if (pv === undefined) absent.push(k);
        else if (pv !== norm(v)) mismatched.push(`${k} is "${product.attributes[Object.keys(product.attributes).find((x) => norm(x) === norm(k)) ?? k]}" (required "${v}")`);
      }
      const bad = mismatched.length + absent.length;
      // Each attribute owns an equal share; missing and mismatched both take the full share.
      const c = bad === 0 ? 0 : Math.min(max, Math.ceil((max * bad) / required.length));
      requirementMismatch = mismatched.length > 0 ? true : absent.length > 0 ? null : false;
      const parts = [
        mismatched.length ? `Mismatch: ${mismatched.join("; ")}.` : "",
        absent.length ? `Not disclosed: ${absent.join(", ")}.` : "",
      ].filter(Boolean);
      factors.push({
        id: "attributes",
        label: "Requirement match",
        contribution: c,
        max,
        status: mismatched.length ? "CONCERN" : absent.length ? "MISSING" : "OK",
        evidence: parts.length ? parts.join(" ") : "All required attributes match.",
      });
    }
  }

  // 8. Stock.
  {
    const max = RISK_WEIGHTS.stock;
    const s = product.stockQuantity;
    signal(s != null, "stock level");
    const c = s == null ? max : s < mission.quantity ? max : 0;
    factors.push({ id: "stock", label: "Stock availability", contribution: c, max, status: s == null ? "MISSING" : c > 0 ? "CONCERN" : "OK", evidence: s == null ? "Stock level not disclosed." : s < mission.quantity ? `Only ${s} in stock for ${mission.quantity} requested.` : `${s} in stock for ${mission.quantity} requested.` });
  }

  // 9. Data consistency.
  {
    const max = RISK_WEIGHTS.consistency;
    const issues: string[] = [];
    let c = 0;
    if (product.currency !== mission.currency) {
      c = max;
      issues.push(`currency ${product.currency} differs from mission currency ${mission.currency}`);
    }
    if (norm(product.category) !== norm(mission.category)) {
      c = Math.max(c, 4);
      issues.push(`category "${product.category}" differs from mission category "${mission.category}"`);
    }
    factors.push({ id: "consistency", label: "Data consistency", contribution: c, max, status: c ? "CONCERN" : "OK", evidence: issues.length ? `Inconsistent: ${issues.join("; ")}.` : "Currency and category are consistent with the mission." });
  }

  const raw = factors.reduce((s, f) => s + f.contribution, 0);
  const riskScore = Math.max(0, Math.min(100, raw));
  const evidenceCoverage = signalsTotal === 0 ? 0 : Math.floor((signalsPresent * 100) / signalsTotal);
  const level = riskLevel(riskScore);
  const reasons = factors.filter((f) => f.contribution > 0).map((f) => `${f.label}: ${f.evidence}`);

  let recommendedAction: string;
  if (level === "CRITICAL") recommendedAction = "Do not purchase.";
  else if (level === "HIGH" || evidenceCoverage < 50) recommendedAction = "Avoid unless an approver reviews the missing evidence.";
  else if (level === "MEDIUM") recommendedAction = "Purchase only with approver review.";
  else recommendedAction = "Acceptable risk; policy still decides.";

  return {
    riskScore,
    level,
    evidenceCoverage,
    factors,
    reasons,
    missingInformation: missing,
    requirementMismatch,
    recommendedAction,
    basis: product.isDemoData
      ? "Estimate from demo evidence. Reference prices are seeded demo values, not market data."
      : "Estimate from provider-supplied evidence.",
  };
}
