"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitBranch, Play } from "lucide-react";
import { reduceEvents } from "@/domain/viewmodel/reducer";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import { cn } from "@/lib/client/cn";
import { Panel, PanelBody, PanelHeader, Stat } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { NetworkView } from "@/components/three/network-view";
import type { SessionInfo } from "@/components/shell/identity-menu";
import { ConfirmForm, type ComposerDraft } from "./confirm-form";
import { Comparison } from "./comparison";
import { ApprovalPanel } from "./approval-panel";
import { CheckoutPanel } from "./checkout-panel";
import { Timeline } from "./timeline";
import { ReplayPanel } from "./replay-panel";
import { RecoveryPanel } from "./recovery/recovery-panel";
import type { EventsDTO, MissionDetailDTO, MissionProductDTO } from "./types";

const ACTIVE_STATUSES = ["CONFIRMED", "SCOUTING", "SCOUTED", "RISK_ANALYSIS", "OPTIMIZING", "POLICY_EVALUATION"];
const PAYMENT_ACTIVE = ["CHECKOUT_IN_PROGRESS", "CAPTURE_PENDING"];

export function MissionDetail({ id, draft }: { id: string; draft?: ComposerDraft }) {
  const [tab, setTab] = useState<"live" | "replay">("live");
  useEffect(() => {
    // Deep link from the audit log: /missions/:id#replay
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL hash after mount
    if (window.location.hash === "#replay") setTab("replay");
  }, []);
  const detail = useApi<MissionDetailDTO>(`/api/missions/${id}`, {
    refreshInterval: (d) => (d && (ACTIVE_STATUSES.includes(d.mission.status) || PAYMENT_ACTIVE.includes(d.mission.displayStatus)) ? 1500 : 0),
  });
  const events = useApi<EventsDTO>(`/api/missions/${id}/events`, {
    refreshInterval: () => (detail.data && (ACTIVE_STATUSES.includes(detail.data.mission.status) || PAYMENT_ACTIVE.includes(detail.data.mission.displayStatus)) ? 1500 : 0),
  });
  const { data: session } = useApi<SessionInfo>("/api/session");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);

  const refresh = () => {
    void detail.mutate();
    void events.mutate();
  };

  const vm = useMemo(() => reduceEvents(events.data?.events ?? []), [events.data]);

  if (detail.error) return <ErrorState error={detail.error} retry={() => detail.mutate()} />;
  if (!detail.data)
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-80" />
      </div>
    );

  const { mission, products, approvals, payments, revisions } = detail.data;
  const currency = mission.currency ?? "USD";
  const recommended = products.find((p) => p.productId === mission.recommendedProductId) ?? null;
  const markers = products.map((p) => ({ id: p.id, label: p.product.title, decision: p.policyDecision, rank: p.recommendationRank, risk: p.riskScore, coverage: p.evidenceCoverage }));
  const owner = session && session.user.id === mission.ownerId ? `${session.user.displayName} (you)` : mission.ownerId;
  const live = vm.steps.SCOUT === "running" || vm.steps.RISK === "running" || vm.steps.OPTIMIZE === "running" || vm.steps.POLICY === "running";

  const execute = async () => {
    setRunning(true);
    setRunError(null);
    try {
      await apiFetch(`/api/missions/${id}/execute`, { method: "POST" });
    } catch (e) {
      setRunError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Execution failed", null, null));
    } finally {
      setRunning(false);
      refresh();
    }
  };

  const nodeInfo = {
    scout: { title: "Scout", lines: [`Status: ${vm.steps.SCOUT}`, `Candidates: ${products.length}`, `Provider: ${products[0]?.product.provider ?? "—"}${products.some((p) => p.product.isDemoData) ? " (demo data)" : ""}`] },
    risk: { title: "Risk", lines: [`Status: ${vm.steps.RISK}`, ...products.slice(0, 4).map((p) => `${p.product.title.slice(0, 28)}…: risk ${p.riskScore ?? "—"} · ${p.evidenceCoverage ?? "—"}%`)] },
    optimizer: { title: "Optimizer", lines: [`Status: ${vm.steps.OPTIMIZE}`, `Ranked: ${products.filter((p) => p.recommendationRank != null).length} of ${products.length}`] },
    policy: { title: "Policy Guard", lines: [`Decision: ${mission.decision?.replace(/_/g, " ") ?? "pending"}`, `Policy version: ${mission.policyVersion ? `v${mission.policyVersion}` : "—"}`] },
    paypal: { title: payments[0]?.provider === "simulated" ? "Payment (simulated)" : "PayPal", lines: payments.length ? payments.slice(0, 2).map((p) => `${p.status.toLowerCase()} · ${formatMoney(p.amountMinor, p.currency)}`) : ["Inactive until approval and checkout"] },
    core: { title: "AEGIS Core", lines: [`Workflow: ${mission.status}`, `Events: ${vm.eventCount}`] },
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/missions" className="mb-4 inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Missions
        </Link>
        <p className="tech-label flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="!text-cyan">Mission</span>
          <span className="normal-case tracking-normal text-faint">{mission.id}</span>
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-medium tracking-[-0.02em] md:text-[34px] md:leading-tight">{mission.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{mission.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={mission.displayStatus} />
            {mission.decision && <StatusBadge status={mission.decision} />}
            <ModeBadge mode={mission.mode} />
          </div>
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-xs">
          <div>
            <dt className="tech-label !text-faint">Created</dt>
            <dd className="mt-0.5 font-mono">{formatTime(mission.createdAt)}</dd>
          </div>
          <div>
            <dt className="tech-label !text-faint">Owner</dt>
            <dd className="mt-0.5">{owner}</dd>
          </div>
          <div>
            <dt className="tech-label !text-faint">Parser</dt>
            <dd className="mt-0.5">{mission.parserSource === "llm" ? "Gemini (proposal)" : mission.parserSource === "revision" ? "User revision" : mission.parserSource ?? "—"}</dd>
          </div>
        </dl>
        {(mission.revisedFromId || revisions.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line bg-bg-2 px-3 py-2 text-xs" data-testid="revision-lineage">
            <GitBranch className="h-3.5 w-3.5 text-cyan" aria-hidden />
            {mission.revisedFromId && (
              <span>
                Revision {mission.revisionNumber} of{" "}
                <Link href={`/missions/${mission.revisedFromId}`} className="text-cyan hover:underline">
                  the original mission
                </Link>{" "}
                — re-evaluated from scratch; the original is unchanged.
              </span>
            )}
            {revisions.map((r) => (
              <span key={r.id} className="flex items-center gap-1.5">
                <Link href={`/missions/${r.id}`} className="text-cyan hover:underline">
                  Revision {r.revisionNumber}
                </Link>
                <StatusBadge status={r.status} />
              </span>
            ))}
          </div>
        )}
      </div>

      <Panel>
        <div className="grid gap-px bg-line md:grid-cols-[1.3fr_2fr]">
          <div className="bg-bg-2 p-4">
            <p className="tech-label">Original request</p>
            <blockquote className="mt-2 border-l border-cyan/40 pl-3 text-sm leading-relaxed text-fg/90">{mission.rawInputText}</blockquote>
          </div>
          <div className="grid grid-cols-2 gap-4 bg-bg-2 p-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Budget (all-in)" value={formatMoney(mission.budgetMinor, currency)} />
            <Stat label="Quantity" value={mission.quantity ?? "—"} />
            <Stat label={recommended?.amountBasis === "CAP" ? "Recommended cap" : "Recommended total"} value={recommended ? formatMoney(recommended.totalMinor, currency) : "—"} tone="cyan" />
            <Stat label="Trust" value={recommended?.trustScore ?? "—"} hint="100 − risk score" />
            <Stat label="Policy" value={mission.policyVersion ? `v${mission.policyVersion}` : "—"} />
          </div>
        </div>
      </Panel>

      {mission.status === "PARSED" && mission.parsedProposal && (
        <Panel>
          <PanelHeader title="Confirm mission constraints" subtitle="Nothing runs until you confirm." />
          <PanelBody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <ConfirmForm missionId={mission.id} proposal={mission.parsedProposal as any} parserSource={mission.parserSource} onDone={refresh} draft={draft} />
          </PanelBody>
        </Panel>
      )}

      {mission.status === "CONFIRMED" && (
        <Panel className="glow-cyan">
          <PanelBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm">Constraints confirmed.</p>
              <p className="mt-1 text-xs text-muted">Run the bounded agent workflow: Scout → Risk → Optimizer → Policy Guard. It can only propose; it never creates orders.</p>
            </div>
            <Button variant="primary" onClick={execute} loading={running} data-testid="execute-mission">
              <Play className="h-4 w-4" aria-hidden /> Run workflow
            </Button>
          </PanelBody>
          {runError && (
            <PanelBody className="pt-0">
              <ErrorState error={runError} />
            </PanelBody>
          )}
        </Panel>
      )}

      {mission.failureReason && <ErrorState error={{ message: mission.failureReason, code: mission.status }} />}

      {mission.status === "BLOCKED" && mission.confirmedConstraints && <RecoveryPanel missionId={mission.id} />}

      <div>
        <div className="flex gap-5 border-b border-line" role="tablist" aria-label="Mission view">
          {(["live", "replay"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("-mb-px border-b px-0.5 pb-2.5 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors", tab === t ? "border-cyan text-fg" : "border-transparent text-faint hover:text-muted")}
              data-testid={`tab-${t}`}
            >
              {t === "live" ? (
                <span className="flex items-center gap-2">
                  Live workflow {live && <span className="h-1.5 w-1.5 animate-aegis-pulse rounded-full bg-cyan" aria-label="running" />}
                </span>
              ) : (
                "Replay"
              )}
            </button>
          ))}
        </div>
        <div className="pt-5">
          {tab === "live" ? (
            <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
              <NetworkView vm={vm} products={markers} nodeInfo={nodeInfo} height="h-[380px] md:h-[440px]" />
              <Panel>
                <PanelHeader title="Execution timeline" subtitle={`${vm.eventCount} recorded events`} />
                <PanelBody>
                  <Timeline items={vm.timeline} maxHeight="max-h-[360px]" />
                </PanelBody>
              </Panel>
            </div>
          ) : (
            <Panel>
              <PanelHeader title="Replay" subtitle="Stored, ordered, schema-versioned events. Read-only: no writes, no provider calls, no payments." />
              <PanelBody>
                <ReplayPanel events={events.data?.events ?? []} products={markers} />
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>

      {products.length > 0 && (
        <Panel>
          <PanelHeader
            title="Recommendations & risk"
            subtitle="Trust = 100 − risk. Unknown means not disclosed: it raises risk but is not treated as fraud. Expand an offer for its evidence and every policy check."
          />
          <Comparison products={products} recommendedProductId={mission.recommendedProductId} currency={currency} />
        </Panel>
      )}

      {products.length > 0 && <OptimizerRanking products={products} />}

      {(mission.recommendationSummary || mission.decision) && (
        <Panel>
          <PanelHeader title="Policy decision" subtitle={mission.recommendationSource === "llm" ? "Explanation text generated by the LLM (display only; it cannot change the decision)." : "Deterministic explanation."} />
          <PanelBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={mission.decision} />
              <span className="text-[11px] text-faint">Precedence: block › require approval › allow. ALLOW never means capture without a human.</span>
            </div>
            {mission.recommendationSummary && <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-fg/90">{mission.recommendationSummary}</p>}
            {!recommended && mission.status === "BLOCKED" && (
              <p className="text-sm text-critical">
                Every candidate was blocked or ineligible.{" "}
                <a href="#recovery" className="text-cyan hover:underline">
                  See how to make this purchase possible
                </a>
                .
              </p>
            )}
          </PanelBody>
        </Panel>
      )}

      {mission.status === "AWAITING_APPROVAL" && mission.decision && (
        <Panel>
          <PanelHeader title="Human approval" subtitle="Awaiting authorized reviewer sign-off before checkout unlocks." />
          <PanelBody>
            <ApprovalPanel mission={mission} recommended={recommended} approvals={approvals} isApprover={session?.user.roles.includes("APPROVER") ?? false} onChange={refresh} />
          </PanelBody>
        </Panel>
      )}

      {["READY_FOR_CHECKOUT", "COMPLETED", "DENIED", "BLOCKED", "EXPIRED"].includes(mission.status) && mission.decision && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Human approval" />
            <PanelBody>
              <ApprovalPanel mission={mission} recommended={recommended} approvals={approvals} isApprover={session?.user.roles.includes("APPROVER") ?? false} onChange={refresh} />
            </PanelBody>
          </Panel>
          <Panel id="payment" className="scroll-mt-20">
            <PanelHeader title="Payment" subtitle="Server-side truth. The browser never sends amounts or order ids." />
            <PanelBody>
              <CheckoutPanel mission={mission} products={products} approvals={approvals} payments={payments} onChange={refresh} />
            </PanelBody>
          </Panel>
        </div>
      )}

      <Panel>
        <PanelHeader
          title="Audit events"
          subtitle="Append-only and hash-chained."
          actions={
            <Link href={`/audit?missionId=${mission.id}`} className="text-[11px] text-cyan hover:underline">
              Open in audit log
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-line text-left">
                {["#", "Time", "Event", "Actor", "Outcome", "Hash"].map((h) => (
                  <th key={h} className="tech-label px-4 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(events.data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-b border-line/50 hover:bg-elevated/40">
                  <td className="px-4 py-1.5 font-mono text-faint">{e.seq}</td>
                  <td className="px-4 py-1.5 font-mono text-faint">{formatTime(e.createdAt)}</td>
                  <td className="px-4 py-1.5 font-mono">{e.eventType}</td>
                  <td className="px-4 py-1.5 font-mono text-muted">{e.actor}</td>
                  <td className="px-4 py-1.5">
                    <StatusBadge status={e.outcome} />
                  </td>
                  <td className="px-4 py-1.5 font-mono text-faint" title={e.hash}>
                    {e.hash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-[11px] text-faint">Bounded agent workflow: orchestrated functions with narrow interfaces. No agent has shell, filesystem, network (beyond its provider adapter) or payment access.</p>
    </div>
  );
}

/** The Optimizer's ranking and reasons, plus why every other offer was not ranked. */
function OptimizerRanking({ products }: { products: MissionProductDTO[] }) {
  const ranked = products.filter((p) => p.recommendationRank != null).sort((a, b) => (a.recommendationRank ?? 0) - (b.recommendationRank ?? 0));
  const unranked = products.filter((p) => p.recommendationRank == null && p.eligible === false);
  if (ranked.length === 0 && unranked.length === 0) return null;
  return (
    <Panel>
      <PanelHeader title="Optimizer ranking" subtitle="Only offers that pass hard gates are ranked, using the weights in your versioned policy." />
      <div className="grid gap-px bg-line md:grid-cols-2">
        <ol className="bg-bg-2 p-4">
          {ranked.length === 0 && <li className="text-xs text-muted">No offer was eligible for ranking.</li>}
          {ranked.map((p) => (
            <li key={p.id} className="grid grid-cols-[36px_1fr_auto] items-baseline gap-3 border-b border-line/60 py-2.5 last:border-0">
              <span className={cn("font-mono text-lg font-light", p.recommendationRank === 1 ? "text-cyan" : "text-faint")}>#{p.recommendationRank}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px]">{p.product.title}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{p.optimizerExplanation}</span>
              </span>
              <span className="font-mono text-xs text-fg/80">{p.optimizerScore ?? "—"}</span>
            </li>
          ))}
        </ol>
        <div className="bg-bg-2 p-4">
          <p className="tech-label mb-2">Not ranked</p>
          {unranked.length === 0 ? (
            <p className="text-xs text-muted">Every offer was eligible.</p>
          ) : (
            <ul className="space-y-2">
              {unranked.slice(0, 8).map((p) => (
                <li key={p.id} className="text-xs">
                  <span className="block truncate text-fg/85">{p.product.title}</span>
                  <span className="block text-[11px] text-faint">{(p.ineligibleReasons ?? []).join(" ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
