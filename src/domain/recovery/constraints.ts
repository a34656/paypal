/**
 * What each policy/eligibility check means for recovery: who can change it, whether a policy
 * override can even be requested, and the concrete next action. Pure metadata — it never
 * changes an evaluation. Check ids are the ones produced by src/domain/policy/engine.ts.
 */

/**
 * MISSION  — the requester can change it by revising the mission (budget, quantity, requirements…)
 * POLICY   — only a versioned policy change by an authorised policy owner can change it
 * EVIDENCE — needs better data (a refreshed quote, a seller that discloses more), or another offer
 * NONE     — system-enforced; nothing in the application can relax it
 */
export type Adjustability = "MISSION" | "POLICY" | "MISSION_OR_POLICY" | "EVIDENCE" | "NONE";

export interface CheckMeta {
  adjustability: Adjustability;
  /** Mission field(s) a revision could change to resolve it. */
  missionFields: string[];
  /** Policy setting that governs it (for override requests and explanations). */
  policyField: string | null;
  /** Can a policy override REQUEST be filed against it? Floor checks: never. */
  overridable: boolean;
  /** Price/quantity driven (budget changes can resolve it). */
  financial: boolean;
  nextAction: string;
  /** Why a budget increase alone will not resolve it (non-financial checks only). */
  budgetWontHelp?: string;
}

const FLOOR_NONE = (nextAction: string, budgetWontHelp: string): CheckMeta => ({
  adjustability: "NONE",
  missionFields: [],
  policyField: null,
  overridable: false,
  financial: false,
  nextAction,
  budgetWontHelp,
});

export const CHECK_META: Record<string, CheckMeta> = {
  "floor.amounts_valid": FLOOR_NONE("The offer data is malformed. Choose another offer or refresh the quote.", "The amounts themselves are invalid."),
  "floor.currency": FLOOR_NONE("Choose an offer priced in the mission currency. AEGIS performs no currency conversion.", "Currency mismatch is not a price problem."),
  "floor.total_known": {
    adjustability: "EVIDENCE",
    missionFields: [],
    policyField: "costAllowancePct",
    overridable: false,
    financial: false,
    nextAction: "Request a refreshed quote that discloses shipping and tax, or choose an offer that does.",
    budgetWontHelp: "An amount that cannot be stated cannot be authorised, whatever the budget.",
  },
  "floor.risk_evaluated": FLOOR_NONE("Re-run the mission so the risk assessment completes.", "No risk assessment exists for this offer."),
  "floor.untrusted_content": FLOOR_NONE("Do not buy from this listing: its text tries to instruct the purchasing agent.", "The listing is blocked for its content, not its price."),
  "floor.mission_budget_cap": {
    adjustability: "MISSION_OR_POLICY",
    missionFields: ["budgetMinor"],
    policyField: "maxMissionBudgetMinor",
    overridable: true,
    financial: true,
    nextAction: "Lower the mission budget to the policy cap, or ask the policy owner to raise the cap in a new policy version.",
  },
  "floor.spend_cap": FLOOR_NONE("Undisclosed shipping/tax always need approver sign-off.", "This is an approval requirement, not a block."),
  "budget.mission": {
    adjustability: "MISSION_OR_POLICY",
    missionFields: ["budgetMinor", "quantity"],
    policyField: "blockOverBudget",
    overridable: true,
    financial: true,
    nextAction: "Raise the budget to at least the offer total, or reduce the quantity.",
  },
  "limit.max_purchase": {
    adjustability: "MISSION_OR_POLICY",
    missionFields: ["quantity"],
    policyField: "maxPurchaseMinor",
    overridable: true,
    financial: true,
    nextAction: "Reduce the quantity (split the purchase) or ask the policy owner to raise the per-purchase limit.",
    budgetWontHelp: "The per-purchase limit is a policy setting; raising the mission budget does not change it.",
  },
  category: {
    adjustability: "POLICY",
    missionFields: [],
    policyField: "blockedCategories",
    overridable: true,
    financial: false,
    nextAction: "This category is not permitted by policy. Only the policy owner can change the category lists.",
    budgetWontHelp: "The category is not permitted, at any price.",
  },
  "seller.verification": {
    adjustability: "POLICY",
    missionFields: [],
    policyField: "blockUnverifiedSellers",
    overridable: true,
    financial: false,
    nextAction: "Choose an offer from a verified seller, or ask the policy owner to trust this retailer domain.",
    budgetWontHelp: "Seller verification needs evidence about the seller, not more money.",
  },
  "risk.max": {
    adjustability: "POLICY",
    missionFields: ["requiredAttributes", "deadlineDays"],
    policyField: "minTrustScore",
    overridable: true,
    financial: false,
    nextAction: "Choose a better-documented offer. Some risk comes from your own requirements (undisclosed attributes, a deadline); see the paths below.",
    budgetWontHelp: "The offer's risk score is too high; risk does not depend on your budget.",
  },
  "mission.risk_tolerance": {
    adjustability: "MISSION",
    missionFields: ["maxRiskScore"],
    policyField: null,
    overridable: false,
    financial: false,
    nextAction: "This is your own mission risk tolerance. Revise it (the policy maximum still applies) or choose a lower-risk offer.",
    budgetWontHelp: "Your mission risk tolerance is independent of price.",
  },
  "evidence.coverage": {
    adjustability: "EVIDENCE",
    missionFields: ["requiredAttributes"],
    policyField: "minEvidenceCoverage",
    overridable: true,
    financial: false,
    nextAction: "The listing discloses too little. Choose an offer with more data, request a refreshed quote, or ask the policy owner to review the evidence minimum.",
    budgetWontHelp: "Missing listing data is not fixed by a larger budget.",
  },
  "requirements.match": {
    adjustability: "MISSION",
    missionFields: ["requiredAttributes"],
    policyField: null,
    overridable: false,
    financial: false,
    nextAction: "Choose an offer that states your required attributes, or explicitly mark an attribute as optional.",
    budgetWontHelp: "The product does not demonstrably meet your specification.",
  },
  /** Optimizer hard gate: an explicit attribute mismatch excludes the offer from ranking. */
  "eligibility.requirements": {
    adjustability: "MISSION",
    missionFields: ["requiredAttributes"],
    policyField: null,
    overridable: false,
    financial: false,
    nextAction: "The listing contradicts a required attribute. Choose another product, or change the requirement if it was wrong.",
    budgetWontHelp: "The product contradicts your specification.",
  },
  duplicate: {
    adjustability: "POLICY",
    missionFields: [],
    policyField: "duplicateAction",
    overridable: true,
    financial: false,
    nextAction: "An identical purchase was authorised recently. Confirm it is not a duplicate; the policy owner controls the duplicate rule.",
    budgetWontHelp: "Duplicate detection is independent of price.",
  },
};

const UNKNOWN_META: CheckMeta = {
  adjustability: "NONE",
  missionFields: [],
  policyField: null,
  overridable: false,
  financial: false,
  nextAction: "Review the check detail.",
  budgetWontHelp: "Not a price check.",
};

export function checkMeta(id: string): CheckMeta {
  return CHECK_META[id] ?? UNKNOWN_META;
}

export const ADJUSTABILITY_LABEL: Record<Adjustability, string> = {
  MISSION: "You can change this",
  POLICY: "Policy owner only",
  MISSION_OR_POLICY: "You or the policy owner",
  EVIDENCE: "Needs better offer data",
  NONE: "Cannot be overridden",
};
