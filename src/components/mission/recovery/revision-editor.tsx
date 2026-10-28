"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, GitBranch, TriangleAlert } from "lucide-react";
import { formatMoney, parseMajorInput, toProviderDecimal } from "@/lib/money";
import { RISK_TOLERANCE } from "@/domain/types";
import { apiFetch, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/states";
import type { MissionConstraints, PreviewDTO, RevisionChanges } from "./types";

interface Props {
  missionId: string;
  missionVersion: number;
  constraints: MissionConstraints;
  policyCapMinor: number;
  currentPolicyVersion: number;
  nextRevisionNumber: number;
  initial: RevisionChanges;
  /** Shown above the form: why these values were pre-filled. */
  reason?: string;
  onCancel: () => void;
}

function toMajor(minor: number, currency: string) {
  try {
    return toProviderDecimal(minor, currency);
  } catch {
    return String(minor);
  }
}

/**
 * Edits adjustable mission constraints and creates a NEW linked mission after explicit
 * confirmation. Every change is shown as old → new and previewed with the real engines.
 */
export function RevisionEditor({ missionId, missionVersion, constraints: c, policyCapMinor, currentPolicyVersion, nextRevisionNumber, initial, reason, onCancel }: Props) {
  const router = useRouter();
  const cur = c.currency;
  const [budget, setBudget] = useState(toMajor(initial.budgetMinor ?? c.budgetMinor, cur));
  const [quantity, setQuantity] = useState(String(initial.quantity ?? c.quantity));
  const [deadline, setDeadline] = useState(initial.deadlineDays !== undefined ? (initial.deadlineDays == null ? "" : String(initial.deadlineDays)) : c.deadlineDays == null ? "" : String(c.deadlineDays));
  const [query, setQuery] = useState(initial.productQuery ?? c.productQuery);
  const [risk, setRisk] = useState<string>(String(initial.maxRiskScore !== undefined ? (initial.maxRiskScore ?? "") : (c.maxRiskScore ?? "")));
  const initialAttrs = initial.requiredAttributes ?? c.requiredAttributes;
  const [keep, setKeep] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(c.requiredAttributes).map((k) => [k, k in initialAttrs])));
  const [confirmed, setConfirmed] = useState(false);
  const [ackRelax, setAckRelax] = useState(false);
  const [ackPartial, setAckPartial] = useState(false);
  const [refresh, setRefresh] = useState(false);
  const [preview, setPreview] = useState<PreviewDTO | null>(null);
  const [previewError, setPreviewError] = useState<ApiError | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Client-side parse only to build the request; the server validates everything again.
  const parsed = useMemo(() => {
    const problems: Record<string, string> = {};
    const changes: RevisionChanges = {};
    let budgetMinor: number | null = null;
    try {
      budgetMinor = parseMajorInput(budget, cur);
      if (budgetMinor <= 0) problems.budget = "Budget must be positive.";
    } catch {
      problems.budget = `Enter an amount like 600 or 600.00 (max ${cur === "JPY" ? 0 : 2} decimals).`;
    }
    if (budgetMinor != null && budgetMinor > policyCapMinor) problems.budget = `Above the policy mission cap ${formatMoney(policyCapMinor, cur)}. Mission edits cannot raise policy limits.`;
    if (budgetMinor != null && budgetMinor !== c.budgetMinor && !problems.budget) changes.budgetMinor = budgetMinor;
    const q = Number(quantity);
    if (!Number.isInteger(q) || q < 1 || q > 10_000) problems.quantity = "Whole number between 1 and 10,000.";
    else if (q !== c.quantity) changes.quantity = q;
    const d = deadline.trim() === "" ? null : Number(deadline);
    if (d !== null && (!Number.isInteger(d) || d < 1 || d > 365)) problems.deadline = "Days between 1 and 365, or empty for no deadline.";
    else if (d !== c.deadlineDays) changes.deadlineDays = d;
    const qq = query.trim();
    if (qq.length < 2 || qq.length > 120) problems.query = "2–120 characters.";
    else if (qq !== c.productQuery) changes.productQuery = qq;
    const r = risk === "" ? null : Number(risk);
    if (r !== (c.maxRiskScore ?? null)) changes.maxRiskScore = r;
    const attrs = Object.fromEntries(Object.entries(c.requiredAttributes).filter(([k]) => keep[k]));
    if (Object.keys(attrs).length !== Object.keys(c.requiredAttributes).length) changes.requiredAttributes = attrs;
    return { changes, problems, valid: Object.keys(problems).length === 0 };
  }, [budget, quantity, deadline, query, risk, keep, c, cur, policyCapMinor]);

  const changesKey = JSON.stringify(parsed.changes);
  useEffect(() => {
    if (!parsed.valid) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setPreviewing(true);
      apiFetch<PreviewDTO>(`/api/missions/${missionId}/recovery/preview`, { method: "POST", body: { changes: JSON.parse(changesKey) } })
        .then((p) => {
          if (!cancelled) {
            setPreview(p);
            setPreviewError(null);
          }
        })
        .catch((e) => !cancelled && setPreviewError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Preview failed", null, null)))
        .finally(() => !cancelled && setPreviewing(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [changesKey, parsed.valid, missionId]);

  const diff = preview?.diff ?? [];
  const relaxations = preview?.relaxations ?? [];
  const reducesQuantity = parsed.changes.quantity !== undefined && parsed.changes.quantity < c.quantity;
  const nothingChanged = Object.keys(parsed.changes).length === 0;
  const policyChanged = preview?.policyChangedSinceEvaluation ?? false;
  const canSubmit =
    parsed.valid && confirmed && (relaxations.length === 0 || ackRelax) && (!reducesQuantity || ackPartial) && (!nothingChanged || refresh || policyChanged) && !submitting && !previewing;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ missionId: string }>(`/api/missions/${missionId}/revise`, {
        method: "POST",
        body: { changes: parsed.changes, expectedVersion: missionVersion, confirm: true, acknowledgeRelaxedRequirements: ackRelax, refreshQuotes: refresh },
      });
      router.push(`/missions/${res.missionId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Revision failed", null, null));
      setSubmitting(false);
    }
  };

  const p = preview?.projection;
  return (
    <div className="space-y-5" data-testid="revision-editor">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="tech-label flex items-center gap-2 !text-cyan">
            <GitBranch className="h-3.5 w-3.5" aria-hidden /> Revise mission — creates revision {nextRevisionNumber}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {reason ? `${reason} ` : ""}This is a proposed revision, not a purchase. The original mission stays unchanged; a new linked mission is re-evaluated from scratch under policy v{currentPolicyVersion}.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Close editor
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={`Maximum budget (${cur}, all-in)`} htmlFor="rev-budget" warning={parsed.problems.budget} hint={`Now ${formatMoney(c.budgetMinor, cur)}`}>
          <Input id="rev-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} aria-invalid={!!parsed.problems.budget} />
        </Field>
        <Field label="Quantity" htmlFor="rev-qty" warning={parsed.problems.quantity} hint={`Now ${c.quantity}`}>
          <Input id="rev-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!parsed.problems.quantity} />
        </Field>
        <Field label="Delivery deadline (days)" htmlFor="rev-deadline" warning={parsed.problems.deadline} hint={`Now ${c.deadlineDays == null ? "none" : `${c.deadlineDays} days`}. Empty = no deadline.`}>
          <Input id="rev-deadline" inputMode="numeric" value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={!!parsed.problems.deadline} />
        </Field>
        <Field label="Search query" htmlFor="rev-query" warning={parsed.problems.query} hint="Changing it re-searches the provider for different offers.">
          <Input id="rev-query" value={query} onChange={(e) => setQuery(e.target.value)} aria-invalid={!!parsed.problems.query} />
        </Field>
        <Field label="Mission risk tolerance" htmlFor="rev-risk" hint="Can only tighten the owner policy.">
          <Select id="rev-risk" value={risk} onChange={(e) => setRisk(e.target.value)}>
            {RISK_TOLERANCE.map((t) => (
              <option key={t.id} value={t.maxRiskScore == null ? "" : String(t.maxRiskScore)}>
                {t.label}
              </option>
            ))}
            {c.maxRiskScore != null && !RISK_TOLERANCE.some((t) => t.maxRiskScore === c.maxRiskScore) && <option value={String(c.maxRiskScore)}>Custom (max {c.maxRiskScore})</option>}
          </Select>
        </Field>
      </div>

      {Object.keys(c.requiredAttributes).length > 0 && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">Required attributes — mandatory unless you explicitly make them optional</legend>
          <ul className="mt-1 grid gap-2 sm:grid-cols-2">
            {Object.entries(c.requiredAttributes).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-3 rounded border border-line/70 bg-bg/40 px-3 py-2 text-sm">
                <span>
                  <span className="font-mono text-xs text-muted">{k}</span> = <span>{v}</span>
                </span>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={!!keep[k]} onChange={(e) => setKeep((s) => ({ ...s, [k]: e.target.checked }))} className="accent-[var(--color-cyan)]" />
                  {keep[k] ? "Required" : <span className="text-warning">Optional (not verified)</span>}
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">Never make a safety, compatibility or certification requirement optional just to fit a budget.</p>
        </fieldset>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-line bg-bg/40 p-3">
          <p className="tech-label">Proposed changes</p>
          {nothingChanged ? (
            <p className="mt-2 text-sm text-muted">No constraint changes yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5" aria-live="polite">
              {diff.map((d) => (
                <li key={d.field} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-[8rem] text-muted">{d.label}</span>
                  <span className="font-mono text-fg/70 line-through decoration-faint">{d.display.before}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-cyan" aria-label="changes to" />
                  <span className={cn("font-mono", d.relaxesMandatory ? "text-warning" : "text-cyan")}>{d.display.after}</span>
                  {d.relaxesMandatory && <Badge tone="warning">Relaxes a requirement</Badge>}
                </li>
              ))}
            </ul>
          )}
          {(preview?.warnings ?? []).map((w) => (
            <p key={w} className="mt-2 flex gap-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
        </div>
        <div className="rounded-md border border-line bg-bg/40 p-3" aria-busy={previewing}>
          <div className="flex items-center justify-between gap-2">
            <p className="tech-label">Projected outcome</p>
            <Badge tone="blue">Projection</Badge>
          </div>
          {previewError && <ErrorState error={previewError} />}
          {!p && !previewError && <p className="mt-2 text-sm text-muted">{previewing ? "Re-running the engines…" : "Edit a field to preview."}</p>}
          {p && (
            <div className="mt-2 space-y-2 text-sm">
              <p>
                <span className={cn("font-mono text-lg", p.viableCount > 0 ? "text-success" : "text-critical")}>{p.viableCount}</span>
                <span className="text-muted"> of {p.offerCount} offers already found would pass every check</span>
              </p>
              {p.best ? (
                <p className="text-xs text-muted">
                  Cheapest passing: <span className="text-fg">{p.best.title}</span> · <span className="font-mono text-fg">{formatMoney(p.best.totalMinor, cur)}</span> {p.best.basis === "CAP" && <Badge tone="warning">Spending cap</Badge>} · decision <StatusBadge status={p.projectedDecision} />
                </p>
              ) : (
                <p className="text-xs text-muted">No offer passes yet. Expand to see what still fails.</p>
              )}
              <details className="text-xs">
                <summary className="cursor-pointer text-cyan">Per-offer projection</summary>
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
                  {p.offers.map((o) => (
                    <li key={o.offerId} className="flex items-start justify-between gap-2 border-b border-line/50 pb-1">
                      <span className="min-w-0">
                        <span className="line-clamp-1">{o.title}</span>
                        {!o.viable && <span className="block text-[11px] text-faint">Still fails: {o.blockers.map((b) => b.label).join(", ") || "eligibility"}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono">{formatMoney(o.totalMinor, cur)}</span>
                        <StatusBadge status={o.decision} />
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
              <p className="text-[11px] text-faint">Re-runs AEGIS&apos;s pricing, risk, eligibility and policy engines on the offers already found. The revised mission searches the provider again, so results can differ.</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-cyan/25 bg-cyan/[0.04] p-3 text-sm">
        {nothingChanged && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} className="mt-1 accent-[var(--color-cyan)]" />
            <span>Re-run with unchanged constraints to refresh quotes{policyChanged ? " (the policy also changed since the last evaluation)" : ""}.</span>
          </label>
        )}
        {reducesQuantity && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={ackPartial} onChange={(e) => setAckPartial(e.target.checked)} className="mt-1 accent-[var(--color-cyan)]" data-testid="ack-partial" />
            <span>Partial fulfilment is acceptable: buy {parsed.changes.quantity} instead of {c.quantity}.</span>
          </label>
        )}
        {relaxations.length > 0 && (
          <label className="flex items-start gap-2 text-warning">
            <input type="checkbox" checked={ackRelax} onChange={(e) => setAckRelax(e.target.checked)} className="mt-1 accent-[var(--color-warning)]" data-testid="ack-relax" />
            <span>I accept that AEGIS will no longer verify: {relaxations.map((r) => `${r.label} (${r.display.before})`).join(", ")}.</span>
          </label>
        )}
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 accent-[var(--color-cyan)]" data-testid="confirm-revision" />
          <span>
            Create revision {nextRevisionNumber} and re-evaluate. I understand nothing is purchased: every check re-runs, and any purchase still needs human approval of the exact snapshot and PayPal checkout.
          </span>
        </label>
        {error && <ErrorState error={error} />}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="primary" onClick={submit} disabled={!canSubmit} loading={submitting} data-testid="submit-revision">
            <GitBranch className="h-4 w-4" aria-hidden /> Create revision &amp; re-evaluate
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
