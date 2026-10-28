"use client";
import { useState } from "react";
import { ShieldQuestion, Undo2 } from "lucide-react";
import { formatMoney, parseMajorInput } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/states";
import type { OverrideDTO, RecoveryAnalysis } from "./types";

const STATUS_TONE: Record<OverrideDTO["status"], { tone: Tone; label: string }> = {
  PENDING_REVIEW: { tone: "warning", label: "Pending review" },
  APPROVED: { tone: "success", label: "Approved by reviewer" },
  REJECTED: { tone: "critical", label: "Rejected" },
  WITHDRAWN: { tone: "neutral", label: "Withdrawn" },
};

export function OverrideStatus({ status }: { status: OverrideDTO["status"] }) {
  const s = STATUS_TONE[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Request for authorised review of a policy decision. Never enables checkout. */
export function OverridePanel({
  missionId,
  analysis,
  overrides,
  reviewersConfigured,
  onChange,
}: {
  missionId: string;
  analysis: RecoveryAnalysis;
  overrides: OverrideDTO[];
  reviewersConfigured: boolean;
  onChange: () => void;
}) {
  const cur = analysis.summary.currency;
  const o = analysis.override;
  const pending = overrides.find((x) => x.status === "PENDING_REVIEW");
  const [checks, setChecks] = useState<string[]>(() => o.overridable.map((x) => x.checkId).slice(0, 1));
  const [proposedBudget, setProposedBudget] = useState("");
  const [proposedChange, setProposedChange] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  let proposedBudgetMinor: number | undefined;
  let budgetProblem: string | undefined;
  if (proposedBudget.trim()) {
    try {
      proposedBudgetMinor = parseMajorInput(proposedBudget, cur);
    } catch {
      budgetProblem = "Enter an amount like 600.00";
    }
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/missions/${missionId}/overrides`, {
        method: "POST",
        body: { checkIds: checks, justification: justification.trim(), ...(proposedBudgetMinor ? { proposedBudgetMinor } : {}), ...(proposedChange.trim() ? { proposedChange: proposedChange.trim() } : {}) },
      });
      setJustification("");
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Request failed", null, null));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/overrides/${id}/withdraw`, { method: "POST" });
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Withdraw failed", null, null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="override-panel">
      <div className="rounded-md border border-warning/30 bg-warning/[0.05] p-3 text-xs leading-relaxed text-fg/85">
        <p className="flex items-center gap-2 font-medium text-warning">
          <ShieldQuestion className="h-4 w-4" aria-hidden /> A request for review — not an authorization to purchase
        </p>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted">
          <li>Nothing changes and checkout stays disabled while the request is open, and also after it is approved.</li>
          <li>You cannot review your own request; the AI cannot approve anything.</li>
          <li>An approved exception only takes effect if the policy owner publishes a new policy version. The mission is then re-evaluated, must pass every remaining check, and still needs human approval of the exact purchase.</li>
          {!reviewersConfigured && <li className="text-warning">No policy administrator is configured for this deployment (AEGIS_POLICY_ADMIN_IDS), so requests stay PENDING_REVIEW.</li>}
        </ul>
      </div>

      {overrides.length > 0 && (
        <ul className="space-y-2">
          {overrides.map((r) => (
            <li key={r.id} className="rounded-md border border-line bg-bg/40 p-3 text-sm" data-testid="override-request">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <OverrideStatus status={r.status} />
                  <span className="font-mono text-[11px] text-faint">
                    {r.id} · mission v{r.missionVersion} · policy v{r.policyVersion} · {formatTime(r.createdAt)}
                  </span>
                </span>
                {r.status === "PENDING_REVIEW" && (
                  <Button size="sm" variant="ghost" onClick={() => withdraw(r.id)} disabled={busy}>
                    <Undo2 className="h-3.5 w-3.5" aria-hidden /> Withdraw
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                Challenged: <span className="text-fg">{r.challengedChecks.map((c) => `${c.label}${c.policyField ? ` (${c.policyField})` : ""}`).join(", ")}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                Budget {formatMoney(r.currentBudgetMinor, r.currency)}
                {r.proposedBudgetMinor != null && <> → proposed {formatMoney(r.proposedBudgetMinor, r.currency)}</>}
                {r.proposedChange && <> · {r.proposedChange}</>}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-fg/80">“{r.justification}”</p>
              {r.reviewNote && <p className="mt-1 text-xs text-muted">Reviewer note: {r.reviewNote}</p>}
              {r.status === "APPROVED" && <p className="mt-1 text-xs text-success">Approved for policy review. This does not unlock checkout: the policy owner must publish a new policy version, then re-run this mission.</p>}
            </li>
          ))}
        </ul>
      )}

      {!o.eligible ? (
        <p className="text-sm text-muted">{o.explanation}</p>
      ) : pending ? (
        <p className="text-sm text-muted">A request is pending review. Withdraw it to file a different one.</p>
      ) : (
        <div className="space-y-3">
          <fieldset>
            <legend className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Which policy rule are you challenging?</legend>
            <ul className="mt-2 space-y-1.5">
              {o.overridable.map((x) => (
                <li key={x.checkId}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--color-cyan)]"
                      checked={checks.includes(x.checkId)}
                      onChange={(e) => setChecks((s) => (e.target.checked ? [...s, x.checkId] : s.filter((y) => y !== x.checkId)))}
                    />
                    <span>
                      {x.label} <span className="font-mono text-[11px] text-faint">policy: {x.policyField}</span>
                      <span className="block text-[11px] text-muted">Fails on {x.offerCount} offer{x.offerCount === 1 ? "" : "s"}.</span>
                    </span>
                  </label>
                </li>
              ))}
              {o.notOverridable.map((x) => (
                <li key={x.checkId} className="flex items-start gap-2 text-sm text-faint">
                  <input type="checkbox" disabled className="mt-1" aria-describedby={`no-${x.checkId}`} />
                  <span>
                    {x.label}
                    <span id={`no-${x.checkId}`} className="block text-[11px]">
                      Cannot be overridden: {x.reason}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Proposed budget (${cur}, optional)`} htmlFor="ovr-budget" warning={budgetProblem} hint={`Current ${formatMoney(analysis.summary.budgetMinor, cur)}`}>
              <Input id="ovr-budget" inputMode="decimal" value={proposedBudget} onChange={(e) => setProposedBudget(e.target.value)} />
            </Field>
            <Field label="Proposed policy change (optional)" htmlFor="ovr-change" hint="e.g. allow evidence coverage of 55% for retailer listings">
              <Input id="ovr-change" value={proposedChange} maxLength={500} onChange={(e) => setProposedChange(e.target.value)} />
            </Field>
          </div>
          <Field label="Justification (required)" htmlFor="ovr-why" hint={`${justification.trim().length}/20 characters minimum. Explain the business need.`}>
            <Textarea id="ovr-why" value={justification} maxLength={2000} onChange={(e) => setJustification(e.target.value)} />
          </Field>
          {error && <ErrorState error={error} />}
          <Button variant="secondary" onClick={submit} loading={busy} disabled={checks.length === 0 || justification.trim().length < 20 || !!budgetProblem} data-testid="submit-override">
            <ShieldQuestion className="h-4 w-4" aria-hidden /> Submit request for review
          </Button>
        </div>
      )}
      {error && (o.eligible === false || pending) && <ErrorState error={error} />}
    </div>
  );
}
