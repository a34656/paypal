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

describe("authorization holds, settlement and refunds", () => {
  it("track the hold through settlement and refunds; PayPal lights only once a payment exists", async () => {
    const { nodeState } = await import("@/components/three/node-meta");
    const base = stream.slice(0, 10); // up to approval.granted
    const beforePay = reduceEvents(base);
    expect(nodeState("paypal", beforePay)).toBe("idle");
    expect(nodeState("policy", beforePay)).toBe("warning");
    const s2 = [
      ...base,
      ev("payment.authorize_started", "user:u", { to: "AUTHORIZE_PENDING", simulated: false }, "INFO"),
      ev("payment.authorized", "provider:paypal", { to: "AUTHORIZED", simulated: false }),
      ev("payment.settle_started", "user:u", { to: "SETTLE_PENDING" }, "INFO"),
      ev("payment.captured", "provider:paypal", { to: "CAPTURED", simulated: false }),
      ev("payment.partially_refunded", "provider:paypal", { to: "PARTIALLY_REFUNDED" }),
    ];
    const held = reduceEvents(s2.slice(0, 12));
    expect(held).toMatchObject({ paymentStatus: "AUTHORIZED", scene: "CHECKOUT" });
    expect(held.lastEvent?.label).toBe("Authorization hold placed by PayPal");
    expect(nodeState("paypal", held)).toBe("active");
    const refunded = reduceEvents(s2);
    expect(refunded.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(nodeState("paypal", refunded)).toBe("success");
  });

  it("a released hold or failed authorization never looks successful", async () => {
    const { nodeState } = await import("@/components/three/node-meta");
    const base = stream.slice(0, 10);
    const released = reduceEvents([...base, ev("payment.authorized", "provider:paypal", { to: "AUTHORIZED" }), ev("payment.hold_released", "user:u", { to: "CANCELLED" }, "INFO")]);
    expect(released).toMatchObject({ paymentStatus: "CANCELLED", scene: "BLOCKED" });
    expect(nodeState("paypal", released)).toBe("blocked");
    const failed = reduceEvents([...base, ev("payment.authorize_failed", "provider:paypal", { to: "FAILED" }, "FAILURE")]);
    expect(failed.scene).toBe("FAILED");
  });

  it("node states follow recorded steps only", async () => {
    const { nodeState } = await import("@/components/three/node-meta");
    expect(nodeState("scout", null)).toBe("idle");
    expect(nodeState("scout", reduceEvents(stream.slice(0, 4)))).toBe("active");
    expect(nodeState("risk", reduceEvents(stream.slice(0, 4)))).toBe("idle");
    const failed = reduceEvents([...stream.slice(0, 4), ev("agent.step_failed", "agent:scout", { step: "SCOUT" }, "FAILURE")]);
    expect(nodeState("scout", failed)).toBe("blocked");
  });
});
