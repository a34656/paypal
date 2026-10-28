"use client";
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, GitBranch, LifeBuoy, ListChecks, PackageMinus, Scale, Search, ShieldQuestion, SlidersHorizontal, Sparkles, TriangleAlert, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { OptionId, Recommendation } from "@/domain/recovery/analysis";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge, type Tone } from "@/components/ui/badge";
import { ErrorState, Skeleton, Spinner } from "@/components/ui/states";
import { RevisionEditor } from "./revision-editor";
import { OverridePanel } from "./override-panel";
import type { AdviceDTO, AlternativesDTO, RecoveryAnalysis, RecoveryDTO, RevisionChanges } from "./types";

const formatBps = (b: number) => `${(b / 100).toFixed(2)}%`;

type View = { kind: "none" } | { kind: "editor"; initial: RevisionChanges; reason?: string } | { kind: "alternatives" } | { kind: "checks" } | { kind: "override" } | { kind: "advisor" };

const EXACTNESS: Record<Recommendation["exactness"], { tone: Tone; label: string }> = {
  EXACT: { tone: "success", label: "Verified total" },
  CAP: { tone: "warning", label: "Spending cap" },
  ESTIMATE: { tone: "warning", label: "Estimate" },
  PROJECTION: { tone: "blue", label: "Projection" },
  "N/A": { tone: "neutral", label: "Action" },
};

const OPTION_ICON: Record<OptionId, ReactNode> = {
  INCREASE_BUDGET: <Wallet className="h-4 w-4" aria-hidden />,
  REDUCE_QUANTITY: <PackageMinus className="h-4 w-4" aria-hidden />,
  FIND_ALTERNATIVES: <Search className="h-4 w-4" aria-hidden />,
  ADJUST_DELIVERY: <SlidersHorizontal className="h-4 w-4" aria-hidden />,
  CHANGE_REQUIREMENTS: <SlidersHorizontal className="h-4 w-4" aria-hidden />,
  COMBINED_PATH: <GitBranch className="h-4 w-4" aria-hidden />,
  REFRESH_QUOTE: <GitBranch className="h-4 w-4" aria-hidden />,
  REQUEST_OVERRIDE: <ShieldQuestion className="h-4 w-4" aria-hidden />,
};

/**
 * "Let's make this purchase work" — evidence-based recovery for a blocked mission.
 * Every number comes from the server's deterministic analysis; every button performs a real
 * request. Nothing here can purchase, approve, or change policy.
 */
