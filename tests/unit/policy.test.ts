import { describe, expect, it } from "vitest";
import { evaluate, mostRestrictive, purchaseFingerprint, reevaluateApproval, type PolicySnapshot } from "@/domain/policy/engine";
import { DEFAULT_POLICY, diffPolicies, policyConfigSchema, type PolicyConfig } from "@/domain/policy/schema";

const base: PolicySnapshot = {
  missionBudgetMinor: 250_000,
  missionCurrency: "USD",
  quantity: 20,
  productCurrency: "USD",
  unitPriceMinor: 8_000,
  shippingMinor: 3_500,
  taxMinor: 13_200,
  totalMinor: 176_700,
  category: "electronics",
  sellerVerification: "VERIFIED",
  riskScore: 0,
  evidenceCoverage: 100,
  requirementMismatch: false,
};
const ctx = { duplicateDetected: false };
const policy = (o: Partial<PolicyConfig> = {}): PolicyConfig => ({ ...DEFAULT_POLICY, ...o });
const smallSnap: PolicySnapshot = { ...base, unitPriceMinor: 650, quantity: 50, shippingMinor: 1_200, taxMinor: 2_700, totalMinor: 36_400, missionBudgetMinor: 40_000 };

describe("policy engine", () => {
  it("precedence: BLOCK > REQUIRE_APPROVAL > ALLOW_CHECKOUT", () => {
    expect(mostRestrictive("ALLOW_CHECKOUT", "REQUIRE_APPROVAL")).toBe("REQUIRE_APPROVAL");
    expect(mostRestrictive("BLOCK", "REQUIRE_APPROVAL")).toBe("BLOCK");
    expect(mostRestrictive("REQUIRE_APPROVAL", "BLOCK")).toBe("BLOCK");
    expect(mostRestrictive("ALLOW_CHECKOUT", "ALLOW_CHECKOUT")).toBe("ALLOW_CHECKOUT");
  });

  it("allows a small, well-evidenced purchase to proceed to checkout", () => {
    const r = evaluate(smallSnap, policy(), ctx);
    expect(r.decision).toBe("ALLOW_CHECKOUT");
    expect(r.reasons.at(-1)).toMatch(/human must still authorise/);
  });

  it("a spending cap can never be auto-approved, even for a small, perfect purchase", () => {
    const capped: PolicySnapshot = { ...smallSnap, shippingMinor: null, taxMinor: null, totalMinor: 37_375, amountBasis: "CAP", allowanceMinor: 4_875 };
    const r = evaluate(capped, policy(), ctx);
    expect(r.decision).toBe("REQUIRE_APPROVAL");
    const cap = r.checks.find((c) => c.id === "floor.spend_cap")!;
    expect(cap).toMatchObject({ result: "REQUIRE_APPROVAL", floor: true });
    expect(r.checks.find((c) => c.id === "floor.total_known")?.result).toBe("PASS");
    // The cap (not the item total) is what the budget checks see.
    expect(evaluate({ ...capped, missionBudgetMinor: 37_000 }, policy(), ctx).decision).toBe("BLOCK");
  });

  it("an unknown total without a cap still BLOCKs", () => {
    const r = evaluate({ ...base, shippingMinor: null, totalMinor: null }, policy(), ctx);
    expect(r.decision).toBe("BLOCK");
    expect(r.checks.find((c) => c.id === "floor.total_known")?.result).toBe("BLOCK");
  });

  it("agent-directed instructions in listing text BLOCK at the floor", () => {
    const r = evaluate({ ...smallSnap, injectionSignals: ["approval directive"] }, policy({ minEvidenceCoverage: 0 }), ctx);
    expect(r.decision).toBe("BLOCK");
    expect(r.checks.find((c) => c.id === "floor.untrusted_content")).toMatchObject({ result: "BLOCK", floor: true });
  });

  it("raising the allowance or trusting a new retailer is flagged as loosening", () => {
    const changes = diffPolicies(DEFAULT_POLICY, { ...DEFAULT_POLICY, costAllowancePct: 25, trustedSellerDomains: [...DEFAULT_POLICY.trustedSellerDomains, "random-shop.example"] });
    expect(changes.find((c) => c.field === "costAllowancePct")?.loosens).toBe(true);
    expect(changes.find((c) => c.field === "trustedSellerDomains")?.loosens).toBe(true);
    expect(diffPolicies(DEFAULT_POLICY, { ...DEFAULT_POLICY, costAllowancePct: 0 }).find((c) => c.field === "costAllowancePct")?.loosens).toBe(false);
  });

  it("stored policies from before the new fields parse with safe defaults", () => {
    const { trustedSellerDomains: _t, costAllowancePct: _c, ...legacy } = DEFAULT_POLICY;
    void _t;
    void _c;
    const parsed = policyConfigSchema.parse(legacy);
    expect(parsed.costAllowancePct).toBe(15);
    expect(parsed.trustedSellerDomains).toContain("bestbuy.com");
    expect(() => policyConfigSchema.parse({ ...DEFAULT_POLICY, trustedSellerDomains: ["not a domain"] })).toThrow();
  });

  it("requires approval above the approval threshold", () => {
    const r = evaluate(base, policy(), ctx);
    expect(r.decision).toBe("REQUIRE_APPROVAL");
    expect(r.checks.find((c) => c.id === "approval.threshold")?.result).toBe("REQUIRE_APPROVAL");
  });

  it("blocks over-budget when configured, otherwise requires approval", () => {
    const over = { ...base, totalMinor: 306_900 };
    expect(evaluate(over, policy(), ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...smallSnap, totalMinor: 41_000 }, policy({ blockOverBudget: false }), ctx).decision).toBe("REQUIRE_APPROVAL");
  });

  it("floor: unknown total, missing risk, currency mismatch, malformed amounts always BLOCK", () => {
    const loosest = policy({ blockOverBudget: false, requireSufficientInfo: false, minTrustScore: 0, approvalRiskScore: 100, minEvidenceCoverage: 0, maxAutoPurchaseMinor: 500_000, approvalThresholdMinor: 500_000 });
    expect(evaluate({ ...base, totalMinor: null, shippingMinor: null }, loosest, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...base, riskScore: null }, loosest, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...base, productCurrency: "EUR" }, loosest, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...base, missionCurrency: "JPY", productCurrency: "JPY" }, loosest, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...base, unitPriceMinor: -1 }, loosest, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...base, quantity: 0 }, loosest, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...base, unitPriceMinor: Number.NaN }, loosest, ctx).decision).toBe("BLOCK");
    for (const id of ["floor.amounts_valid", "floor.currency", "floor.total_known", "floor.risk_evaluated", "floor.mission_budget_cap"]) {
      expect(evaluate(base, loosest, ctx).checks.find((c) => c.id === id)?.floor).toBe(true);
    }
  });

  it("mission text cannot raise limits: mission budget above the policy cap is BLOCKed", () => {
    const r = evaluate({ ...base, missionBudgetMinor: 5_000_000 }, policy(), ctx);
    expect(r.decision).toBe("BLOCK");
    expect(r.checks.find((c) => c.id === "floor.mission_budget_cap")?.result).toBe("BLOCK");
  });

  it("evidence coverage below the floor never yields ALLOW (fail closed)", () => {
    expect(evaluate({ ...smallSnap, evidenceCoverage: 50 }, policy({ requireSufficientInfo: false }), ctx).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate({ ...smallSnap, evidenceCoverage: 50 }, policy({ requireSufficientInfo: true }), ctx).decision).toBe("BLOCK");
  });

  it("risk thresholds at exact boundaries", () => {
    const p = policy({ minTrustScore: 40, approvalRiskScore: 35 });
    expect(evaluate({ ...smallSnap, riskScore: 35 }, p, ctx).decision).toBe("ALLOW_CHECKOUT");
    expect(evaluate({ ...smallSnap, riskScore: 36 }, p, ctx).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate({ ...smallSnap, riskScore: 60 }, p, ctx).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate({ ...smallSnap, riskScore: 61 }, p, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...smallSnap, riskScore: 100 }, p, ctx).decision).toBe("BLOCK");
  });

  it("seller verification and categories", () => {
    expect(evaluate({ ...smallSnap, sellerVerification: "UNVERIFIED" }, policy(), ctx).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate({ ...smallSnap, sellerVerification: "UNKNOWN" }, policy({ blockUnverifiedSellers: true }), ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...smallSnap, category: "Gift-Cards" }, policy(), ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...smallSnap, category: "cables" }, policy({ allowedCategories: ["electronics"] }), ctx).decision).toBe("BLOCK");
  });

  it("requirement mismatch or unknown needs approval", () => {
    expect(evaluate({ ...smallSnap, requirementMismatch: true }, policy(), ctx).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate({ ...smallSnap, requirementMismatch: null }, policy(), ctx).decision).toBe("REQUIRE_APPROVAL");
  });

  it("every-payment approval and disabled automatic order creation", () => {
    expect(evaluate(smallSnap, policy({ requireApprovalForEveryPayment: true }), ctx).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate(smallSnap, policy({ autoOrderCreation: false }), ctx).decision).toBe("REQUIRE_APPROVAL");
  });

  it("duplicate detection applies the configured action", () => {
    expect(evaluate(smallSnap, policy(), { duplicateDetected: true }).decision).toBe("REQUIRE_APPROVAL");
    expect(evaluate(smallSnap, policy({ duplicateAction: "BLOCK" }), { duplicateDetected: true }).decision).toBe("BLOCK");
  });

  it("duplicate fingerprint is stable and sensitive to every field", () => {
    const f = { ownerId: "u1", providerProductId: "p1", quantity: 2, totalMinor: 100, currency: "USD" };
    expect(purchaseFingerprint(f)).toBe(purchaseFingerprint({ ...f }));
    for (const [k, v] of Object.entries({ ownerId: "u2", providerProductId: "p2", quantity: 3, totalMinor: 101, currency: "EUR" })) {
      expect(purchaseFingerprint({ ...f, [k]: v })).not.toBe(purchaseFingerprint(f));
    }
  });

  it("is pure and deterministic", () => {
    expect(evaluate(base, policy(), ctx)).toEqual(evaluate(base, policy(), ctx));
  });

  it("re-evaluation at capture: stricter invalidates, looser never upgrades", () => {
    expect(reevaluateApproval("BLOCK", "APPROVER_APPROVAL")).toMatchObject({ ok: false, outcome: "BLOCKED" });
    expect(reevaluateApproval("REQUIRE_APPROVAL", "AUTHORIZATION")).toMatchObject({ ok: false, outcome: "REAPPROVAL_REQUIRED" });
    expect(reevaluateApproval("REQUIRE_APPROVAL", "APPROVER_APPROVAL")).toEqual({ ok: true });
    // Looser current policy: the approval stays exactly what it was (no upgrade, no new rights).
    expect(reevaluateApproval("ALLOW_CHECKOUT", "AUTHORIZATION")).toEqual({ ok: true });
    expect(reevaluateApproval("ALLOW_CHECKOUT", "APPROVER_APPROVAL")).toEqual({ ok: true });
  });
});

