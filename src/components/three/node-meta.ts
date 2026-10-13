import type { NodeId } from "@/domain/viewmodel/reducer";

/** Shared node metadata (kept free of three.js imports so the 2D fallback stays light). */
export const NODE_META_2D: Record<NodeId, { label: string; color: string; kind: string }> = {
  core: { label: "AEGIS Core", color: "#56E0F0", kind: "Orchestrator" },
  interpreter: { label: "Interpreter", color: "#A78BFA", kind: "Agent" },
  scout: { label: "Scout", color: "#6685FF", kind: "Agent" },
  risk: { label: "Risk", color: "#F4BB61", kind: "Risk engine" },
  optimizer: { label: "Optimizer", color: "#6685FF", kind: "Agent" },
  policy: { label: "Policy Guard", color: "#43D9A3", kind: "Policy engine" },
  human: { label: "Human Approver", color: "#F3F7FB", kind: "Human gate" },
  paypal: { label: "PayPal", color: "#56E0F0", kind: "Payment provider" },
};
