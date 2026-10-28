"use client";
import { useState } from "react";
import { Ban, ShieldCheck } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { formatTime } from "@/lib/client/format";
import { cn } from "@/lib/client/cn";
import { ItemizedTotal, RiskSummary } from "./purchase-summary";
import type { ApprovalDTO, MissionDTO, MissionProductDTO } from "./types";

interface PolicyResp {
  current: { version: number; configuration: { approvalTtlMinutes: number } };
}

/**
 * Deliberate human approval. Shows the exact purchase the server will bind the approval to
 * (snapshot fields), then calls the existing approve/deny routes. The server re-computes and
 * re-checks everything; nothing here can approve on an agent's recommendation alone.
 */
export function ApprovalPanel({
  mission,
  recommended,
  approvals,
  isApprover,
  onChange,
  compact = false,
}: {
  mission: MissionDTO;
  recommended: MissionProductDTO | null;
  approvals: ApprovalDTO[];
  isApprover: boolean;
  onChange: () => void;
  compact?: boolean;
}) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const { data: policy } = useApi<PolicyResp>("/api/policies");
  const active = approvals.find((a) => a.status === "ACTIVE" && new Date(a.expiresAt) > new Date());
  const needsApprover = mission.status === "AWAITING_APPROVAL";
  const canDecide = (mission.status === "AWAITING_APPROVAL" || mission.status === "READY_FOR_CHECKOUT") && !active && recommended && recommended.totalMinor != null;
  const currency = mission.currency ?? recommended?.product.currency ?? "USD";
  const nonPass = recommended?.policyResult?.checks.filter((c) => c.result !== "PASS") ?? [];

  const act = async (kind: "approve" | "deny") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "approve") {
        await apiFetch(`/api/missions/${mission.id}/approve`, { method: "POST", body: { productId: recommended!.productId, expectedTotalMinor: recommended!.totalMinor, acknowledge: true } });
      } else {
        await apiFetch(`/api/missions/${mission.id}/deny`, { method: "POST", body: { reason: "Rejected by operator" } });
      }
      setAck(false);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Action failed", null, null));
    } finally {
      setBusy(null);
    }
  };

  const snapshot: [string, string][] = recommended
    ? [
        ["Product", recommended.product.providerProductId],
        ["Seller", recommended.product.sellerId ?? recommended.product.sellerName ?? "undisclosed"],
        ["Quantity", String(recommended.quantity)],
        ["Unit price", formatMoney(recommended.product.unitPriceMinor, recommended.product.currency)],
        ["Amount basis", recommended.amountBasis === "CAP" ? "SPENDING CAP (authorization hold)" : "EXACT (capture)"],
        ["Amount", formatMoney(recommended.totalMinor, currency)],
        ["Currency", currency],
        ["Policy", `v${mission.policyVersion ?? "—"}`],
      ]
    : [];

  return (
    <div data-demo-target="approval-panel" className="space-y-4">
      {canDecide && recommended && (
        <div className={cn("rounded-[4px] border border-warning/30 bg-warning/[0.04]", compact ? "p-3" : "p-4")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{needsApprover ? "Approver sign-off required" : "Owner authorisation required"}</p>
              <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">
                {needsApprover
                  ? "Policy requires a user with the APPROVER role to approve this exact purchase."
                  : "Policy allows checkout, but a human must still authorise the exact purchase before any order is created."}
              </p>
            </div>
            <StatusBadge status={mission.decision} />
          </div>

          <div className={cn("mt-4 grid gap-4", compact ? "" : "lg:grid-cols-2")}>
            <div>
              <p className="tech-label mb-2">You are approving</p>
              <p className="text-[13px] leading-snug">{recommended.product.title}</p>
              <p className="mt-0.5 text-[11px] text-faint">{recommended.product.sellerName ?? "undisclosed seller"}</p>
              <ItemizedTotal mp={recommended} currency={currency} className="mt-3" />
            </div>
            {!compact && (
              <div className="space-y-4">
                <RiskSummary mp={recommended} limit={3} />
                {nonPass.length > 0 && (
                  <div>
                    <p className="tech-label mb-1.5">Why a human is needed</p>
                    <ul className="space-y-1">
                      {nonPass.slice(0, 4).map((c) => (
                        <li key={c.id} className="flex gap-2 text-[11px] leading-relaxed text-muted">
                          <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", c.result === "BLOCK" ? "bg-critical" : "bg-warning")} aria-hidden />
                          {c.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {!compact && (
            <details className="mt-4 rounded-[4px] border border-line bg-bg/40">
              <summary className="cursor-pointer px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted hover:text-fg">Exact snapshot to be signed</summary>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-3 pb-3 text-[11px]">
                {snapshot.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-faint">{k}</dt>
                    <dd className="truncate font-mono text-fg/85">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-faint">The server hashes these fields with the expiry. Any change to product, price, quantity, amounts, currency or policy version invalidates the approval.</p>
            </details>
          )}

          <p className="mt-3 text-[11px] text-muted">
            Expires <span className="font-mono text-fg/85">{policy ? `${policy.current.configuration.approvalTtlMinutes} min` : "per policy"}</span> after approval
            {recommended.amountBasis === "CAP" ? "; the final amount is settled later and can never exceed the cap." : "."}
          </p>

          <label className="mt-3 flex items-start gap-2 text-xs">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#6FE3EE]" />
            <span>I reviewed this exact purchase. The approval binds to these details (snapshot hash) and expires; any change invalidates it.</span>
          </label>
          {needsApprover && !isApprover && <p className="mt-2 text-xs text-warning">Your demo identity does not hold the APPROVER role. Enable it from the identity menu to approve.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="success" onClick={() => act("approve")} loading={busy === "approve"} disabled={!ack || (needsApprover && !isApprover) || busy !== null}>
              <ShieldCheck className="h-4 w-4" aria-hidden /> Approve this purchase
            </Button>
            <Button variant="danger" onClick={() => act("deny")} loading={busy === "deny"} disabled={busy !== null}>
              <Ban className="h-4 w-4" aria-hidden /> Reject mission
            </Button>
          </div>
        </div>
      )}
      <ErrorState error={error} />
      {active && (
        <p className="flex items-center gap-2 text-xs text-success">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Approved {formatMoney(active.approvedAmountMinor, active.currency)} · expires {formatTime(active.expiresAt)}
        </p>
      )}
      {(!compact || !canDecide) && (
        <div>
          <h3 className="tech-label mb-2">Approval history</h3>
          {approvals.length === 0 ? (
            <p className="text-xs text-muted">No approvals recorded.</p>
          ) : (
            <ul className="space-y-2">
              {approvals.slice(0, compact ? 1 : undefined).map((a) => (
                <li key={a.id} className="rounded-[4px] border border-line p-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      <span>{a.kind === "APPROVER_APPROVAL" ? "Approver approval" : "Owner authorisation"}</span>
                    </span>
                    <span className="font-mono">{formatMoney(a.approvedAmountMinor, a.currency)}</span>
                  </div>
                  <div className="mt-1 text-faint">
                    by {a.approvedBy.displayName} · policy v{a.policyVersion} · {formatTime(a.createdAt)} · expires {formatTime(a.expiresAt)}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-faint" title={a.snapshotHash}>
                    snapshot {a.snapshotHash.slice(0, 16)}…
                  </div>
                  {a.statusReason && <div className="mt-0.5 text-muted">{a.statusReason}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
