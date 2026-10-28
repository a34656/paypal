import { describe, expect, it } from "vitest";
import { optimize } from "@/domain/agents/optimizer";
import { evaluate } from "@/domain/policy/engine";
import { DEFAULT_POLICY, type PolicyConfig } from "@/domain/policy/schema";
import { snapshotFor } from "@/domain/policy/snapshot";
import { maxFeasibleQuantity, safePurchaseAmounts } from "@/domain/pricing";
import { assessRisk } from "@/domain/risk/engine";
import { analyzeRecovery, projectRevision, type RecoveryInput, type RecoveryOffer } from "@/domain/recovery/analysis";
import { deterministicAdvice, validateAdvice } from "@/domain/recovery/advice";
import { checkMeta } from "@/domain/recovery/constraints";
import { DEMO_PRODUCTS } from "@/domain/providers/demo-catalog";
import type { MissionConstraints, ProductCandidate } from "@/domain/types";

const NOW = new Date("2026-10-16T12:00:00Z");

const baseMission: MissionConstraints = {
  title: "USB-C Cables for Hardware Bench",
  objective: "Buy cables for the bench",
  productQuery: "USB-C cable",
  category: "cables",
  quantity: 50,
  budgetMinor: 40_000,
  currency: "USD",
  deadlineDays: 10,
  requiredAttributes: { length: "1m", power: "60W" },
  maxRiskScore: null,
};

function demo(id: string): ProductCandidate {
  const p = DEMO_PRODUCTS.find((x) => x.providerProductId === id)!;
  const { keywords: _k, ...rest } = p;
  void _k;
  return { ...rest, provider: "demo", isDemoData: true };
}

function cand(over: Partial<ProductCandidate>): ProductCandidate {
  return { ...demo("demo-usbc-001"), providerProductId: `x-${Math.random()}`, ...over };
}

/** Runs the real pipeline (pricing → risk → optimizer → policy) to produce a STORED-like offer. */
function evaluated(cands: ProductCandidate[], c: MissionConstraints, policy: PolicyConfig = DEFAULT_POLICY, quotedAt = NOW.toISOString()): RecoveryOffer[] {
  const rows = cands.map((cd, i) => {
    const amounts = safePurchaseAmounts(cd, c.quantity, policy.costAllowancePct);
    const risk = assessRisk(cd, c, { costBounded: amounts?.basis === "CAP" });
    return { id: `mp${i}`, cd, amounts, risk };
  });
  const opt = optimize(
    rows.map((r) => ({ key: r.id, title: r.cd.title, totalMinor: r.amounts?.totalMinor ?? null, currency: r.cd.currency, category: r.cd.category, sellerVerified: r.cd.sellerVerificationStatus === "VERIFIED", risk: r.risk, amountBasis: r.amounts?.basis ?? "EXACT" })),
    c,
    policy,
  );
  return rows.map((r, i) => {
    const mp = { totalMinor: r.amounts?.totalMinor ?? null, riskScore: r.risk.riskScore, evidenceCoverage: r.risk.evidenceCoverage, riskEvidence: r.risk, amountBasis: r.amounts?.basis ?? null, allowanceMinor: r.amounts ? r.amounts.allowanceMinor : null };
    return {
      id: r.id,
      productId: `p${i}`,
      candidate: r.cd,
      totalMinor: mp.totalMinor,
      amountBasis: mp.amountBasis,
      allowanceMinor: mp.allowanceMinor,
      riskScore: mp.riskScore,
      evidenceCoverage: mp.evidenceCoverage,
      risk: r.risk,
      eligible: opt[i].eligible,
      ineligibleReasons: opt[i].ineligibleReasons,
      evaluation: evaluate(snapshotFor(c, r.cd, mp), policy, { duplicateDetected: false }),
      quotedAt,
    };
  });
}

function input(offers: RecoveryOffer[], c: MissionConstraints, policy: PolicyConfig = DEFAULT_POLICY, extra: Partial<RecoveryInput> = {}): RecoveryInput {
  return { constraints: c, evaluatedPolicy: policy, evaluatedPolicyVersion: 1, currentPolicy: policy, currentPolicyVersion: 1, missionVersion: 7, decision: "BLOCK", offers, now: NOW, ...extra };
}