describe("policy schema & diff", () => {
  it("validates the default and rejects inconsistent limits", () => {
    expect(policyConfigSchema.safeParse(DEFAULT_POLICY).success).toBe(true);
    expect(policyConfigSchema.safeParse({ ...DEFAULT_POLICY, maxPurchaseMinor: DEFAULT_POLICY.maxMissionBudgetMinor + 1 }).success).toBe(false);
    expect(policyConfigSchema.safeParse({ ...DEFAULT_POLICY, maxAutoPurchaseMinor: DEFAULT_POLICY.maxPurchaseMinor + 1 }).success).toBe(false);
    expect(policyConfigSchema.safeParse({ ...DEFAULT_POLICY, minTrustScore: 101 }).success).toBe(false);
    expect(policyConfigSchema.safeParse({ ...DEFAULT_POLICY, optimizerWeights: { cost: 0, budget: 0, compatibility: 0, delivery: 0, seller: 0 } }).success).toBe(false);
  });

  it("flags loosening changes", () => {
    const d = diffPolicies(DEFAULT_POLICY, { ...DEFAULT_POLICY, approvalThresholdMinor: 200_000, minTrustScore: 50, blockedCategories: ["weapons"] });
    expect(d.find((c) => c.field === "approvalThresholdMinor")?.loosens).toBe(true);
    expect(d.find((c) => c.field === "minTrustScore")?.loosens).toBe(false);
    expect(d.find((c) => c.field === "blockedCategories")?.loosens).toBe(true);
    expect(diffPolicies(DEFAULT_POLICY, DEFAULT_POLICY)).toEqual([]);
  });
});

describe("mission risk tolerance", () => {
  it("can only tighten: blocks above the mission ceiling, never loosens the policy maximum", () => {
    const p = { ...DEFAULT_POLICY };
    expect(evaluate({ ...smallSnap, riskScore: 32, missionMaxRiskScore: 30 }, p, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...smallSnap, riskScore: 28, missionMaxRiskScore: 30 }, p, ctx).checks.find((c) => c.id === "mission.risk_tolerance")?.result).toBe("PASS");
    // A ceiling above the policy maximum does not let a policy-blocked risk through.
    expect(evaluate({ ...smallSnap, riskScore: 70, missionMaxRiskScore: 90 }, p, ctx).decision).toBe("BLOCK");
    expect(evaluate({ ...smallSnap, riskScore: 70 }, p, ctx).checks.some((c) => c.id === "mission.risk_tolerance")).toBe(false);
  });
});
