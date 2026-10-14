import { apiRoute } from "@/server/api";
import { deriveDisplayStatus } from "@/domain/state/machines";

const MODES = ["DEMO", "SANDBOX", "LIVE"] as const;

/** Mission budget distribution buckets (USD minor units). */
const BUCKETS = [
  { label: "≤ $100", maxMinor: 10_000 },
  { label: "$100–500", maxMinor: 50_000 },
  { label: "$500–1k", maxMinor: 100_000 },
  { label: "$1k–2.5k", maxMinor: 250_000 },
  { label: "$2.5k–5k", maxMinor: 500_000 },
  { label: "> $5k", maxMinor: Number.MAX_SAFE_INTEGER },
];

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
      let budgetMinor = 0;
      let heldMinor = 0;
      let refundedMinor = 0;
      const spendByCategory: Record<string, number> = {};
      const paymentStatus: Record<string, number> = {};
      const budgetBuckets: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b.label, 0]));
      for (const m of ms) {
        const live = m.payments.find((p) => !["FAILED", "CANCELLED", "BLOCKED", "EXPIRED"].includes(p.status)) ?? null;
        const ds = deriveDisplayStatus(m.status, live?.status ?? null);
        outcomes[ds] = (outcomes[ds] ?? 0) + 1;
        if (ds === "BLOCKED") blocked += 1;
        if (ds === "AWAITING_APPROVAL") pendingApprovals += 1;
        if (m.budgetMinor != null && (m.currency ?? "USD") === "USD") {
          budgetMinor += m.budgetMinor;
          const b = BUCKETS.find((x) => m.budgetMinor! <= x.maxMinor) ?? BUCKETS[BUCKETS.length - 1];
          budgetBuckets[b.label] += 1;
        }
        const rec = m.products.find((p) => p.productId === m.recommendedProductId);
        if (rec?.totalMinor) proposedMinor += rec.totalMinor;
        for (const a of m.approvals) if (a.status === "ACTIVE" || a.status === "CONSUMED") approvedMinor += a.approvedAmountMinor;
        for (const p of m.payments) {
          paymentStatus[p.status] = (paymentStatus[p.status] ?? 0) + 1;
          if (p.status === "AUTHORIZED" || p.status === "SETTLE_PENDING") heldMinor += p.amountMinor;
          if (["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"].includes(p.status)) {
            // Settled holds capture the human-entered amount, not the cap.
            const captured = p.settledMinor ?? p.amountMinor;
            capturedMinor += captured;
            refundedMinor += p.refundedMinor;
            const cat = m.products.find((x) => x.productId === p.productId)?.product.category ?? "unknown";
            spendByCategory[cat] = (spendByCategory[cat] ?? 0) + captured;
          }
        }
      }
      return [mode, { missions: ms.length, outcomes, proposedMinor, approvedMinor, capturedMinor, heldMinor, refundedMinor, budgetMinor, budgetBuckets, paymentStatus, blocked, pendingApprovals, spendByCategory }];
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
      risk: "deterministic risk engine over provider evidence (Channel3 live listings and labelled demo data)",
      budget: "confirmed mission budgets (USD missions only)",
      paymentStatus: "Payment records by current status",
    },
  };
});
