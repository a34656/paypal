import type { MissionViewModel } from "@/domain/viewmodel/reducer";
import type { AgentNode } from "./node-meta";

/** Short status line under each agent, from recorded state only. */
export function statusText(id: AgentNode, vm: MissionViewModel | null): string | null {
  if (!vm) return null;
  const step = (s: string) => (s === "pending" ? null : s === "running" ? "RUNNING" : s === "done" ? "DONE" : "FAILED");
  switch (id) {
    case "scout":
      return vm.steps.SCOUT === "done" && vm.candidates != null ? `${vm.candidates} FOUND` : step(vm.steps.SCOUT);
    case "risk":
      return step(vm.steps.RISK);
    case "optimizer":
      return step(vm.steps.OPTIMIZE);
    case "policy":
      return vm.decision === "BLOCK" ? "BLOCKED" : vm.decision === "REQUIRE_APPROVAL" ? "APPROVAL REQUIRED" : vm.decision === "ALLOW_CHECKOUT" ? "ALLOWED" : step(vm.steps.POLICY);
    case "paypal":
      return vm.paymentStatus ? vm.paymentStatus.replace(/_/g, " ") : null;
  }
}
