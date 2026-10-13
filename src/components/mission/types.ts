import type { MissionEvent } from "@/domain/viewmodel/reducer";

export interface RiskFactorDTO {
  id: string;
  label: string;
  contribution: number;
  max: number;
  status: "OK" | "CONCERN" | "MISSING";
  evidence: string;
}
export interface PolicyCheckDTO {
  id: string;
  label: string;
  result: "PASS" | "REQUIRE_APPROVAL" | "BLOCK";
  detail: string;
  floor: boolean;
}
export interface MissionProductDTO {
  id: string;
  productId: string;
  quantity: number;
  totalMinor: number | null;
  riskScore: number | null;
  trustScore: number | null;
  riskLevel: string | null;
  evidenceCoverage: number | null;
  riskEvidence: { factors: RiskFactorDTO[]; reasons: string[]; missingInformation: string[]; recommendedAction: string; basis: string } | null;
  eligible: boolean | null;
  ineligibleReasons: string[] | null;
  recommendationRank: number | null;
  optimizerScore: number | null;
  optimizerExplanation: string | null;
  policyDecision: string | null;
  policyResult: { decision: string; reasons: string[]; checks: PolicyCheckDTO[] } | null;
  product: {
    id: string;
    providerProductId: string;
    title: string;
    description: string | null;
    category: string;
    unitPriceMinor: number;
    shippingMinor: number | null;
    taxMinor: number | null;
    currency: string;
    imageUrl: string | null;
    sellerName: string | null;
    sellerVerificationStatus: string;
    shippingEstimateDays: number | null;
    stockQuantity: number | null;
    attributes: Record<string, string>;
    isDemoData: boolean;
  };
}
export interface ApprovalDTO {
  id: string;
  productId: string;
  kind: string;
  status: string;
  statusReason: string | null;
  snapshotHash: string;
  approvedAmountMinor: number;
  currency: string;
  policyVersion: number;
  decisionAtApproval: string;
  createdAt: string;
  expiresAt: string;
  approvedBy: { displayName: string; roles: string[] };
}
export interface PaymentDTO {
  id: string;
  status: string;
  statusReason: string | null;
  provider: string;
  mode: string;
  providerOrderId: string | null;
  providerCaptureId: string | null;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}
export interface MissionDTO {
  id: string;
  title: string;
  description: string;
  rawInputText: string;
  status: string;
  displayStatus: string;
  mode: string;
  budgetMinor: number | null;
  currency: string | null;
  quantity: number | null;
  decision: string | null;
  policyVersion: number | null;
  recommendedProductId: string | null;
  recommendationSummary: string | null;
  recommendationSource: string | null;
  parserSource: string | null;
  parsedProposal: (Record<string, unknown> & { uncertain?: string[] }) | null;
  confirmedConstraints: Record<string, unknown> | null;
  failureReason: string | null;
  createdAt: string;
}
export interface MissionDetailDTO {
  mission: MissionDTO;
  products: MissionProductDTO[];
  approvals: ApprovalDTO[];
  payments: PaymentDTO[];
  agentRuns: { id: string; step: string; status: string; attempt: number; durationMs: number | null; error: string | null }[];
}
export interface EventsDTO {
  missionId: string;
  mode: string;
  events: (MissionEvent & { id: string; hash: string; resource: string })[];
}
