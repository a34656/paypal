import { apiRoute } from "@/server/api";
import { deriveDisplayStatus } from "@/domain/state/machines";

const MODES = ["DEMO", "SANDBOX", "LIVE"] as const;

/** All figures are grouped by mode; DEMO (simulated) and SANDBOX volume are never blended. */
export const GET = apiRoute(async ({ user, db }) => {
  const missions = await db.mission.findMany({
    where: { ownerId: user.id },
    include: { payments: true, approvals: true, products: { include: { product: true } }, agentRuns: true },
  });
  const byMode = Object.fromEntries(
    MODES.map((mode) => {
      const ms = missions.filter((m) => m.mode === mode);
      const outcomes: Record<string, number> = {};
      let proposedMinor = 0;
      let approvedMinor = 0;
      let capturedMinor = 0;
      let blocked = 0;
      let pendingApprovals = 0;
      const spendByCategory: Record<string, number> = {};
      for (const m of ms) {
        const live = m.payments.find((p) => !["FAILED", "CANCELLED", "BLOCKED", "EXPIRED"].includes(p.status)) ?? null;
        const ds = deriveDisplayStatus(m.status, live?.status ?? null);
        outcomes[ds] = (outcomes[ds] ?? 0) + 1;
        if (ds === "BLOCKED") blocked += 1;
        if (ds === "AWAITING_APPROVAL") pendingApprovals += 1;
        const rec = m.products.find((p) => p.productId === m.recommendedProductId);
        if (rec?.totalMinor) proposedMinor += rec.totalMinor;
        for (const a of m.approvals) if (a.status === "ACTIVE" || a.status === "CONSUMED") approvedMinor += a.approvedAmountMinor;
        for (const p of m.payments) {
          if (p.status === "CAPTURED") {
            capturedMinor += p.amountMinor;
            const cat = m.products.find((x) => x.productId === p.productId)?.product.category ?? "unknown";
            spendByCategory[cat] = (spendByCategory[cat] ?? 0) + p.amountMinor;
          }
        }
      }
      return [mode, { missions: ms.length, outcomes, proposedMinor, approvedMinor, capturedMinor, blocked, pendingApprovals, spendByCategory }];
    }),
  );
  const riskDistribution: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const m of missions) for (const p of m.products) if (p.riskLevel) riskDistribution[p.riskLevel] = (riskDistribution[p.riskLevel] ?? 0) + 1;
  const agentActivity: Record<string, { completed: number; failed: number; running: number }> = {};
  for (const m of missions)
    for (const r of m.agentRuns) {
      const a = (agentActivity[r.agentType] ??= { completed: 0, failed: 0, running: 0 });
      if (r.status === "COMPLETED") a.completed += 1;
      else if (r.status === "FAILED") a.failed += 1;
      else a.running += 1;
    }
  return {
    currency: "USD",
    byMode,
    riskDistribution,
    agentActivity,
    sources: {
      outcomes: "recorded events",
      spend: "DEMO = simulated (no money moved); SANDBOX = PayPal Sandbox test money; LIVE never enabled by default",
      risk: "deterministic risk engine over demo evidence",
    },
  };
});