describe("pricing: maximum feasible quantity", () => {
  it("includes disclosed shipping and tax as fixed per-order costs", () => {
    // 6.50/unit + 12.00 shipping + 27.00 tax; budget 100.00 → 9 units = 97.50
    const fit = maxFeasibleQuantity(demo("demo-usbc-001"), 10_000, 15, 49)!;
    expect(fit.quantity).toBe(9);
    expect(fit.amounts).toMatchObject({ basis: "EXACT", itemTotalMinor: 5_850, shippingMinor: 1_200, taxMinor: 2_700, totalMinor: 9_750 });
    // 10 units would be 104.00
    expect(safePurchaseAmounts(demo("demo-usbc-001"), 10, 15)!.totalMinor).toBe(10_400);
  });

  it("uses the policy spending cap (item + allowance, rounded up) when shipping/tax are undisclosed", () => {
    const p = { unitPriceMinor: 999, shippingMinor: null, taxMinor: null };
    const fit = maxFeasibleQuantity(p, 40_000, 15, 49)!;
    expect(fit.quantity).toBe(34); // 34 × 9.99 = 339.66 + 50.95 = 390.61; 35 → 402.10
    expect(fit.amounts).toMatchObject({ basis: "CAP", itemTotalMinor: 33_966, allowanceMinor: 5_095, totalMinor: 39_061 });
    expect(safePurchaseAmounts(p, 35, 15)!.totalMinor).toBe(40_210);
  });

  it("returns null when not even one unit fits, or the amount cannot be stated", () => {
    expect(maxFeasibleQuantity({ unitPriceMinor: 50_000, shippingMinor: 0, taxMinor: 0 }, 40_000, 15, 10)).toBeNull();
    expect(maxFeasibleQuantity({ unitPriceMinor: 100, shippingMinor: null, taxMinor: null }, 40_000, 0, 10)).toBeNull();
    expect(maxFeasibleQuantity({ unitPriceMinor: 100, shippingMinor: 0, taxMinor: 0 }, 40_000, 15, 0)).toBeNull();
  });
});

describe("recovery analysis: budget shortfall", () => {
  it("computes the example shortfall exactly: $574.43 − $400.00 = $174.43", () => {
    const offers = evaluated([cand({ title: "USB-C to USB-C Cable", unitPriceMinor: 999, shippingMinor: null, taxMinor: null, sellerVerificationStatus: "UNKNOWN", sellerId: "baseus.com", sellerName: "BASEUS", isDemoData: false, attributes: {} })], baseMission);
    expect(offers[0].totalMinor).toBe(57_443);
    const a = analyzeRecovery(input(offers, baseMission));
    expect(a.summary.lowestTotalMinor).toBe(57_443);
    expect(a.summary.shortfallMinor).toBe(17_443);
    expect(a.summary.arithmetic).toBe("$574.43 − $400.00 = $174.43");
    expect(a.budget.shortfallBps).toBe(4_361); // 43.61%
    expect(a.budget.lowestBasis).toBe("CAP");
    expect(a.summary.allCapped).toBe(true);
  });

  it("finds the minimum budget that unlocks an offer, with an explicit safety margin, from the actual total", () => {
    const c = { ...baseMission, budgetMinor: 10_000 };
    const a = analyzeRecovery(input(evaluated([demo("demo-usbc-001")], c), c, DEFAULT_POLICY, { marginPct: 5 }));
    expect(a.budget.unlock).toMatchObject({ minBudgetMinor: 36_400, increaseMinor: 26_400, increaseBps: 26_400, marginPct: 5, marginMinor: 1_820, suggestedBudgetMinor: 38_220, basis: "EXACT", projectedDecision: "ALLOW_CHECKOUT" });
    const rec = a.recommendations.find((r) => r.id === "INCREASE_BUDGET")!;
    expect(rec.resolves).toBe(true);
    expect(rec.proposedChanges).toEqual({ budgetMinor: 38_220 });
    expect(rec.stillMustPass.join(" ")).toMatch(/Human approval/);
  });

  it("does not add a margin on top of a spending cap (the cap already bounds undisclosed costs)", () => {
    const c = { ...baseMission, budgetMinor: 30_000, requiredAttributes: {} };
    const verifiedCap = cand({ unitPriceMinor: 650, shippingMinor: null, taxMinor: null });
    const a = analyzeRecovery(input(evaluated([verifiedCap], c), c, DEFAULT_POLICY, { marginPct: 10 }));
    expect(a.budget.unlock).toMatchObject({ basis: "CAP", minBudgetMinor: 37_375, marginMinor: 0, suggestedBudgetMinor: 37_375, projectedDecision: "REQUIRE_APPROVAL" });
  });
});

