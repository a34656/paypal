/**
 * ONE reducer for live and replay: events → MissionViewModel.
 * The 3D scene, timeline and status panels all render from this. Live mode feeds it polled
 * events; replay feeds it the same stored events up to the scrubber position. Scene state is
 * derived from recorded events only — never from fabricated activity.
 */

export interface MissionEvent {
  seq: number;
  actor: string;
  eventType: string;
  outcome: string;
  metadata: unknown;
  schemaVersion: number;
  mode: string;
  createdAt: string;
}

export type SceneState =
  | "IDLE"
  | "STARTED"
  | "DISCOVERY"
  | "RISK"
  | "POLICY"
  | "APPROVAL_REQUIRED"
  | "BLOCKED"
  | "CHECKOUT"
  | "CAPTURED"
  | "FAILED";

export type StepState = "pending" | "running" | "done" | "failed";
export type NodeId = "core" | "interpreter" | "scout" | "risk" | "optimizer" | "policy" | "human" | "paypal";

export interface TimelineItem {
  seq: number;
  at: string;
  label: string;
  actor: string;
  outcome: string;
  eventType: string;
  node: NodeId;
}

export interface MissionViewModel {
  scene: SceneState;
  steps: Record<"SCOUT" | "RISK" | "OPTIMIZE" | "POLICY", StepState>;
  workflowStatus: string | null;
  decision: string | null;
  candidates: number | null;
  paymentStatus: string | null;
  simulated: boolean | null;
  approvals: number;
  timeline: TimelineItem[];
  /** Node most recently active; drives the animated connection (core → node). */
  activeNode: NodeId | null;
  lastEvent: TimelineItem | null;
  eventCount: number;
}

export const INITIAL_VIEW_MODEL: MissionViewModel = {
  scene: "IDLE",
  steps: { SCOUT: "pending", RISK: "pending", OPTIMIZE: "pending", POLICY: "pending" },
  workflowStatus: null,
  decision: null,
  candidates: null,
  paymentStatus: null,
  simulated: null,
  approvals: 0,
  timeline: [],
  activeNode: null,
  lastEvent: null,
  eventCount: 0,
};

type Meta = Record<string, unknown>;
const meta = (e: MissionEvent): Meta => (e.metadata && typeof e.metadata === "object" ? (e.metadata as Meta) : {});
const str = (v: unknown) => (typeof v === "string" ? v : null);

const STEP_NODE: Record<string, NodeId> = { SCOUT: "scout", RISK: "risk", OPTIMIZE: "optimizer", POLICY: "policy" };
const STEP_SCENE: Record<string, SceneState> = { SCOUT: "DISCOVERY", RISK: "RISK", OPTIMIZE: "RISK", POLICY: "POLICY" };

function nodeFor(e: MissionEvent): NodeId {
  const m = meta(e);
  const step = str(m.step);
  if (step && STEP_NODE[step]) return STEP_NODE[step];
  if (e.actor.startsWith("agent:mission-interpreter")) return "interpreter";
  if (e.eventType.startsWith("payment.") || e.actor.startsWith("provider:") || e.actor.startsWith("webhook:")) return "paypal";
  if (e.eventType.startsWith("approval.")) return "human";
  if (e.actor.startsWith("agent:policy-guard") || e.actor.startsWith("system:policy-guard")) return "policy";
  return "core";
}

export function labelFor(e: MissionEvent): string {
  const m = meta(e);
  const step = str(m.step);
  switch (e.eventType) {
    case "mission.created":
      return "Mission created";
    case "mission.parsed":
      return `Mission parsed (${str(m.parserSource) ?? "parser"}) — awaiting confirmation`;
    case "mission.confirmed":
      return "Constraints confirmed by user";
    case "agent.step_started":
      return `${step ?? "Step"} started (attempt ${m.attempt ?? 1})`;
    case "agent.step_completed":
      return `${step ?? "Step"} completed${typeof m.candidates === "number" ? ` — ${m.candidates} candidates` : ""}`;
    case "agent.step_retry":
      return `${step ?? "Step"} failed, retrying`;
    case "agent.step_failed":
      return `${step ?? "Step"} failed permanently`;
    case "policy.evaluated":
      return `Policy decision: ${str(m.decision)?.replace(/_/g, " ") ?? "—"}`;
    case "approval.granted":
      return "Approved by approver";
    case "approval.authorized":
      return "Purchase authorised by owner";
    case "approval.denied":
      return "Mission denied";
    case "approval.invalidated":
      return "Approval invalidated";
    case "approval.expired":
      return "Approval expired";
    case "approval.rejected_by_policy":
      return "Approval refused: policy blocks";
    case "payment.initiated":
      return m.simulated ? "Simulated payment initiated" : "Payment initiated";
    case "payment.order_created":
      return m.simulated ? "Simulated order created" : "PayPal order created";
    case "payment.checkout_started":
      return "Buyer checkout started";
    case "payment.simulated_buyer_approval":
      return "Simulated buyer approval (DEMO)";
    case "payment.capture_started":
      return "Capture started";
    case "payment.captured":
      return m.simulated ? "SIMULATED capture recorded (no money moved)" : "Captured — confirmed by PayPal";
    case "payment.capture_pending_at_provider":
      return "Capture pending at PayPal";
    case "payment.capture_failed":
      return "Capture failed";
    case "payment.cancelled":
      return "Checkout cancelled";
    case "payment.refunded":
      return "Refunded in full";
    case "payment.partially_refunded":
      return "Partially refunded";
    case "payment.refund_requested":
      return m.simulated ? "Simulated refund requested" : "Refund requested";
    case "payment.refund_failed":
      return "Refund failed";
    case "payment.authorize_started":
      return "Authorization hold requested";
    case "payment.authorized":
      return m.simulated ? "SIMULATED hold placed (no money moved)" : "Authorization hold placed by PayPal";
    case "payment.authorize_failed":
      return "Authorization failed";
    case "payment.settle_started":
      return "Settlement of the final amount started";
    case "payment.hold_release_requested":
      return "Hold release requested";
    case "payment.hold_released":
      return "Hold released — nothing captured";
    case "payment.hold_expired":
      return "Hold expired — nothing captured";
    case "mission.completed":
      return "Mission completed";
    case "mission.failed":
      return "Mission failed";
    default:
      return e.eventType.replace(/[._]/g, " ");
  }
}

