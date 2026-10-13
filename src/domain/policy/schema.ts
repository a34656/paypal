import { z } from "zod";
import { currencySchema, minorSchema, positiveMinorSchema } from "@/domain/types";

const weight = z.number().int().min(0).max(100);

export const optimizerWeightsSchema = z.object({
  cost: weight,
  budget: weight,
  compatibility: weight,
  delivery: weight,
  seller: weight,
});
export type OptimizerWeights = z.infer<typeof optimizerWeightsSchema>;

/**
 * Configurable policy. Persisted as immutable versions. Nothing here can relax the
 * hard-coded floor in engine.ts (see FLOOR_CHECKS) or the invariants in docs/security.md.
 */
export const policyConfigSchema = z
  .object({
    /** Policy limits are denominated in this currency. No FX in the MVP: other currencies BLOCK. */
    currency: currencySchema,
    maxMissionBudgetMinor: positiveMinorSchema,
    maxPurchaseMinor: positiveMinorSchema,
    maxAutoPurchaseMinor: minorSchema,
    requireApprovalForEveryPayment: z.boolean(),
    approvalThresholdMinor: minorSchema,
    blockOverBudget: z.boolean(),
    requireSufficientInfo: z.boolean(),
    minEvidenceCoverage: z.number().int().min(0).max(100),
    blockUnverifiedSellers: z.boolean(),
    /** Minimum trust score (= 100 − maximum risk score). Below it the product is BLOCKed. */
    minTrustScore: z.number().int().min(0).max(100),
    /** Risk score above which a purchase needs approver sign-off. */
    approvalRiskScore: z.number().int().min(0).max(100),
    allowedCategories: z.array(z.string().trim().min(1).max(60)).max(50),
    blockedCategories: z.array(z.string().trim().min(1).max(60)).max(50),
    autoOrderCreation: z.boolean(),
    approvalTtlMinutes: z.number().int().min(1).max(1440),
    duplicateWindowHours: z.number().int().min(0).max(24 * 90),
    duplicateAction: z.enum(["REQUIRE_APPROVAL", "BLOCK"]),
    optimizerWeights: optimizerWeightsSchema,
  })
  .refine((p) => p.maxPurchaseMinor <= p.maxMissionBudgetMinor, {
    message: "Max individual purchase cannot exceed max mission budget",
    path: ["maxPurchaseMinor"],
  })
  .refine((p) => p.maxAutoPurchaseMinor <= p.maxPurchaseMinor, {
    message: "Max automatic purchase cannot exceed max individual purchase",
    path: ["maxAutoPurchaseMinor"],
  })
  .refine((p) => Object.values(p.optimizerWeights).some((w) => w > 0), {
    message: "At least one optimizer weight must be positive",
    path: ["optimizerWeights"],
  });

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

export const DEFAULT_POLICY: PolicyConfig = {
  currency: "USD",
  maxMissionBudgetMinor: 1_000_000, // $10,000
  maxPurchaseMinor: 500_000, // $5,000
  maxAutoPurchaseMinor: 50_000, // $500
  requireApprovalForEveryPayment: false,
  approvalThresholdMinor: 100_000, // $1,000
  blockOverBudget: true,
  requireSufficientInfo: true,
  minEvidenceCoverage: 70,
  blockUnverifiedSellers: false,
  minTrustScore: 40, // i.e. risk score above 60 is blocked
  approvalRiskScore: 35,
  allowedCategories: [],
  blockedCategories: ["weapons", "gift-cards", "crypto"],
  autoOrderCreation: true,
  approvalTtlMinutes: 30,
  duplicateWindowHours: 24,
  duplicateAction: "REQUIRE_APPROVAL",
  optimizerWeights: { cost: 30, budget: 15, compatibility: 25, delivery: 15, seller: 15 },
};

type LimitKey =
  | "maxMissionBudgetMinor"
  | "maxPurchaseMinor"
  | "maxAutoPurchaseMinor"
  | "approvalThresholdMinor"
  | "minEvidenceCoverage"
  | "minTrustScore"
  | "approvalRiskScore";

/** Direction in which raising a numeric setting makes the policy looser. */
const LOOSER_WHEN_HIGHER: Record<LimitKey, boolean> = {
  maxMissionBudgetMinor: true,
  maxPurchaseMinor: true,
  maxAutoPurchaseMinor: true,
  approvalThresholdMinor: true,
  minEvidenceCoverage: false,
  minTrustScore: false,
  approvalRiskScore: true,
};

/** Flags where `true` is the stricter setting. */
const STRICT_WHEN_TRUE = [
  "requireApprovalForEveryPayment",
  "blockOverBudget",
  "requireSufficientInfo",
  "blockUnverifiedSellers",
] as const;

export interface PolicyChange {
  field: string;
  before: unknown;
  after: unknown;
  loosens: boolean;
}

/** Field-level diff with a "loosens" flag, used for the UI warning and the audit record. */
export function diffPolicies(before: PolicyConfig, after: PolicyConfig): PolicyChange[] {
  const changes: PolicyChange[] = [];
  for (const key of Object.keys(LOOSER_WHEN_HIGHER) as LimitKey[]) {
    if (before[key] !== after[key]) {
      const higher = after[key] > before[key];
      changes.push({ field: key, before: before[key], after: after[key], loosens: higher === LOOSER_WHEN_HIGHER[key] });
    }
  }
  for (const key of STRICT_WHEN_TRUE) {
    if (before[key] !== after[key]) {
      changes.push({ field: key, before: before[key], after: after[key], loosens: before[key] && !after[key] });
    }
  }
  if (before.autoOrderCreation !== after.autoOrderCreation) {
    changes.push({ field: "autoOrderCreation", before: before.autoOrderCreation, after: after.autoOrderCreation, loosens: after.autoOrderCreation });
  }
  if (before.currency !== after.currency) {
    changes.push({ field: "currency", before: before.currency, after: after.currency, loosens: false });
  }
  if (before.approvalTtlMinutes !== after.approvalTtlMinutes) {
    changes.push({ field: "approvalTtlMinutes", before: before.approvalTtlMinutes, after: after.approvalTtlMinutes, loosens: after.approvalTtlMinutes > before.approvalTtlMinutes });
  }
  if (before.duplicateWindowHours !== after.duplicateWindowHours) {
    changes.push({ field: "duplicateWindowHours", before: before.duplicateWindowHours, after: after.duplicateWindowHours, loosens: after.duplicateWindowHours < before.duplicateWindowHours });
  }
  if (before.duplicateAction !== after.duplicateAction) {
    changes.push({ field: "duplicateAction", before: before.duplicateAction, after: after.duplicateAction, loosens: after.duplicateAction === "REQUIRE_APPROVAL" });
  }
  const setDiff = (field: "allowedCategories" | "blockedCategories") => {
    const a = [...before[field]].sort().join(",");
    const b = [...after[field]].sort().join(",");
    if (a !== b) {
      const loosens =
        field === "blockedCategories"
          ? before[field].some((c) => !after[field].includes(c))
          : (before[field].length > 0 && after[field].length === 0) || after[field].some((c) => !before[field].includes(c));
      changes.push({ field, before: before[field], after: after[field], loosens });
    }
  };
  setDiff("allowedCategories");
  setDiff("blockedCategories");
  const wb = JSON.stringify(before.optimizerWeights);
  const wa = JSON.stringify(after.optimizerWeights);
  if (wb !== wa) changes.push({ field: "optimizerWeights", before: before.optimizerWeights, after: after.optimizerWeights, loosens: false });
  return changes;
}
