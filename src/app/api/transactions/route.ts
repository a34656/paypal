import { apiRoute } from "@/server/api";

/** Payments (DEMO = simulated, SANDBOX = PayPal Sandbox) plus policy proposals that never reached payment. */
export const GET = apiRoute(async ({ user, db }) => {
  const missions = await db.mission.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      payments: { orderBy: { createdAt: "desc" } },
      products: { include: { product: true } },
    },
  });
  const rows: Array<Record<string, unknown>> = [];
  for (const m of missions) {
    const rec = m.products.find((p) => p.productId === m.recommendedProductId) ?? null;
    for (const p of m.payments) {
      const mp = m.products.find((x) => x.productId === p.productId);
      rows.push({
        id: p.id,
        kind: "PAYMENT",
        missionId: m.id,
        missionTitle: m.title,
        product: mp?.product.title ?? null,
        seller: mp?.product.sellerName ?? null,
        category: mp?.product.category ?? null,
        amountMinor: p.amountMinor,
        currency: p.currency,
        status: p.status,
        decision: m.decision,
        riskScore: mp?.riskScore ?? null,
        mode: p.mode,
        provider: p.provider,
        providerOrderId: p.providerOrderId,
        providerCaptureId: p.providerCaptureId,
        simulated: p.provider === "simulated",
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      });
    }
    if (m.payments.length === 0 && m.decision) {
      rows.push({
        id: `proposal-${m.id}`,
        kind: "PROPOSAL",
        missionId: m.id,
        missionTitle: m.title,
        product: rec?.product.title ?? null,
        seller: rec?.product.sellerName ?? null,
        category: rec?.product.category ?? null,
        amountMinor: rec?.totalMinor ?? null,
        currency: m.currency,
        status: m.status,
        decision: m.decision,
        riskScore: rec?.riskScore ?? null,
        mode: m.mode,
        provider: null,
        providerOrderId: null,
        providerCaptureId: null,
        simulated: m.mode === "DEMO",
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      });
    }
  }
  return { rows };
});
