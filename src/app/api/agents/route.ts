import { apiRoute } from "@/server/api";

const AGENTS = [
  { id: "mission-interpreter", name: "Mission Interpreter", step: null, description: "Turns free text into a structured mission PROPOSAL the user must confirm.", capabilities: ["Parse budget, quantity, currency, deadline, attributes"], tools: ["LLM (if configured, no tools) or deterministic parser"] },
  { id: "scout", name: "Scout", step: "SCOUT", description: "Searches the configured product provider and normalises prices and currencies.", capabilities: ["ProductSearch.search()", "Validate & normalise candidates"], tools: ["ProductSearch interface (demo provider)"] },
  { id: "risk", name: "Risk", step: "RISK", description: "Deterministic risk scoring. Missing evidence is scored as worst case.", capabilities: ["assessRisk(product, mission)"], tools: ["None (pure function)"] },
  { id: "optimizer", name: "Optimizer", step: "OPTIMIZE", description: "Ranks only eligible offers using policy-versioned weights.", capabilities: ["optimize(candidates, mission, policy)"], tools: ["None (pure function)"] },
  { id: "policy-guard", name: "Policy Guard", step: "POLICY", description: "Authoritative: calls the pure policy engine and records the decision.", capabilities: ["evaluate(snapshot, policy, context)"], tools: ["None (pure function)"] },
];

export const GET = apiRoute(async ({ user, db }) => {
  const runs = await db.agentRun.findMany({ where: { mission: { ownerId: user.id } }, orderBy: { startedAt: "desc" }, take: 500 });
  const events = await db.auditEvent.findMany({ where: { ownerId: user.id, actor: { startsWith: "agent:" } }, orderBy: { seq: "desc" }, take: 100 });
  return {
    notice: "Bounded agent workflow: these are orchestrated functions, not autonomous agents. None has shell, filesystem, network (beyond its provider adapter) or payment access.",
    agents: AGENTS.map((a) => {
      const mine = runs.filter((r) => r.agentType === a.id);
      const evs = events.filter((e) => e.actor.startsWith(`agent:${a.id}`));
      return {
        ...a,
        permissions: { shell: false, filesystem: false, network: a.id === "scout" ? "provider adapter only" : a.id === "mission-interpreter" ? "LLM API only (if configured)" : false, payments: false, policyWrite: false, approvals: false },
        tasksCompleted: a.id === "mission-interpreter" ? evs.filter((e) => e.eventType === "mission.parsed").length : mine.filter((r) => r.status === "COMPLETED").length,
        failures: mine.filter((r) => r.status === "FAILED").length,
        status: mine.some((r) => r.status === "RUNNING" && r.lockedUntil && r.lockedUntil > new Date()) ? "RUNNING" : "IDLE",
        lastActivity: evs[0]?.createdAt ?? mine[0]?.startedAt ?? null,
        recentEvents: evs.slice(0, 5).map((e) => ({ seq: e.seq, eventType: e.eventType, outcome: e.outcome, missionId: e.missionId, createdAt: e.createdAt })),
      };
    }),
  };
});
