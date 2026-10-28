import { apiRoute } from "@/server/api";
import { latestPolicy } from "@/server/policies";
import { assessRisk } from "@/domain/risk/engine";
import { optimize } from "@/domain/agents/optimizer";
import { evaluate } from "@/domain/policy/engine";
import { snapshotFor } from "@/domain/policy/snapshot";
import { safePurchaseAmounts } from "@/domain/pricing";
import { WALKTHROUGH_MISSION, WALKTHROUGH_OFFERS } from "@/domain/demo/walkthrough-scenario";

/**
 * Walkthrough presentation mode. Runs the same risk → optimizer → policy pipeline as the orchestrator
 * (src/server/orchestrator.ts) over the fixed fictional offers, against the caller's active policy.
 * Read-only: nothing is persisted, no audit event is written, no provider is called, and the client
 * cannot supply its own offers. Duplicate detection is reported as not applicable (no purchase history
 * exists for fictional offers).
 */
export const GET = apiRoute(async ({ user, db }) => {
  const { row, config } = await latestPolicy(db, user.id);
  const c = WALKTHROUGH_MISSION;

  const offers = WALKTHROUGH_OFFERS.map((product) => {
    const amounts = safePurchaseAmounts(product, c.quantity, config.costAllowancePct);
    const risk = assessRisk(product, c, { costBounded: amounts?.basis === "CAP" });
    return { product, amounts, risk };
  });

  const ranking = optimize(
    offers.map(({ product, amounts, risk }) => ({
      key: product.providerProductId,
      title: product.title,
      totalMinor: amounts?.totalMinor ?? null,
      currency: product.currency,
      category: product.category,
      sellerVerified: product.sellerVerificationStatus === "VERIFIED",
      risk,
      amountBasis: amounts?.basis === "CAP" ? "CAP" : "EXACT",
    })),
    c,
    config,
  );

  let recommendedKey: string | null = null;
  let bestRank = Infinity;
  const evaluated = offers.map(({ product, amounts, risk }) => {
    const opt = ranking.find((r) => r.key === product.providerProductId)!;
    const policy = evaluate(
      snapshotFor(c, product, {
        totalMinor: amounts?.totalMinor ?? null,
        amountBasis: amounts?.basis ?? null,
        allowanceMinor: amounts ? amounts.allowanceMinor : null,
        riskScore: risk.riskScore,
        evidenceCoverage: risk.evidenceCoverage,
        riskEvidence: risk,
      }),
      config,
      { duplicateDetected: false },
    );
    // Same selection rule as stepPolicy: best-ranked eligible offer that policy does not block.
    if (opt.eligible && policy.decision !== "BLOCK" && opt.rank != null && opt.rank < bestRank) {
      bestRank = opt.rank;
      recommendedKey = product.providerProductId;
    }
    return {
      key: product.providerProductId,
      title: product.title,
      description: product.description,
      seller: product.sellerName,
      sellerVerification: product.sellerVerificationStatus,
      unitPriceMinor: product.unitPriceMinor,
      shippingMinor: product.shippingMinor,
      taxMinor: product.taxMinor,
      shippingEstimateDays: product.shippingEstimateDays,
      amounts,
      risk: {
        score: risk.riskScore,
        level: risk.level,
        evidenceCoverage: risk.evidenceCoverage,
        reasons: risk.reasons,
        missing: risk.missingInformation,
        injectionSignals: risk.injectionSignals ?? [],
        factors: risk.factors.map((f) => ({ id: f.id, label: f.label, status: f.status, evidence: f.evidence, contribution: f.contribution, max: f.max })),
      },
      optimizer: { eligible: opt.eligible, ineligibleReasons: opt.ineligibleReasons, rank: opt.rank, score: opt.score, explanation: opt.explanation },
      policy: { decision: policy.decision, reasons: policy.reasons, checks: policy.checks },
    };
  });

  const recommended = evaluated.find((o) => o.key === recommendedKey) ?? null;
  return {
    fictional: true,
    persisted: false,
    mission: c,
    policy: {
      version: row.version,
      maxAutoPurchaseMinor: config.maxAutoPurchaseMinor,
      approvalThresholdMinor: config.approvalThresholdMinor,
      maxPurchaseMinor: config.maxPurchaseMinor,
      approvalTtlMinutes: config.approvalTtlMinutes,
    },
    offers: evaluated,
    recommendedKey,
    decision: recommended ? recommended.policy.decision : "BLOCK",
  };
});