describe("recovery analysis: quantity", () => {
  it("computes the largest feasible quantity and labels EXACT-basis quantities as estimates", () => {
    const c = { ...baseMission, budgetMinor: 10_000 };
    const a = analyzeRecovery(input(evaluated([demo("demo-usbc-001")], c), c));
    expect(a.quantity.candidates[0]).toMatchObject({ quantity: 9, unitsFewer: 41, totalMinor: 9_750, estimate: true, projectedDecision: "ALLOW_CHECKOUT" });
    expect(a.quantity.pricingNote).toMatch(/no quantity-tier/i);
    expect(a.recommendations.find((r) => r.id === "REDUCE_QUANTITY")!.tradeoffs.join(" ")).toMatch(/Partial fulfilment/);
  });

  it("reports a best-effort quantity and what would still fail when no offer becomes viable", () => {
    const offers = evaluated([cand({ unitPriceMinor: 999, shippingMinor: null, taxMinor: null, sellerVerificationStatus: "UNKNOWN", sellerName: null, sellerId: null, attributes: {}, stockQuantity: null })], baseMission);
    const a = analyzeRecovery(input(offers, baseMission));
    expect(a.quantity.candidates).toHaveLength(0);
    expect(a.quantity.bestEffort).toMatchObject({ quantity: 34, totalMinor: 39_061, basis: "CAP" });
    expect(a.quantity.bestEffort!.remainingBlockers.length).toBeGreaterThan(0);
  });

  it("never suggests a smaller quantity for a single-unit mission", () => {
    const c = { ...baseMission, quantity: 1, budgetMinor: 100 };
    const a = analyzeRecovery(input(evaluated([demo("demo-usbc-001")], c), c));
    expect(a.quantity.candidates).toHaveLength(0);
    expect(a.quantity.reason).toMatch(/single unit/);
  });
});

describe("recovery analysis: non-financial and incomplete data", () => {
  it("explains that a budget increase alone does not help when a non-financial check also fails", () => {
    const policy = { ...DEFAULT_POLICY, blockUnverifiedSellers: true };
    const c = { ...baseMission, budgetMinor: 10_000 };
    const unverified = { ...demo("demo-usbc-001"), sellerVerificationStatus: "UNVERIFIED" as const };
    const a = analyzeRecovery(input(evaluated([unverified], c, policy), c, policy));
    expect(a.budget.unlock).toBeNull();
    expect(a.budget.budgetAloneInsufficient).toBe(true);
    expect(a.budget.lowestFit!.remainingBlockers).toContain("Seller verification");
    const seller = a.offers[0].blocking.find((b) => b.checkId === "seller.verification")!;
    expect(seller).toMatchObject({ adjustability: "POLICY", overridable: true, financial: false });
    expect(seller.budgetWontHelp).toMatch(/evidence/);
    expect(a.whyBlocked.join(" ")).toMatch(/Raising the budget alone would not unlock/);
    const rec = a.recommendations.find((r) => r.id === "INCREASE_BUDGET")!;
    expect(rec.resolves).toBe(false);
  });

  it("labels unknown totals as unknown (never zero) when the policy disallows spending caps", () => {
    const policy = { ...DEFAULT_POLICY, costAllowancePct: 0 };
    const a = analyzeRecovery(input(evaluated([demo("demo-usbc-002")], baseMission, policy), baseMission, policy));
    expect(a.summary.lowestTotalMinor).toBeNull();
    expect(a.offers[0].totalBasis).toBe("UNKNOWN");
    const t = a.offers[0].blocking.find((b) => b.checkId === "floor.total_known")!;
    expect(t).toMatchObject({ adjustability: "EVIDENCE", overridable: false });
    expect(t.actual).toMatch(/shipping unknown/);
    expect(a.recommendations.some((r) => r.id === "REFRESH_QUOTE")).toBe(true);
    expect(a.override.notOverridable.map((x) => x.checkId)).toContain("floor.total_known");
  });

  it("flags stale quotes", () => {
    const old = new Date(NOW.getTime() - 48 * 3_600_000).toISOString();
    const c = { ...baseMission, budgetMinor: 10_000 };
    const a = analyzeRecovery(input(evaluated([demo("demo-usbc-001")], c, DEFAULT_POLICY, old), c));
    expect(a.staleness.stale).toBe(true);
    expect(a.staleness.oldestQuoteHours).toBe(48);
    expect(a.offers[0].stale).toBe(true);
  });

  it("never invents a failed check: every BLOCK comes from the stored evaluation or the optimizer gate", () => {
    const offers = evaluated([demo("demo-usbc-001"), demo("demo-usbc-002"), demo("demo-rpi-001")], { ...baseMission, budgetMinor: 5_000 });
    const a = analyzeRecovery(input(offers, { ...baseMission, budgetMinor: 5_000 }));
    for (const d of a.offers) {
      const stored = offers.find((o) => o.id === d.offerId)!;
      const ids = new Set(stored.evaluation!.checks.filter((c) => c.result === "BLOCK").map((c) => c.id));
      for (const b of d.blocking) expect(ids.has(b.checkId) || (b.checkId === "eligibility.requirements" && stored.risk?.requirementMismatch === true)).toBe(true);
    }
  });

  it("only recommends relaxing a delivery deadline when the estimate actually misses it", () => {
    const slow = { ...demo("demo-usbc-001"), shippingEstimateDays: 14 };
    const c = { ...baseMission, budgetMinor: 40_000, deadlineDays: 10 };
    const tight = { ...DEFAULT_POLICY, approvalRiskScore: 5, minTrustScore: 90 };
    const a = analyzeRecovery(input(evaluated([slow], c, tight), c, tight));
    expect(a.delivery.relevant).toBe(true);
    expect(a.delivery.items[0]).toMatchObject({ estimateDays: 14, deadlineDays: 10, riskReduction: 12, unlocks: true });
    const fast = analyzeRecovery(input(evaluated([demo("demo-usbc-001")], { ...c, budgetMinor: 100 }), { ...c, budgetMinor: 100 }));
    expect(fast.delivery.items).toHaveLength(0);
    expect(fast.recommendations.some((r) => r.id === "ADJUST_DELIVERY")).toBe(false);
  });

  it("marks floor checks as non-overridable and mission constraints as revise-instead", () => {
    expect(checkMeta("floor.untrusted_content").overridable).toBe(false);
    expect(checkMeta("floor.total_known").overridable).toBe(false);
    expect(checkMeta("mission.risk_tolerance")).toMatchObject({ overridable: false, adjustability: "MISSION" });
    expect(checkMeta("eligibility.requirements").overridable).toBe(false);
    expect(checkMeta("budget.mission")).toMatchObject({ overridable: true, policyField: "blockOverBudget" });
  });

  it("projects a revision with the real engines and finds the cheapest passing offer", () => {
    const c = { ...baseMission, budgetMinor: 10_000 };
    const offers = evaluated([demo("demo-usbc-001"), demo("demo-usbc-002")], c);
    const p = projectRevision(offers, { ...c, budgetMinor: 40_000 }, DEFAULT_POLICY);
    expect(p.best).toMatchObject({ totalMinor: 36_400, basis: "EXACT" });
    expect(p.projectedDecision).toBe("ALLOW_CHECKOUT");
  });
});

