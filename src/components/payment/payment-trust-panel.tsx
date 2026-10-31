"use client";

import { useState } from "react";
import { AlertTriangle, Ban, ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/client/cn";
import { HoverCard, HoverCardRow } from "@/components/ui/hover-card";
import { formatMoney } from "@/lib/money";
import { PolicyCheckItem } from "./policy-check-item";
import type { MissionProductDTO, MissionDTO } from "@/components/mission/types";

interface TrustScoreCardProps {
  trustScore: number | null;
  riskScore: number | null;
  riskLevel: string | null;
  evidenceCoverage: number | null;
  product: MissionProductDTO;
}

function TrustScoreCard({ trustScore, riskScore, riskLevel, evidenceCoverage, product }: TrustScoreCardProps) {
  const p = product.product;

  return (
    <div className="grid grid-cols-3 gap-3">
      <HoverCard
        trigger={
          <button className="group rounded-[4px] border border-line bg-elevated/40 p-3 text-left transition-colors hover:border-line-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan/50">
            <p className="tech-label">Trust Score</p>
            <p className={cn("mt-1.5 font-mono text-2xl font-light tabular-nums leading-none", riskLevel === "LOW" ? "text-success" : riskLevel === "MEDIUM" ? "text-warning" : "text-critical")}>
              {trustScore ?? "—"}
              <span className="text-sm text-faint">/100</span>
            </p>
          </button>
        }
        side="bottom"
      >
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Trust Details</p>
        <HoverCardRow label="Trust score" value={trustScore ?? "—"} tone={riskLevel === "LOW" ? "success" : "warning"} />
        <HoverCardRow label="Risk level" value={riskLevel ?? "—"} tone={riskLevel === "LOW" ? "success" : riskLevel === "MEDIUM" ? "warning" : "critical"} />
        <HoverCardRow label="Seller" value={p.sellerName ?? "Unknown"} />
        <HoverCardRow label="Verification" value={p.sellerVerificationStatus} tone={p.sellerVerificationStatus === "VERIFIED" ? "success" : "warning"} />
        {p.metadata?.sellerTrustBasis && (
          <p className="mt-1.5 text-[10px] text-muted">{p.metadata.sellerTrustBasis}</p>
        )}
      </HoverCard>

      <HoverCard
        trigger={
          <button className="group rounded-[4px] border border-line bg-elevated/40 p-3 text-left transition-colors hover:border-line-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan/50">
            <p className="tech-label">Risk Score</p>
            <p className={cn("mt-1.5 font-mono text-2xl font-light tabular-nums leading-none", riskLevel === "LOW" ? "text-success" : riskLevel === "MEDIUM" ? "text-warning" : "text-critical")}>
              {riskScore ?? "—"}
              <span className="text-sm text-faint">/100</span>
            </p>
          </button>
        }
        side="bottom"
      >
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Risk Factors</p>
        {product.riskEvidence?.reasons.slice(0, 4).map((r, i) => (
          <p key={i} className="py-0.5 text-[11px] text-muted">· {r}</p>
        )) ?? <p className="text-[11px] text-muted">No risk data available.</p>}
        {product.riskEvidence?.recommendedAction && (
          <p className="mt-1.5 text-[10px] text-cyan">{product.riskEvidence.recommendedAction}</p>
        )}
      </HoverCard>

      <HoverCard
        trigger={
          <button className="group rounded-[4px] border border-line bg-elevated/40 p-3 text-left transition-colors hover:border-line-strong focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan/50">
            <p className="tech-label">Evidence</p>
            <p className={cn("mt-1.5 font-mono text-2xl font-light tabular-nums leading-none", (evidenceCoverage ?? 0) >= 70 ? "text-success" : (evidenceCoverage ?? 0) >= 40 ? "text-warning" : "text-critical")}>
              {evidenceCoverage ?? "—"}
              <span className="text-sm text-faint">%</span>
            </p>
          </button>
        }
        side="bottom"
      >
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Evidence Coverage</p>
        <HoverCardRow label="Coverage" value={`${evidenceCoverage ?? "—"}%`} tone={(evidenceCoverage ?? 0) >= 70 ? "success" : "warning"} />
        {product.riskEvidence?.missingInformation.slice(0, 3).map((m, i) => (
          <p key={i} className="py-0.5 text-[11px] text-warning">Missing: {m}</p>
        ))}
        <p className="mt-1.5 text-[10px] text-muted">{product.riskEvidence?.basis ?? ""}</p>
      </HoverCard>
    </div>
  );
}

interface PaymentTrustPanelProps {
  mission: MissionDTO;
  product: MissionProductDTO;
  className?: string;
}

export function PaymentTrustPanel({ mission, product, className }: PaymentTrustPanelProps) {
  const p = product.product;
  const currency = p.currency ?? mission.currency ?? "USD";
  const policyResult = product.policyResult;
  const checks = policyResult?.checks ?? [];
  const decision = product.policyDecision;

  const budgetMinor = mission.budgetMinor;
  const totalMinor = product.totalMinor;
  const budgetPct = budgetMinor && totalMinor ? Math.round((totalMinor / budgetMinor) * 100) : null;

  const [showAllChecks, setShowAllChecks] = useState(false);
  const attentionChecks = checks.filter((c) => c.result !== "PASS");
  const passedChecks = checks.filter((c) => c.result === "PASS");
  const visibleChecks = showAllChecks
    ? checks
    : [...attentionChecks, ...passedChecks.slice(0, Math.max(2, 3 - attentionChecks.length))];
  const hiddenCount = checks.length - visibleChecks.length;

  return (
    <div className={cn("space-y-5", className)}>
      <div>
        <h2 className="text-base font-semibold text-fg">VANTA Trust Verification</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Your AI agent&apos;s purchase has been evaluated against your organization&apos;s financial and security policies.
        </p>
      </div>

      {/* Overall decision banner */}
      {decision && (
        <div className={cn("flex items-center gap-3 rounded-[6px] border px-4 py-3", {
          "border-success/30 bg-success/[0.06]": decision === "ALLOW_CHECKOUT",
          "border-warning/30 bg-warning/[0.06]": decision === "REQUIRE_APPROVAL",
          "border-critical/30 bg-critical/[0.06]": decision === "BLOCK" || decision === "BLOCKED",
        })}>
          {decision === "ALLOW_CHECKOUT" && <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden />}
          {decision === "REQUIRE_APPROVAL" && <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden />}
          {(decision === "BLOCK" || decision === "BLOCKED") && <Ban className="h-5 w-5 shrink-0 text-critical" aria-hidden />}
          <div>
            <p className={cn("text-sm font-medium", {
              "text-success": decision === "ALLOW_CHECKOUT",
              "text-warning": decision === "REQUIRE_APPROVAL",
              "text-critical": decision === "BLOCK" || decision === "BLOCKED",
            })}>
              {decision === "ALLOW_CHECKOUT" ? "Policy Check Passed" :
               decision === "REQUIRE_APPROVAL" ? "Human Approval Required" : "Purchase Blocked by Policy"}
            </p>
            {policyResult?.reasons?.[0] && (
              <p className="mt-0.5 text-xs text-muted">{policyResult.reasons[0]}</p>
            )}
          </div>
        </div>
      )}

      {/* Scores */}
      <TrustScoreCard
        trustScore={product.trustScore}
        riskScore={product.riskScore}
        riskLevel={product.riskLevel}
        evidenceCoverage={product.evidenceCoverage}
        product={product}
      />

      {/* Seller verification */}
      <div className="rounded-[4px] border border-line bg-elevated/30 p-3 space-y-2">
        <p className="tech-label">Seller Verification</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-fg/90">{p.sellerName ?? "Unknown seller"}</span>
          <HoverCard
            trigger={
              <button
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan/50",
                  p.sellerVerificationStatus === "VERIFIED"
                    ? "border-success/30 text-success bg-success/[0.06]"
                    : "border-warning/30 text-warning bg-warning/[0.06]"
                )}
              >
                {p.sellerVerificationStatus === "VERIFIED" ? <ShieldCheck className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
                {p.sellerVerificationStatus?.replace(/_/g, " ") ?? "Unknown"}
              </button>
            }
            side="left"
          >
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Seller Details</p>
            <HoverCardRow label="Name" value={p.sellerName ?? "—"} />
            <HoverCardRow label="Status" value={p.sellerVerificationStatus} tone={p.sellerVerificationStatus === "VERIFIED" ? "success" : "warning"} />
            {p.metadata?.sellerTrustBasis && (
              <p className="mt-1.5 text-[10px] text-muted">{p.metadata.sellerTrustBasis}</p>
            )}
          </HoverCard>
        </div>
      </div>

      {/* Budget compliance */}
      {budgetMinor != null && (
        <div className="rounded-[4px] border border-line bg-elevated/30 p-3 space-y-2">
          <p className="tech-label">Budget Compliance</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted">Mission budget</span>
              <span className="font-mono tabular-nums text-fg">{formatMoney(budgetMinor, currency)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted">This purchase</span>
              <span className="font-mono tabular-nums text-fg">{totalMinor != null ? formatMoney(totalMinor, currency) : "—"}</span>
            </div>
            {totalMinor != null && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted">Remaining budget</span>
                <span className={cn("font-mono tabular-nums", budgetMinor - totalMinor < 0 ? "text-critical" : "text-success")}>
                  {formatMoney(budgetMinor - totalMinor, currency)}
                </span>
              </div>
            )}
            {budgetPct != null && (
              <div className="pt-1">
                <div className="flex justify-between text-[10px] text-faint mb-1">
                  <span>Budget utilization</span>
                  <span className="font-mono flex items-center">
                    <NumberFlow value={budgetPct} />%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className={cn("h-full rounded-full transition-all", budgetPct > 100 ? "bg-critical" : budgetPct > 80 ? "bg-warning" : "bg-cyan")}
                    style={{ width: `${Math.min(100, budgetPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Policy checks */}
      {checks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="tech-label">
              Policy Checks ({passedChecks.length}/{checks.length} Passed)
            </p>
            <button
              type="button"
              onClick={() => setShowAllChecks((prev) => !prev)}
              className="text-[11px] font-mono text-cyan hover:underline flex items-center gap-1 transition-colors"
            >
              {showAllChecks ? (
                <>
                  <span>Collapse</span>
                  <ChevronUp className="h-3 w-3" aria-hidden />
                </>
              ) : (
                <>
                  <span>Show all {checks.length}</span>
                  <ChevronDown className="h-3 w-3" aria-hidden />
                </>
              )}
            </button>
          </div>
          <div className="space-y-1.5">
            {visibleChecks.map((check) => (
              <PolicyCheckItem key={check.id} check={check} />
            ))}
          </div>
          {!showAllChecks && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllChecks(true)}
              className="w-full rounded-[4px] border border-line/60 bg-elevated/30 py-1.5 text-center font-mono text-[11px] text-muted hover:border-cyan/40 hover:text-cyan transition-colors"
            >
              + {hiddenCount} more verified policy checks (click to expand)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

