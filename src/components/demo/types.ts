import type { DemoMode, DemoChoiceOption } from "./state";

/** Stable spotlight targets. Components opt in with `data-demo-target="<id>"`; never class names. */
export type DemoTarget =
  | "trust-core"
  | "governance-workflow"
  | "app-navigation"
  | "purchase-prompt"
  | "parse-mission"
  | "confirm-mission"
  | "offer-comparison"
  | "approval-panel"
  | "checkout-panel"
  | "policy-config"
  | "audit-log";

export type AgentId = "scout" | "risk" | "optimizer" | "policy" | "human" | "payment";
export type AgentStatus = "pending" | "running" | "completed" | "flagged" | "awaiting_authorization" | "blocked" | "failed";
/** engine = VANTA's real deterministic engines on fictional inputs; simulated = presentation-only; live = real backend record. */
export type EventSource = "engine" | "simulated" | "live";

export interface TimelineEvent {
  id: string;
  agent: AgentId;
  status: AgentStatus;
  label: string;
  source: EventSource;
}

export type StageView = "offers" | "risk" | "policy" | "approval" | "payment" | "audit";

/** Mirrors GET /api/demo/evaluate. */
export interface DemoCheck {
  id: string;
  label: string;
  result: "PASS" | "REQUIRE_APPROVAL" | "BLOCK";
  detail: string;
  floor: boolean;
}
export interface DemoOffer {
  key: string;
  title: string;
  description: string | null;
  seller: string | null;
  sellerVerification: string;
  unitPriceMinor: number;
  shippingMinor: number | null;
  taxMinor: number | null;
  shippingEstimateDays: number | null;
  amounts: { basis: "EXACT" | "CAP"; totalMinor: number; itemTotalMinor: number; allowanceMinor: number } | null;
  risk: {
    score: number;
    level: string;
    evidenceCoverage: number;
    reasons: string[];
    missing: string[];
    injectionSignals: string[];
    factors: { id: string; label: string; status: string; evidence: string; contribution: number; max: number }[];
  };
  optimizer: { eligible: boolean; ineligibleReasons: string[]; rank: number | null; score: number | null; explanation: string };
  policy: { decision: "ALLOW_CHECKOUT" | "REQUIRE_APPROVAL" | "BLOCK"; reasons: string[]; checks: DemoCheck[] };
}
export interface DemoEvaluation {
  fictional: true;
  persisted: false;
  mission: { title: string; objective: string; quantity: number; budgetMinor: number; currency: string; deadlineDays: number | null };
  policy: { version: number; maxAutoPurchaseMinor: number; approvalThresholdMinor: number; maxPurchaseMinor: number; approvalTtlMinutes: number };
  offers: DemoOffer[];
  recommendedKey: string | null;
  decision: "ALLOW_CHECKOUT" | "REQUIRE_APPROVAL" | "BLOCK";
}

/** Subset of GET /api/missions/:id used by live scenes. */
export interface LiveMission {
  mission: { id: string; title: string; status: string; displayStatus: string; decision: string | null; budgetMinor: number | null; currency: string | null; mode: string };
  products: { productId: string; policyDecision: string | null; eligible: boolean | null; recommendationRank: number | null; totalMinor: number | null; product: { title: string; sellerName: string | null; currency: string } }[];
  approvals: { status: string; expiresAt: string }[];
  payments: { status: string; amountMinor: number; currency: string; provider: string; providerOrderId: string | null }[];
  agentRuns: { step: string; status: string }[];
}

export interface SceneContext {
  mode: DemoMode;
  evaluation: DemoEvaluation | null;
  decisions: Record<string, string>;
  live: LiveMission | null;
  liveMissionId: string | null;
  pathname: string;
}

export type DemoAction =
  | { kind: "navigate"; href: string | ((ctx: SceneContext) => string | null) }
  | { kind: "spotlight"; target: DemoTarget; caption: string; optional?: boolean }
  | { kind: "clear-spotlight" }
  | { kind: "type"; input: "purchase-prompt"; text: string }
  | { kind: "wait"; ms: number }
  | { kind: "stage"; view: StageView | null }
  | { kind: "evaluate" }
  | { kind: "live-refresh" }
  | { kind: "choice"; id: string; prompt: string; options: DemoChoiceOption[] }
  /** Live mode: stop until the visitor does `prompt` in the real UI and `until` holds. Never performed by the demo. */
  | { kind: "await-human"; id: string; prompt: string; target?: DemoTarget; until: (ctx: SceneContext) => boolean }
  /** Hold on the scene long enough to read its narration. */
  | { kind: "hold" };

export interface DemoQuestion {
  q: string;
  keywords: string[];
  a: (ctx: SceneContext) => string;
}

export interface DemoScene {
  id: string;
  chapter: 1 | 2 | 3 | 4 | 5;
  title: string;
  narration: string | ((ctx: SceneContext) => string);
  why: string | ((ctx: SceneContext) => string);
  /** Agents shown as active in the compact indicator. */
  agents: AgentId[];
  actions: DemoAction[];
  /** Agent activity this scene contributes; the timeline is rebuilt from scenes 0..current, so going back never duplicates. */
  timeline?: (ctx: SceneContext) => TimelineEvent[];
  questions?: DemoQuestion[];
}
