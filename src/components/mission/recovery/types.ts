import type { RecoveryAnalysis, RevisionProjection } from "@/domain/recovery/analysis";
import type { RecoveryAdvice } from "@/domain/recovery/advice";
import type { MissionConstraints } from "@/domain/types";

export type { RecoveryAnalysis, RevisionProjection, RecoveryAdvice, MissionConstraints };

export interface OverrideDTO {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  challengedChecks: { checkId: string; label: string; policyField: string | null; offers: { productId: string; title: string; detail: string }[] }[];
  currentBudgetMinor: number;
  proposedBudgetMinor: number | null;
  currency: string;
  proposedChange: string | null;
  justification: string;
  missionVersion: number;
  policyVersion: number;
  requestedById: string;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface RecoveryDTO {
  analysis: RecoveryAnalysis;
  constraints: MissionConstraints;
  mission: { id: string; status: string; version: number; revisedFromId: string | null; revisionNumber: number };
  canRevise: boolean;
  policyCapMinor: number;
  overrides: OverrideDTO[];
  revisions: { id: string; status: string; decision: string | null; revisionNumber: number; createdAt: string; budgetMinor: number | null; quantity: number | null }[];
  advisor: { llmConfigured: boolean; llmCallsRemaining: number };
  overrideReviewersConfigured: boolean;
}

export interface PreviewDTO {
  diff: { field: string; label: string; display: { before: string; after: string }; relaxesMandatory: boolean }[];
  relaxations: { field: string; label: string; display: { before: string; after: string } }[];
  warnings: string[];
  projection: RevisionProjection;
  policyVersion: number;
  policyChangedSinceEvaluation: boolean;
  missionVersion: number;
}

export interface AlternativesDTO {
  provider: string;
  isDemo: boolean;
  fallbackReason: string | null;
  queries: string[];
  searchedAt: string;
  total: number;
  viableCount: number;
  suggestedQuery: string | null;
  note: string;
  results: {
    key: string;
    query: string;
    title: string;
    sellerName: string | null;
    sellerVerification: string;
    provider: string;
    isDemoData: boolean;
    offerUrl: string | null;
    unitPriceMinor: number;
    totalMinor: number | null;
    basis: "EXACT" | "CAP" | "UNKNOWN";
    withinBudget: boolean;
    compatibility: "MATCH" | "UNVERIFIED" | "MISMATCH";
    attributes: { key: string; required: string; state: string }[];
    riskScore: number;
    evidenceCoverage: number;
    deliveryDays: number | null;
    projectedDecision: string;
    viable: boolean;
    blockers: { id: string; label: string; detail: string }[];
    approvalReasons: string[];
    alreadyEvaluated: boolean;
  }[];
}

export interface AdviceDTO {
  advice: RecoveryAdvice;
  source: "llm" | "deterministic";
  problems: string[];
  fallbackReason: string | null;
}

/** Edits a revision may carry (mirrors the server's revisionChangesSchema). */
export type RevisionChanges = Partial<Pick<MissionConstraints, "budgetMinor" | "quantity" | "deadlineDays" | "requiredAttributes" | "productQuery" | "maxRiskScore">>;
