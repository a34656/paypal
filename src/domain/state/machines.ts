/**
 * Single source of truth for workflow and payment state machines.
 * Every DB status update goes through `assertTransition` and a compare-and-set write.
 * Transitions are monotonic: terminal states have no outgoing edges (except the
 * explicit post-capture edges CAPTURED → REFUNDED/DISPUTED), so a late webhook or a
 * retried request can never regress a terminal state.
 */
import type { PaymentStatus, WorkflowStatus } from "@/generated/prisma/enums";

export const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  CREATED: ["PARSED", "FAILED"],
  PARSED: ["CONFIRMED", "FAILED", "EXPIRED"],
  CONFIRMED: ["SCOUTING", "FAILED"],
  SCOUTING: ["SCOUTED", "FAILED"],
  SCOUTED: ["RISK_ANALYSIS", "FAILED"],
  RISK_ANALYSIS: ["OPTIMIZING", "FAILED"],
  OPTIMIZING: ["POLICY_EVALUATION", "FAILED"],
  POLICY_EVALUATION: ["AWAITING_APPROVAL", "BLOCKED", "READY_FOR_CHECKOUT", "FAILED"],
  AWAITING_APPROVAL: ["READY_FOR_CHECKOUT", "DENIED", "EXPIRED", "BLOCKED"],
  // READY_FOR_CHECKOUT → AWAITING_APPROVAL: re-approval required after a stricter policy at capture.
  READY_FOR_CHECKOUT: ["COMPLETED", "AWAITING_APPROVAL", "BLOCKED", "DENIED", "EXPIRED"],
  BLOCKED: [],
  FAILED: [],
  EXPIRED: [],
  DENIED: [],
  COMPLETED: [],
};

export const WORKFLOW_TERMINAL: readonly WorkflowStatus[] = ["BLOCKED", "FAILED", "EXPIRED", "DENIED", "COMPLETED"];

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  NOT_STARTED: ["PENDING_APPROVAL", "APPROVED", "BLOCKED"],
  PENDING_APPROVAL: ["APPROVED", "BLOCKED", "EXPIRED", "CANCELLED"],
  APPROVED: ["ORDER_CREATED", "FAILED", "CANCELLED", "EXPIRED", "BLOCKED"],
  ORDER_CREATED: ["CHECKOUT_PENDING", "FAILED", "CANCELLED", "EXPIRED", "BLOCKED"],
  CHECKOUT_PENDING: ["CAPTURE_PENDING", "FAILED", "CANCELLED", "EXPIRED", "BLOCKED"],
  CAPTURE_PENDING: ["CAPTURED", "CAPTURE_PROVIDER_PENDING", "FAILED"],
  CAPTURE_PROVIDER_PENDING: ["CAPTURED", "FAILED"],
  CAPTURED: ["REFUNDED", "DISPUTED"],
  DISPUTED: ["REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  BLOCKED: [],
  EXPIRED: [],
  REFUNDED: [],
};

/** Payment rows in these states occupy the mission's single payment slot. */
export const PAYMENT_LIVE: readonly PaymentStatus[] = [
  "APPROVED",
  "ORDER_CREATED",
  "CHECKOUT_PENDING",
  "CAPTURE_PENDING",
  "CAPTURE_PROVIDER_PENDING",
  "CAPTURED",
  "DISPUTED",
  "REFUNDED",
];
export const PAYMENT_IN_FLIGHT: readonly PaymentStatus[] = [
  "APPROVED",
  "ORDER_CREATED",
  "CHECKOUT_PENDING",
  "CAPTURE_PENDING",
  "CAPTURE_PROVIDER_PENDING",
];
export const PAYMENT_SUCCESS: readonly PaymentStatus[] = ["CAPTURED", "REFUNDED", "DISPUTED"];

export class IllegalTransitionError extends Error {
  constructor(
    public readonly machine: "workflow" | "payment",
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Illegal ${machine} transition ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransitionWorkflow(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return WORKFLOW_TRANSITIONS[from].includes(to);
}
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}
export function assertWorkflowTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  if (!canTransitionWorkflow(from, to)) throw new IllegalTransitionError("workflow", from, to);
}
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransitionPayment(from, to)) throw new IllegalTransitionError("payment", from, to);
}

export type DisplayStatus =
  | "DRAFT"
  | "AWAITING_CONFIRMATION"
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "READY_FOR_CHECKOUT"
  | "CHECKOUT_IN_PROGRESS"
  | "CAPTURE_PENDING"
  | "COMPLETED"
  | "REFUNDED"
  | "DISPUTED"
  | "BLOCKED"
  | "DENIED"
  | "EXPIRED"
  | "FAILED";

/** Mission status shown in the UI, derived from workflow + latest payment. Never stored. */
export function deriveDisplayStatus(workflow: WorkflowStatus, payment: PaymentStatus | null): DisplayStatus {
  if (payment === "REFUNDED") return "REFUNDED";
  if (payment === "DISPUTED") return "DISPUTED";
  if (workflow === "COMPLETED" || payment === "CAPTURED") return "COMPLETED";
  switch (workflow) {
    case "CREATED":
      return "DRAFT";
    case "PARSED":
      return "AWAITING_CONFIRMATION";
    case "CONFIRMED":
      return "QUEUED";
    case "SCOUTING":
    case "SCOUTED":
    case "RISK_ANALYSIS":
    case "OPTIMIZING":
    case "POLICY_EVALUATION":
      return "RUNNING";
    case "AWAITING_APPROVAL":
      return "AWAITING_APPROVAL";
    case "READY_FOR_CHECKOUT":
      if (payment === "CAPTURE_PENDING" || payment === "CAPTURE_PROVIDER_PENDING") return "CAPTURE_PENDING";
      if (payment === "ORDER_CREATED" || payment === "CHECKOUT_PENDING") return "CHECKOUT_IN_PROGRESS";
      return "READY_FOR_CHECKOUT";
    case "BLOCKED":
      return "BLOCKED";
    case "DENIED":
      return "DENIED";
    case "EXPIRED":
      return "EXPIRED";
    case "FAILED":
      return "FAILED";
  }
}