export function reduceEvent(vm: MissionViewModel, e: MissionEvent): MissionViewModel {
  const m = meta(e);
  const to = str(m.to);
  const step = str(m.step) as keyof MissionViewModel["steps"] | null;
  const node = nodeFor(e);
  const item: TimelineItem = { seq: e.seq, at: e.createdAt, label: labelFor(e), actor: e.actor, outcome: e.outcome, eventType: e.eventType, node };
  const next: MissionViewModel = {
    ...vm,
    steps: { ...vm.steps },
    timeline: [...vm.timeline, item],
    lastEvent: item,
    activeNode: node,
    eventCount: vm.eventCount + 1,
  };
  if (to && !e.eventType.startsWith("payment.")) next.workflowStatus = to;

  switch (e.eventType) {
    case "mission.created":
    case "mission.parsed":
    case "mission.confirmed":
      next.scene = "STARTED";
      break;
    case "agent.step_started":
      if (step && step in next.steps) next.steps[step] = "running";
      next.scene = step ? (STEP_SCENE[step] ?? next.scene) : next.scene;
      break;
    case "agent.step_completed":
      if (step && step in next.steps) next.steps[step] = "done";
      if (step === "SCOUT" && typeof m.candidates === "number") next.candidates = m.candidates;
      next.scene = step === "SCOUT" ? "RISK" : step === "RISK" ? "RISK" : "POLICY";
      break;
    case "agent.step_retry":
      if (step && step in next.steps) next.steps[step] = "running";
      break;
    case "agent.step_failed":
      if (step && step in next.steps) next.steps[step] = "failed";
      break;
    case "policy.evaluated":
      next.steps.POLICY = "done";
      next.decision = str(m.decision);
      next.scene = to === "BLOCKED" ? "BLOCKED" : "APPROVAL_REQUIRED";
      break;
    case "approval.granted":
    case "approval.authorized":
      next.approvals += 1;
      next.scene = "CHECKOUT";
      break;
    case "approval.denied":
      next.scene = "BLOCKED";
      break;
    case "approval.invalidated":
    case "approval.expired":
      next.scene = to === "BLOCKED" ? "BLOCKED" : "APPROVAL_REQUIRED";
      if (to === "BLOCKED") next.decision = "BLOCK";
      break;
    case "payment.initiated":
    case "payment.order_created":
    case "payment.checkout_started":
    case "payment.simulated_buyer_approval":
    case "payment.capture_started":
    case "payment.capture_pending_at_provider":
    case "payment.authorize_started":
    case "payment.authorized":
    case "payment.settle_started":
      next.scene = "CHECKOUT";
      if (typeof m.simulated === "boolean") next.simulated = m.simulated;
      if (to) next.paymentStatus = to;
      else if (e.eventType === "payment.initiated") next.paymentStatus = "APPROVED";
      break;
    case "payment.captured":
    case "mission.completed":
      next.scene = "CAPTURED";
      if (e.eventType === "payment.captured") next.paymentStatus = "CAPTURED";
      if (typeof m.simulated === "boolean") next.simulated = m.simulated;
      break;
    case "payment.refunded":
      next.paymentStatus = "REFUNDED";
      break;
    case "payment.partially_refunded":
      next.paymentStatus = "PARTIALLY_REFUNDED";
      break;
    case "payment.capture_failed":
    case "payment.authorize_failed":
    case "payment.cancelled":
    case "payment.expired":
    case "payment.hold_released":
    case "payment.hold_expired":
      if (to) next.paymentStatus = to;
      next.scene = e.eventType === "payment.capture_failed" || e.eventType === "payment.authorize_failed" ? "FAILED" : e.eventType.startsWith("payment.hold_") ? "BLOCKED" : "APPROVAL_REQUIRED";
      break;
    case "mission.failed":
      next.scene = "FAILED";
      break;
  }
  return next;
}

export function reduceEvents(events: MissionEvent[], upTo = Number.POSITIVE_INFINITY): MissionViewModel {
  let vm = INITIAL_VIEW_MODEL;
  for (const e of events) {
    if (e.seq > upTo) break;
    vm = reduceEvent(vm, e);
  }
  return vm;
}

export const SCENE_LABEL: Record<SceneState, string> = {
  IDLE: "Idle",
  STARTED: "Mission started",
  DISCOVERY: "Discovery",
  RISK: "Risk analysis",
  POLICY: "Policy evaluation",
  APPROVAL_REQUIRED: "Human decision required",
  BLOCKED: "Blocked",
  CHECKOUT: "Checkout / payment",
  CAPTURED: "Captured",
  FAILED: "Failed",
};
