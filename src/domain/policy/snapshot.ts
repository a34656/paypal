/** Builds the policy engine's input from stored mission/product/evaluation data. Pure. */
import type { RiskAssessment } from "@/domain/risk/engine";
import type { SellerVerification } from "@/domain/types";
import type { PolicySnapshot } from "./engine";

export interface SnapshotProduct {
  currency: string;
  unitPriceMinor: number;
  shippingMinor: number | null;
  taxMinor: number | null;
  category: string;
  sellerVerificationStatus: SellerVerification;
}

export interface SnapshotEvaluation {
  totalMinor: number | null;
  riskScore: number | null;
  evidenceCoverage: number | null;
  riskEvidence: unknown;
  amountBasis: string | null;
  allowanceMinor: number | null;
}

export function snapshotFor(
  mission: { budgetMinor: number; currency: string; quantity: number; maxRiskScore?: number | null },
  product: SnapshotProduct,
  mp: SnapshotEvaluation,
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
    amountBasis: mp.amountBasis === "CAP" ? "CAP" : mp.totalMinor != null ? "EXACT" : null,
    allowanceMinor: mp.allowanceMinor,
    category: product.category,
    sellerVerification: product.sellerVerificationStatus,
    riskScore: mp.riskScore,
    evidenceCoverage: mp.evidenceCoverage,
    requirementMismatch: evidence ? evidence.requirementMismatch : null,
    injectionSignals: evidence?.injectionSignals ?? [],
    missionMaxRiskScore: mission.maxRiskScore ?? null,
  };
}
