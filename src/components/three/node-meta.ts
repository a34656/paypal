import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";

/** Shared node metadata (kept free of three.js imports so the 2D fallback stays light). */
export const NODE_META_2D: Record<NodeId, { label: string; color: string; kind: string }> = {
  core: { label: "AEGIS Core", color: "#6FE3EE", kind: "Orchestrator" },
  interpreter: { label: "Interpreter", color: "#9D8CF2", kind: "Agent" },
  scout: { label: "Scout", color: "#86A8FF", kind: "Product discovery" },
  risk: { label: "Risk", color: "#F2B45A", kind: "Seller · price · delivery · evidence" },
  optimizer: { label: "Optimizer", color: "#86A8FF", kind: "Comparison and ranking" },
  policy: { label: "Policy Guard", color: "#52D3A3", kind: "Deterministic enforcement" },
  human: { label: "Human Gate", color: "#F2EEE6", kind: "Human approval" },
  paypal: { label: "PayPal", color: "#6FE3EE", kind: "Order and payment" },
};

/** The five agents shown in the network (interpreter and human render as core / gate). */
export type AgentNode = "scout" | "risk" | "optimizer" | "policy" | "paypal";

export type NodeVisualState = "idle" | "active" | "done" | "warning" | "blocked" | "success";

const STEP_OF: Record<Exclude<AgentNode, "paypal">, keyof MissionViewModel["steps"]> = { scout: "SCOUT", risk: "RISK", optimizer: "OPTIMIZE", policy: "POLICY" };

/**
 * Visual state of an agent node, derived purely from the recorded-event view model.
 * PayPal is lit only once a payment exists (after policy, approval and checkout).
 */
export function nodeState(id: AgentNode, vm: MissionViewModel | null): NodeVisualState {
  if (!vm) return "idle";
  if (id === "paypal") {
    const s = vm.paymentStatus;
    if (!s) return "idle";
    if (["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(s)) return "success";
    if (["FAILED", "BLOCKED", "EXPIRED", "CANCELLED"].includes(s)) return "blocked";
    return vm.activeNode === "paypal" ? "active" : "done";
  }
  const step = vm.steps[STEP_OF[id]];
  if (step === "failed") return "blocked";
  if (step === "running") return "active";
  if (id === "policy" && vm.decision) return vm.decision === "BLOCK" ? "blocked" : vm.decision === "REQUIRE_APPROVAL" ? "warning" : "success";
  if (step === "done") return vm.activeNode === id ? "active" : "done";
  return "idle";
}