describe("advisor output validation", () => {
  const c = { ...baseMission, budgetMinor: 10_000 };
  const analysis = analyzeRecovery(input(evaluated([demo("demo-usbc-001"), demo("demo-usbc-002")], c), c));

  it("accepts the deterministic advice", () => {
    const v = validateAdvice(deterministicAdvice(analysis), analysis);
    expect(v.ok).toBe(true);
    expect(v.advice!.nextAction.optionId).toBe(analysis.nextAction.optionId);
  });

  it("rejects malformed output", () => {
    expect(validateAdvice({ diagnosis: "x" }, analysis).ok).toBe(false);
    expect(validateAdvice("not json", analysis).ok).toBe(false);
  });

  it("rejects fabricated amounts and forbidden claims", () => {
    const base = deterministicAdvice(analysis);
    expect(validateAdvice({ ...base, diagnosis: "Buy it for $12.34 from a new seller." }, analysis)).toMatchObject({ ok: false });
    expect(validateAdvice({ ...base, diagnosis: "This offer is safe and will be approved." }, analysis)).toMatchObject({ ok: false });
    // Amounts that the analysis does state are fine, with or without thousands separators.
    expect(validateAdvice({ ...base, diagnosis: "The cheapest total is $364.00 against a $100.00 budget." }, analysis).ok).toBe(true);
  });

  it("drops unknown check ids and unavailable options, and forces deterministic override eligibility", () => {
    const base = deterministicAdvice(analysis);
    const v = validateAdvice(
      {
        ...base,
        failedConstraints: [...base.failedConstraints, { checkId: "made.up", explanation: "invented" }],
        recommendations: [...base.recommendations, { optionId: "REQUEST_OVERRIDE", title: "Override", rationale: "x" }].filter((r) => analysis.recommendations.some((x) => x.id === r.optionId) || r.optionId === "REQUEST_OVERRIDE"),
        overrideEligibility: { eligible: !analysis.override.eligible, explanation: "wrong" },
        nextAction: { optionId: "ADJUST_DELIVERY", label: "invented" },
      },
      analysis,
    );
    expect(v.ok).toBe(true);
    expect(v.advice!.failedConstraints.some((f) => f.checkId === "made.up")).toBe(false);
    expect(v.advice!.overrideEligibility.eligible).toBe(analysis.override.eligible);
    expect(v.advice!.overrideEligibility.explanation).toBe(analysis.override.explanation);
    if (!analysis.recommendations.some((r) => r.id === "ADJUST_DELIVERY")) expect(v.advice!.nextAction.optionId).toBe(analysis.nextAction.optionId);
  });
});