export function RecoveryPanel({ missionId }: { missionId: string }) {
  const { data, error, mutate, isLoading } = useApi<RecoveryDTO>(`/api/missions/${missionId}/recovery`);
  const [view, setView] = useState<View>({ kind: "none" });
  const workRef = useRef<HTMLDivElement>(null);
  const open = (v: View) => {
    setView(v);
    requestAnimationFrame(() => workRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (isLoading || !data)
    return (
      <Panel aria-busy>
        <PanelHeader title="Let's make this purchase work" icon={<LifeBuoy />} />
        <PanelBody className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </PanelBody>
      </Panel>
    );

  const a = data.analysis;
  const s = a.summary;
  const cur = s.currency;
  const recs = a.recommendations;
  const primary = recs[0];
  const budgetRec = recs.find((r) => r.id === "INCREASE_BUDGET");
  const qtyRec = recs.find((r) => r.id === "REDUCE_QUANTITY");

  const act = (r: Recommendation) => {
    switch (r.id) {
      case "FIND_ALTERNATIVES":
        return open({ kind: "alternatives" });
      case "REQUEST_OVERRIDE":
        return open({ kind: "override" });
      case "REFRESH_QUOTE":
        return open({ kind: "editor", initial: {}, reason: "Re-run to refresh quotes." });
      default:
        return open({ kind: "editor", initial: r.proposedChanges ?? {}, reason: `Pre-filled from “${r.title}”.` });
    }
  };
  const actLabel = (r: Recommendation) =>
    r.id === "FIND_ALTERNATIVES" ? "Find cheaper alternatives" : r.id === "REQUEST_OVERRIDE" ? "Request policy override" : r.id === "REFRESH_QUOTE" ? "Refresh quotes" : "Review & apply";

  return (
    <Panel id="recovery" className="scroll-mt-20 border-cyan/25" data-testid="recovery-panel">
      <PanelHeader
        title="Let's make this purchase work"
        icon={<LifeBuoy />}
        subtitle="Evidence-based recovery guidance from the stored evaluation. Nothing here buys, approves, or changes policy."
        actions={s.anyDemoData ? <Badge tone="purple">Demo data</Badge> : undefined}
      />
      <PanelBody className="space-y-6">
        {/* ---------- diagnosis */}
        <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-[1.2fr_repeat(3,1fr)]">
          <div className="bg-bg-2 p-4">
            <p className="tech-label">Current mission</p>
            <p className="mt-1.5 text-sm font-medium">{s.title}</p>
            <p className="mt-1 text-xs text-muted">
              {s.quantity} units · {s.offerCount} offers evaluated · {s.blockedCount} blocked · policy v{s.evaluatedPolicyVersion ?? "—"}
            </p>
          </div>
          <Tile label="Budget" value={formatMoney(s.budgetMinor, cur)} />
          <Tile
            label="Lowest identified total"
            value={formatMoney(s.lowestTotalMinor, cur)}
            badge={s.lowestTotalMinor == null ? <Badge>Unknown</Badge> : a.budget.lowestBasis === "CAP" ? <Badge tone="warning">Spending cap</Badge> : <Badge tone="success">Verified total</Badge>}
          />
          <Tile
            label="Minimum shortfall"
            value={s.shortfallMinor == null ? "—" : formatMoney(s.shortfallMinor, cur)}
            tone={s.shortfallMinor ? "critical" : "default"}
            hint={a.budget.shortfallBps != null ? `+${formatBps(a.budget.shortfallBps)} of budget` : s.offerCount === 0 ? "No offers found" : "Not a budget problem"}
          />
        </div>
        {s.arithmetic && (
          <p className="font-mono text-xs text-muted" aria-label="Shortfall calculation">
            Shortfall: <span className="text-fg">{s.arithmetic}</span>
          </p>
        )}

        {/* ---------- most practical next step */}
        {primary && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-cyan/35 bg-cyan/[0.05] p-4 glow-cyan" data-testid="next-action">
            <div className="min-w-0">
              <p className="tech-label !text-cyan">Most practical next step</p>
              <p className="mt-1 text-sm">{primary.resolves ? primary.whatChanges : a.nextAction.label}</p>
              {primary.resolves && <p className="mt-0.5 text-xs text-muted">{primary.whyItHelps}</p>}
            </div>
            <Button variant="primary" onClick={() => act(primary)}>
              {OPTION_ICON[primary.id]} {actLabel(primary)}
            </Button>
          </div>
        )}

        {/* ---------- why */}
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div>
            <p className="tech-label">Why it was blocked</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {a.whyBlocked.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-critical" aria-hidden />
                  <span className="text-fg/90">{w}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3">
            {a.budget.budgetAloneInsufficient && (
              <div className="rounded-md border border-warning/30 bg-warning/[0.05] p-3 text-sm" data-testid="budget-alone-insufficient">
                <p className="flex items-center gap-2 font-medium text-warning">
                  <TriangleAlert className="h-4 w-4" aria-hidden /> Increasing the budget alone will not help
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {a.budget.lowestFit
                    ? `At ${formatMoney(a.budget.lowestFit.minBudgetMinor, cur)} the cheapest offer becomes financially eligible, but still fails: ${a.budget.lowestFit.remainingBlockers.join(", ") || "other checks"}. `
                    : ""}
                  Every offer also fails a non-financial check. Those need a different offer, better evidence, a requirement change, or a policy review.
                </p>
              </div>
            )}
            {a.staleness.note && <p className="text-xs text-warning">{a.staleness.note}</p>}
            <ThreeActions />
          </div>
        </div>

        {/* ---------- recommendations */}
        <div>
          <p className="tech-label">Recommended next steps</p>
          <ol className="mt-2 grid gap-3 md:grid-cols-2">
            {recs.map((r, i) => (
              <li key={`${r.id}-${i}`} className={cn("flex flex-col rounded-md border bg-bg/40 p-4", r.resolves ? "border-success/30" : "border-line")} data-testid={`rec-${r.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="font-mono text-faint">{i + 1}.</span> {OPTION_ICON[r.id]} {r.title}
                  </p>
                  <span className="flex flex-wrap gap-1">
                    {r.resolves ? <Badge tone="success">Resolves (projection)</Badge> : r.proposedChanges && Object.keys(r.proposedChanges).length ? <Badge tone="warning">Partial</Badge> : null}
                    <Badge tone={EXACTNESS[r.exactness].tone}>{EXACTNESS[r.exactness].label}</Badge>
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs">
                  <Row label="What changes">{r.whatChanges}</Row>
                  <Row label="Why it helps">{r.whyItHelps}</Row>
                  <Row label="Estimated cost">
                    <span className="font-mono text-fg">{r.estimatedCost}</span>
                  </Row>
                  {r.tradeoffs.length > 0 && (
                    <Row label="Trade-offs">
                      <ul className="list-disc space-y-0.5 pl-4">
                        {r.tradeoffs.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </Row>
                  )}
                  <Row label="Still must pass">{r.stillMustPass.join(" · ")}</Row>
                </dl>
                <div className="mt-auto pt-3">
                  <Button size="sm" variant={r.resolves ? "secondary" : "ghost"} onClick={() => act(r)} disabled={r.id !== "FIND_ALTERNATIVES" && r.id !== "REQUEST_OVERRIDE" && !data.canRevise}>
                    {actLabel(r)} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* ---------- action bar */}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4" role="toolbar" aria-label="Recovery actions">
          <Button size="sm" variant="secondary" disabled={!budgetRec?.proposedChanges || !data.canRevise} onClick={() => budgetRec && act(budgetRec)} data-testid="apply-budget">
            <Wallet className="h-3.5 w-3.5" aria-hidden /> Apply suggested budget
          </Button>
          <Button size="sm" variant="secondary" disabled={!qtyRec?.proposedChanges || !data.canRevise} onClick={() => qtyRec && act(qtyRec)} data-testid="try-quantity">
            <PackageMinus className="h-3.5 w-3.5" aria-hidden /> Try lower quantity
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open({ kind: "alternatives" })} data-testid="find-alternatives">
            <Search className="h-3.5 w-3.5" aria-hidden /> Find cheaper alternatives
          </Button>
          <Button size="sm" variant="secondary" disabled={!data.canRevise} onClick={() => open({ kind: "editor", initial: {} })} data-testid="review-constraints">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden /> Review constraints
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open({ kind: "checks" })} data-testid="explain-checks">
            <ListChecks className="h-3.5 w-3.5" aria-hidden /> Explain all failed checks
          </Button>
          <Button size="sm" variant="secondary" onClick={() => open({ kind: "advisor" })} data-testid="ask-advisor">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Ask the advisor
          </Button>
          <Button size="sm" variant="danger" onClick={() => open({ kind: "override" })} disabled={s.decision !== "BLOCK"} data-testid="request-override">
            <ShieldQuestion className="h-3.5 w-3.5" aria-hidden /> Request policy override
          </Button>
        </div>

        {/* ---------- work area */}
        <div ref={workRef} className="scroll-mt-24">
          {view.kind === "editor" && (
            <RevisionEditor
              key={JSON.stringify(view.initial)}
              missionId={missionId}
              missionVersion={data.mission.version}
              constraints={data.constraints}
              policyCapMinor={data.policyCapMinor}
              currentPolicyVersion={s.currentPolicyVersion}
              nextRevisionNumber={data.mission.revisionNumber + 1}
              initial={view.initial}
              reason={view.reason}
              onCancel={() => setView({ kind: "none" })}
            />
          )}
          {view.kind === "alternatives" && <Alternatives missionId={missionId} currency={cur} onUseQuery={(q) => open({ kind: "editor", initial: { productQuery: q }, reason: "Refined search query from the alternatives search." })} canRevise={data.canRevise} />}
          {view.kind === "checks" && <FailedChecks analysis={a} />}
          {view.kind === "override" && <OverridePanel missionId={missionId} analysis={a} overrides={data.overrides} reviewersConfigured={data.overrideReviewersConfigured} onChange={() => mutate()} />}
          {view.kind === "advisor" && <Advisor missionId={missionId} llm={data.advisor} />}
        </div>

        {/* ---------- paths */}
        {a.paths.length > 0 && <Paths analysis={a} canRevise={data.canRevise} onApply={(changes) => open({ kind: "editor", initial: changes, reason: "Pre-filled from a path to a feasible purchase." })} />}

        {data.revisions.length > 0 && (
          <div>
            <p className="tech-label">Revisions of this mission</p>
            <ul className="mt-2 space-y-1 text-sm">
              {data.revisions.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/missions/${r.id}`} className="text-cyan hover:underline">
                    Revision {r.revisionNumber}
                  </Link>
                  <StatusBadge status={r.status} />
                  {r.decision && <StatusBadge status={r.decision} />}
                  <span className="font-mono text-xs text-muted">
                    {formatMoney(r.budgetMinor, cur)} · qty {r.quantity}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-faint">{a.projectionNote}</p>
      </PanelBody>
    </Panel>
  );
}

function Tile({ label, value, hint, badge, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; badge?: ReactNode; tone?: "default" | "critical" }) {
  return (
    <div className="bg-bg-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="tech-label">{label}</p>
        {badge}
      </div>
      <p className={cn("mt-1.5 font-mono text-[22px] font-light leading-none tabular-nums", tone === "critical" ? "text-critical" : "text-fg")}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7.5rem_1fr]">
      <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className="leading-relaxed text-fg/85">{children}</dd>
    </div>
  );
}

function ThreeActions() {
  return (
    <div className="rounded-md border border-line bg-bg/40 p-3 text-xs">
      <p className="flex items-center gap-2 font-medium text-fg/90">
        <Scale className="h-3.5 w-3.5 text-cyan" aria-hidden /> Three different actions
      </p>
      <ol className="mt-1.5 space-y-1 text-muted">
        <li>
          <span className="text-fg">A. Revise the mission</span> — you change an adjustable requirement; AEGIS re-evaluates under the existing policy.
        </li>
        <li>
          <span className="text-fg">B. Request a policy exception</span> — an authorised reviewer looks at a policy rule; nothing changes until a new policy version exists.
        </li>
        <li>
          <span className="text-fg">C. Execute a purchase</span> — only after the current policy allows it, a human approves the exact snapshot, and PayPal checkout completes.
        </li>
      </ol>
    </div>
  );
}

function FailedChecks({ analysis }: { analysis: RecoveryAnalysis }) {
  const cur = analysis.summary.currency;
  return (
    <div className="space-y-2" data-testid="failed-checks">
      <p className="tech-label">Every failed check, per offer</p>
      <p className="text-xs text-muted">From the stored policy evaluation and optimizer eligibility gates. Unknown means the provider did not disclose it.</p>
      {analysis.offers.map((o) => (
        <details key={o.offerId} className="group rounded-md border border-line bg-bg/40">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1">{o.title}</span>
              <span className="block text-[11px] text-muted">
                {o.sellerName ?? "Unknown seller"} · {o.quantity} × {formatMoney(o.unitPriceMinor, cur)}
                {o.isDemoData && <span className="ml-2 text-purple">DEMO DATA</span>}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono">{formatMoney(o.totalMinor, cur)}</span>
              {o.totalBasis === "CAP" ? <Badge tone="warning">Cap</Badge> : o.totalBasis === "EXACT" ? <Badge tone="success">Verified</Badge> : <Badge>Unknown</Badge>}
              <Badge tone="critical">{o.blocking.length} failed</Badge>
              {o.budgetOnly && <Badge tone="cyan">Budget only</Badge>}
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[900px] text-xs">
              <caption className="sr-only">Failed checks for {o.title}</caption>
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wider text-muted">
                  {["Constraint", "Actual", "Permitted", "Difference", "Adjustable", "Evidence & source", "Next action"].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.blocking.map((b) => (
                  <tr key={b.checkId} className="border-b border-line/50 align-top">
                    <td className="px-3 py-2">
                      <StatusBadge status={b.result === "INELIGIBLE" ? "BLOCK" : b.result} />
                      <span className="mt-1 block">{b.label}</span>
                    </td>
                    <td className="max-w-[220px] px-3 py-2 font-mono">{b.actual}</td>
                    <td className="px-3 py-2 font-mono text-muted">{b.permitted}</td>
                    <td className="px-3 py-2 font-mono text-critical">{b.difference ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={b.adjustability === "NONE" ? "critical" : b.adjustability === "POLICY" ? "purple" : b.adjustability === "EVIDENCE" ? "warning" : "cyan"}>{b.adjustabilityLabel}</Badge>
                    </td>
                    <td className="max-w-[260px] px-3 py-2 text-muted">
                      {b.evidence}
                      <span className="mt-1 block text-[10.5px] text-faint">{b.source}</span>
                    </td>
                    <td className="max-w-[240px] px-3 py-2">
                      {b.nextAction}
                      {b.budgetWontHelp && <span className="mt-1 block text-[10.5px] text-warning">Budget won&apos;t help: {b.budgetWontHelp}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(o.approvals.length > 0 || o.missingInformation.length > 0) && (
              <div className="grid gap-3 p-3 text-xs sm:grid-cols-2">
                {o.approvals.length > 0 && (
                  <p className="text-muted">
                    <span className="text-warning">Would still need a human:</span> {o.approvals.map((x) => x.label).join(", ")}
                  </p>
                )}
                {o.missingInformation.length > 0 && (
                  <p className="text-muted">
                    <span className="text-fg/80">Unknown (not disclosed):</span> {o.missingInformation.join(", ")}
                  </p>
                )}
                {o.offerUrl && (
                  <a href={o.offerUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-cyan hover:underline">
                    Retailer listing <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function Paths({ analysis, canRevise, onApply }: { analysis: RecoveryAnalysis; canRevise: boolean; onApply: (c: RevisionChanges) => void }) {
  const cur = analysis.summary.currency;
  return (
    <div>
      <p className="tech-label">Paths to a feasible purchase</p>
      <p className="mt-1 text-xs text-muted">The smallest set of mission changes that makes each offer pass every check, projected on the offers already found.</p>
      <div className="mt-2 overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[760px] text-xs">
          <caption className="sr-only">Per-offer paths to eligibility</caption>
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wider text-muted">
              {["Offer", "Total", "Changes needed", "Outcome", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.paths.map((p) => (
              <tr key={p.offerId} className="border-b border-line/50 align-top">
                <td className="max-w-[240px] px-3 py-2">
                  <span className="line-clamp-2">{p.title}</span>
                </td>
                <td className="px-3 py-2 font-mono">
                  {formatMoney(p.totalMinor, cur)}
                  {p.basis === "CAP" && <span className="block text-[10px] text-warning">spending cap</span>}
                </td>
                <td className="px-3 py-2">
                  <ul className="space-y-0.5">
                    {p.changes.map((c) => (
                      <li key={c.label} className={c.relaxesMandatory ? "text-warning" : "text-fg/85"}>
                        {c.label}: {c.from} → {c.to}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2">
                  {p.viable ? <StatusBadge status={p.projectedDecision} /> : <span className="text-critical">Still fails: {p.remainingBlockers.map((b) => `${b.label}${b.overridable ? " (policy)" : ""}`).join(", ")}</span>}
                </td>
                <td className="px-3 py-2">
                  {p.viable && canRevise && (
                    <Button size="sm" variant="ghost" onClick={() => onApply(p.proposed)}>
                      Review <ArrowRight className="h-3 w-3" aria-hidden />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Alternatives({ missionId, currency, onUseQuery, canRevise }: { missionId: string; currency: string; onUseQuery: (q: string) => void; canRevise: boolean }) {
  const [state, setState] = useState<{ loading: boolean; data: AlternativesDTO | null; error: ApiError | null }>({ loading: false, data: null, error: null });
  const run = async () => {
    setState({ loading: true, data: null, error: null });
    try {
      const data = await apiFetch<AlternativesDTO>(`/api/missions/${missionId}/recovery/alternatives`, { method: "POST" });
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Search failed", null, null) });
    }
  };
  const d = state.data;
  return (
    <div className="space-y-3" data-testid="alternatives">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tech-label">Alternative offers</p>
        <Button size="sm" variant="secondary" onClick={run} loading={state.loading}>
          <Search className="h-3.5 w-3.5" aria-hidden /> {d ? "Search again" : "Search the provider"}
        </Button>
      </div>
      {!d && !state.loading && !state.error && <p className="text-xs text-muted">Searches the configured product provider for offers matching your specification and quantity, then projects each one through AEGIS&apos;s engines. Nothing is bought.</p>}
      {state.loading && <Spinner label="Searching and projecting offers…" />}
      {state.error && <ErrorState error={state.error} retry={run} />}
      {d && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {d.isDemo ? <Badge tone="purple">Demo data</Badge> : <Badge tone="blue">Live provider · {d.provider}</Badge>}
            <span>
              {d.total} results · {d.viableCount} pass every check (projection) · queries: {d.queries.map((q) => `“${q}”`).join(", ")}
            </span>
          </div>
          {d.fallbackReason && <p className="text-xs text-warning">{d.fallbackReason}</p>}
          <p className="text-[11px] text-faint">{d.note}</p>
          {d.suggestedQuery && canRevise && (
            <Button size="sm" variant="primary" onClick={() => onUseQuery(d.suggestedQuery as string)}>
              Use “{d.suggestedQuery}” in a revised mission <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[860px] text-xs">
              <caption className="sr-only">Alternative offers ranked by compatibility, total, risk, delivery and completeness</caption>
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-wider text-muted">
                  {["Offer", "Compatibility", "Total", "Risk / evidence", "Delivery", "Projected"].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.results.map((r) => (
                  <tr key={r.key} className={cn("border-b border-line/50 align-top", r.viable && "bg-success/[0.04]")}>
                    <td className="max-w-[260px] px-3 py-2">
                      <span className="line-clamp-2">{r.title}</span>
                      <span className="mt-0.5 block text-[11px] text-muted">
                        {r.sellerName ?? "Unknown seller"} · {r.sellerVerification.toLowerCase()}
                        {r.alreadyEvaluated && " · already evaluated"}
                        {r.isDemoData && <span className="ml-1 text-purple">DEMO</span>}
                      </span>
                      {r.offerUrl && (
                        <a href={r.offerUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
                          Listing <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={r.compatibility === "MATCH" ? "success" : r.compatibility === "MISMATCH" ? "critical" : "warning"}>{r.compatibility === "UNVERIFIED" ? "Not verified" : r.compatibility.toLowerCase()}</Badge>
                      <span className="mt-1 block text-[10.5px] text-faint">{r.attributes.map((x) => `${x.key}: ${x.state.toLowerCase().replace("_", " ")}`).join(" · ")}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatMoney(r.totalMinor, currency)}
                      <span className={cn("block text-[10px]", r.withinBudget ? "text-success" : "text-critical")}>{r.withinBudget ? "within budget" : "over budget"}</span>
                      {r.basis === "CAP" && <span className="block text-[10px] text-warning">spending cap</span>}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {r.riskScore} / {r.evidenceCoverage}%
                    </td>
                    <td className="px-3 py-2">{r.deliveryDays == null ? <span className="text-faint">unknown</span> : `${r.deliveryDays} days`}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.projectedDecision} />
                      {!r.viable && r.blockers.length > 0 && <span className="mt-1 block text-[10.5px] text-faint">{r.blockers.map((b) => b.label).join(", ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Advisor({ missionId, llm }: { missionId: string; llm: RecoveryDTO["advisor"] }) {
  const [state, setState] = useState<{ loading: boolean; data: AdviceDTO | null; error: ApiError | null }>({ loading: false, data: null, error: null });
  const ask = async () => {
    setState({ loading: true, data: null, error: null });
    try {
      const data = await apiFetch<AdviceDTO>(`/api/missions/${missionId}/recovery/advice`, { method: "POST" });
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Advisor failed", null, null) });
    }
  };
  const adv = state.data?.advice;
  return (
    <div className="space-y-3" data-testid="advisor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tech-label">Procurement advisor</p>
        <Button size="sm" variant="secondary" onClick={ask} loading={state.loading}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> {adv ? "Ask again" : "Get advice"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        {llm.llmConfigured ? `Uses the configured LLM (${llm.llmCallsRemaining} call${llm.llmCallsRemaining === 1 ? "" : "s"} left for this mission), validated against the deterministic analysis.` : "No LLM configured: deterministic guidance from the actual failed checks."} The advisor
        explains and recommends; it cannot change constraints, decisions, policy or payments.
      </p>
      {state.loading && <Spinner label="Preparing guidance…" />}
      {state.error && <ErrorState error={state.error} retry={ask} />}
      {adv && state.data && (
        <div className="space-y-3 rounded-md border border-line bg-bg/40 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {state.data.source === "llm" ? <Badge tone="blue">LLM · validated</Badge> : <Badge>Deterministic</Badge>}
            {state.data.fallbackReason && <span className="text-xs text-warning">{state.data.fallbackReason}</span>}
          </div>
          <p className="rounded border border-cyan/30 bg-cyan/[0.05] px-3 py-2">
            <span className="tech-label !text-cyan">Next action</span>
            <span className="mt-1 block">{adv.nextAction.label}</span>
          </p>
          <p className="whitespace-pre-wrap leading-relaxed text-fg/90">{adv.diagnosis}</p>
          {adv.recommendations.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-xs">
              {adv.recommendations.map((r) => (
                <li key={r.optionId + r.title}>
                  <span className="text-fg">{r.title}</span> — <span className="text-muted">{r.rationale}</span>
                </li>
              ))}
            </ol>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-cyan">Failed constraints, trade-offs and missing information</summary>
            <ul className="mt-2 space-y-1 text-muted">
              {adv.failedConstraints.map((f) => (
                <li key={f.checkId}>
                  <span className="font-mono text-fg/80">{f.checkId}</span>: {f.explanation}
                </li>
              ))}
              {adv.tradeoffs.map((t) => (
                <li key={t}>Trade-off: {t}</li>
              ))}
              {adv.missingInformation.map((m) => (
                <li key={m}>{m}</li>
              ))}
              <li>Override: {adv.overrideEligibility.explanation}</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
