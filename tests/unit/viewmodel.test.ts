import { describe, expect, it } from "vitest";
import { INITIAL_VIEW_MODEL, reduceEvents, type MissionEvent } from "@/domain/viewmodel/reducer";

let seq = 0;
const ev = (eventType: string, actor: string, metadata: Record<string, unknown> = {}, outcome = "SUCCESS"): MissionEvent => ({
  seq: ++seq,
  actor,
  eventType,
  outcome,
  metadata,
  schemaVersion: 1,
  mode: "DEMO",
  createdAt: new Date(2026, 9, 13, 12, 0, seq).toISOString(),
});

const stream: MissionEvent[] = [
  ev("mission.created", "user:u"),
  ev("mission.parsed", "agent:mission-interpreter(deterministic)", { to: "PARSED" }),
  ev("mission.confirmed", "user:u", { to: "CONFIRMED" }),
  ev("agent.step_started", "agent:scout", { step: "SCOUT", to: "SCOUTING" }, "INFO"),
  ev("agent.step_completed", "agent:scout", { step: "SCOUT", to: "SCOUTED", candidates: 5 }),
  ev("agent.step_started", "agent:risk", { step: "RISK", to: "RISK_ANALYSIS" }, "INFO"),
  ev("agent.step_completed", "agent:risk", { step: "RISK", to: "OPTIMIZING" }),
  ev("agent.step_completed", "agent:optimizer", { step: "OPTIMIZE", to: "POLICY_EVALUATION" }),
  ev("policy.evaluated", "agent:policy-guard", { step: "POLICY", to: "AWAITING_APPROVAL", decision: "REQUIRE_APPROVAL" }),
  ev("approval.granted", "user:u", { to: "READY_FOR_CHECKOUT" }),
  ev("payment.initiated", "user:u", { simulated: true }),
  ev("payment.order_created", "user:u", { to: "ORDER_CREATED", simulated: true }),
  ev("payment.capture_started", "user:u", { to: "CAPTURE_PENDING", simulated: true }, "INFO"),
  ev("payment.captured", "provider:simulated", { to: "CAPTURED", simulated: true }),
  ev("mission.completed", "system:payments", { to: "COMPLETED" }),
];

describe("one reducer for live and replay", () => {
  it("is pure: same events → same view model", () => {
    expect(reduceEvents(stream)).toEqual(reduceEvents(stream));
    expect(reduceEvents([])).toEqual(INITIAL_VIEW_MODEL);
  });

  it("derives scene states only from recorded events", () => {
    const at = (n: number) => reduceEvents(stream, stream[n - 1].seq);
    expect(at(4).scene).toBe("DISCOVERY");
    expect(at(4).activeNode).toBe("scout");
    expect(at(5).candidates).toBe(5);
    expect(at(9)).toMatchObject({ scene: "APPROVAL_REQUIRED", decision: "REQUIRE_APPROVAL" });
    expect(at(9).steps).toEqual({ SCOUT: "done", RISK: "done", OPTIMIZE: "done", POLICY: "done" });
    expect(at(12)).toMatchObject({ scene: "CHECKOUT", simulated: true, activeNode: "paypal" });
    expect(reduceEvents(stream)).toMatchObject({ scene: "CAPTURED", paymentStatus: "CAPTURED", workflowStatus: "COMPLETED", eventCount: 15 });
  });

  it("replay prefix equals the live state at that moment", () => {
    for (let i = 1; i <= stream.length; i++) {
      expect(reduceEvents(stream, stream[i - 1].seq)).toEqual(reduceEvents(stream.slice(0, i)));
    }
  });

  it("labels simulated capture honestly", () => {
    const vm = reduceEvents(stream);
    expect(vm.timeline.find((t) => t.eventType === "payment.captured")?.label).toMatch(/SIMULATED.*no money moved/);
  });

  it("blocked policy outcome maps to BLOCKED", () => {
    const blocked = [ev("policy.evaluated", "agent:policy-guard", { to: "BLOCKED", decision: "BLOCK" }, "BLOCKED")];
    expect(reduceEvents(blocked).scene).toBe("BLOCKED");
  });
});
