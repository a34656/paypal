"use client";
import { useState } from "react";
import { Ban, ShieldCheck } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import { formatTime } from "@/lib/client/format";
import type { ApprovalDTO, MissionDTO, MissionProductDTO } from "./types";

export function ApprovalPanel({ mission, recommended, approvals, isApprover, onChange }: { mission: MissionDTO; recommended: MissionProductDTO | null; approvals: ApprovalDTO[]; isApprover: boolean; onChange: () => void }) {
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const active = approvals.find((a) => a.status === "ACTIVE" && new Date(a.expiresAt) > new Date());
  const needsApprover = mission.status === "AWAITING_APPROVAL";
  const canDecide = (mission.status === "AWAITING_APPROVAL" || mission.status === "READY_FOR_CHECKOUT") && !active && recommended && recommended.totalMinor != null;

  const act = async (kind: "approve" | "deny") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "approve") {
        await apiFetch(`/api/missions/${mission.id}/approve`, { method: "POST", body: { productId: recommended!.productId, expectedTotalMinor: recommended!.totalMinor, acknowledge: true } });
      } else {
        await apiFetch(`/api/missions/${mission.id}/deny`, { method: "POST", body: { reason: "Denied by operator" } });
      }
      setAck(false);
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Action failed", null, null));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {canDecide && recommended && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-sm font-medium">{needsApprover ? "Approver sign-off required" : "Owner authorisation required"}</p>
          <p className="mt-1 text-xs text-muted">
            {needsApprover
              ? "Policy requires a user with the APPROVER role to approve this exact purchase."
              : "Policy allows checkout, but a human must still authorise the exact purchase before any order is created."}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Item</dt>
            <dd>{recommended.product.title}</dd>
            <dt className="text-muted">Seller</dt>
            <dd>{recommended.product.sellerName ?? "undisclosed"}</dd>
            <dt className="text-muted">Quantity</dt>
            <dd className="font-mono">{recommended.quantity}</dd>
            <dt className="text-muted">All-in total</dt>
            <dd className="font-mono text-base text-fg">{formatMoney(recommended.totalMinor, recommended.product.currency)}</dd>
            <dt className="text-muted">Policy version</dt>
            <dd className="font-mono">v{mission.policyVersion}</dd>
          </dl>
          <label className="mt-3 flex items-start gap-2 text-xs">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#56E0F0]" />
            <span>I reviewed this exact purchase. The approval binds to these details (snapshot hash) and expires; any change invalidates it.</span>
          </label>
          {needsApprover && !isApprover && <p className="mt-2 text-xs text-warning">Your demo identity does not hold the APPROVER role. Enable it from the identity menu to approve.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="success" onClick={() => act("approve")} loading={busy === "approve"} disabled={!ack || (needsApprover && !isApprover) || busy !== null}>
              <ShieldCheck className="h-4 w-4" aria-hidden /> {needsApprover ? "Approve exact purchase" : "Authorise purchase"}
            </Button>
            <Button variant="danger" onClick={() => act("deny")} loading={busy === "deny"} disabled={busy !== null}>
              <Ban className="h-4 w-4" aria-hidden /> Deny
            </Button>
          </div>
        </div>
      )}
      <ErrorState error={error} />
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Approval history</h3>
        {approvals.length === 0 ? (
          <p className="text-xs text-muted">No approvals recorded.</p>
        ) : (
          <ul className="space-y-2">
            {approvals.map((a) => (
              <li key={a.id} className="rounded border border-line p-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <StatusBadge status={a.status} />
                    <span>{a.kind === "APPROVER_APPROVAL" ? "Approver approval" : "Owner authorisation"}</span>
                  </span>
                  <span className="font-mono">{formatMoney(a.approvedAmountMinor, a.currency)}</span>
                </div>
                <div className="mt-1 text-muted">
                  by {a.approvedBy.displayName} · policy v{a.policyVersion} · {formatTime(a.createdAt)} · expires {formatTime(a.expiresAt)}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted" title={a.snapshotHash}>
                  snapshot {a.snapshotHash.slice(0, 16)}…
                </div>
                {a.statusReason && <div className="mt-0.5 text-muted">{a.statusReason}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
