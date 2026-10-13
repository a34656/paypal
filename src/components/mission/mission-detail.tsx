"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Cpu, FileClock, GitCompareArrows, History, Play, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { reduceEvents } from "@/domain/viewmodel/reducer";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import { Panel, PanelBody, PanelHeader, Stat } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { NetworkView } from "@/components/three/network-view";
import type { SessionInfo } from "@/components/shell/identity-menu";
import { ConfirmForm } from "./confirm-form";
import { Comparison } from "./comparison";
import { ApprovalPanel } from "./approval-panel";
import { CheckoutPanel } from "./checkout-panel";
import { Timeline } from "./timeline";
import { ReplayPanel } from "./replay-panel";
import type { EventsDTO, MissionDetailDTO } from "./types";

const ACTIVE_STATUSES = ["CONFIRMED", "SCOUTING", "SCOUTED", "RISK_ANALYSIS", "OPTIMIZING", "POLICY_EVALUATION"];

export function MissionDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<"live" | "replay">("live");
  const detail = useApi<MissionDetailDTO>(`/api/missions/${id}`, {
    refreshInterval: (d) => (d && (ACTIVE_STATUSES.includes(d.mission.status) || ["CHECKOUT_IN_PROGRESS", "CAPTURE_PENDING"].includes(d.mission.displayStatus)) ? 1500 : 0),
  });
  const events = useApi<EventsDTO>(`/api/missions/${id}/events`, {
    refreshInterval: () => (detail.data && ACTIVE_STATUSES.includes(detail.data.mission.status) ? 1500 : 0),
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
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64" />
      </div>
    );

  const { mission, products, approvals, payments } = detail.data;
  const currency = mission.currency ?? "USD";
  const recommended = products.find((p) => p.productId === mission.recommendedProductId) ?? null;
  const markers = products.map((p) => ({ id: p.id, label: p.product.title, decision: p.policyDecision }));

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
    scout: { title: "Scout", lines: [`Status: ${vm.steps.SCOUT}`, `Candidates: ${products.length}`, "Provider: demo catalogue (fictional sellers)"] },
    risk: { title: "Risk engine", lines: [`Status: ${vm.steps.RISK}`, ...products.slice(0, 5).map((p) => `${p.product.providerProductId}: risk ${p.riskScore ?? "—"} / coverage ${p.evidenceCoverage ?? "—"}%`)] },
    optimizer: { title: "Optimizer", lines: [`Status: ${vm.steps.OPTIMIZE}`, `Eligible: ${products.filter((p) => p.eligible).length} of ${products.length}`] },
    policy: { title: "Policy Guard", lines: [`Decision: ${mission.decision ?? "pending"}`, `Policy version: ${mission.policyVersion ? `v${mission.policyVersion}` : "—"}`] },
    human: { title: "Human gate", lines: [`Approvals: ${approvals.length}`, ...approvals.slice(0, 2).map((a) => `${a.kind.toLowerCase()} · ${a.status.toLowerCase()}`)] },
    paypal: { title: payments[0]?.provider === "simulated" ? "Payment (simulated)" : "PayPal", lines: payments.length ? payments.slice(0, 2).map((p) => `${p.status.toLowerCase()} · ${formatMoney(p.amountMinor, p.currency)}`) : ["No payment yet"] },
    core: { title: "AEGIS Core", lines: [`Workflow: ${mission.status}`, `Events: ${vm.eventCount}`] },
    interpreter: { title: "Mission Interpreter", lines: [`Parser: ${mission.parserSource ?? "—"}`, "Output is a proposal; confirmed by user"] },
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/missions" className="mb-2 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Missions
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{mission.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted">{mission.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={mission.displayStatus} />
            {mission.decision && <StatusBadge status={mission.decision} />}
            <ModeBadge mode={mission.mode} />
          </div>
        </div>
      </div>

      <Panel>
        <PanelBody className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Budget (all-in)" value={formatMoney(mission.budgetMinor, currency)} />
          <Stat label="Quantity" value={mission.quantity ?? "—"} />
          <Stat label="Recommended total" value={recommended ? formatMoney(recommended.totalMinor, currency) : "—"} tone="cyan" />
          <Stat label="Trust (recommended)" value={recommended?.trustScore ?? "—"} hint="100 − risk score" />
          <Stat label="Policy" value={mission.policyVersion ? `v${mission.policyVersion}` : "—"} />
          <Stat label="Created" value={<span className="text-sm">{formatTime(mission.createdAt)}</span>} />
        </PanelBody>
      </Panel>

      {mission.status === "PARSED" && mission.parsedProposal && (
        <Panel>
          <PanelHeader title="Confirm mission constraints" subtitle="Nothing runs until you confirm." icon={<ShieldCheck className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <ConfirmForm missionId={mission.id} proposal={mission.parsedProposal as any} parserSource={mission.parserSource} onDone={refresh} />
          </PanelBody>
        </Panel>
      )}

      {mission.status === "CONFIRMED" && (
        <Panel>
          <PanelBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Constraints confirmed.</p>
              <p className="text-xs text-muted">Run the bounded agent workflow: Scout → Risk → Optimizer → Policy Guard. It can only propose; it never creates orders.</p>
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

      {mission.failureReason && (
        <ErrorState error={{ message: mission.failureReason, code: mission.status }} />
      )}

      <div className="flex gap-1 border-b border-line" role="tablist" aria-label="Mission view">
        {(["live", "replay"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t ? "border-cyan text-cyan" : "border-transparent text-muted hover:text-fg"}`}
            data-testid={`tab-${t}`}
          >
            {t === "live" ? "Live workflow" : "Replay"}
          </button>
        ))}
      </div>

      {tab === "live" ? (
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <NetworkView vm={vm} products={markers} nodeInfo={nodeInfo} height="h-[340px]" />
          <Panel>
            <PanelHeader title="Execution timeline" icon={<History className="h-4 w-4 text-cyan" />} subtitle={`${vm.eventCount} recorded events`} />
            <PanelBody>
              <Timeline items={vm.timeline} maxHeight="max-h-[260px]" />
            </PanelBody>
          </Panel>
        </div>
      ) : (
        <Panel>
          <PanelHeader title="Replay" subtitle="Stored, ordered, schema-versioned events. Read-only: no writes, no provider calls." icon={<History className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            <ReplayPanel events={events.data?.events ?? []} products={markers} />
          </PanelBody>
        </Panel>
      )}

      {products.length > 0 && (
        <Panel>
          <PanelHeader
            title="Recommendations & risk"
            subtitle="Trust = 100 − risk. Missing evidence is scored as worst case. Demo scores are estimates from demo evidence."
            icon={<GitCompareArrows className="h-4 w-4 text-cyan" />}
          />
          <Comparison products={products} recommendedProductId={mission.recommendedProductId} currency={currency} />
        </Panel>
      )}

      {(mission.recommendationSummary || mission.decision) && (
        <Panel>
          <PanelHeader title="Policy decision" icon={<Sparkles className="h-4 w-4 text-cyan" />} subtitle={mission.recommendationSource === "llm" ? "Explanation text generated by the LLM (display only; it cannot change the decision)." : "Deterministic explanation."} />
          <PanelBody className="space-y-2">
            <div className="flex items-center gap-2">
              <StatusBadge status={mission.decision} />
              <span className="text-xs text-muted">Precedence: block › require approval › allow. ALLOW never means capture without a human.</span>
            </div>
            {mission.recommendationSummary && <p className="whitespace-pre-wrap text-sm text-fg">{mission.recommendationSummary}</p>}
            {!recommended && mission.status === "BLOCKED" && <p className="text-sm text-critical">Every candidate was blocked or ineligible. Expand the offers above to see each failing check.</p>}
          </PanelBody>
        </Panel>
      )}

      {["AWAITING_APPROVAL", "READY_FOR_CHECKOUT", "COMPLETED", "DENIED", "BLOCKED", "EXPIRED"].includes(mission.status) && mission.decision && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Human approval" icon={<ShieldCheck className="h-4 w-4 text-cyan" />} />
            <PanelBody>
              <ApprovalPanel mission={mission} recommended={recommended} approvals={approvals} isApprover={session?.user.roles.includes("APPROVER") ?? false} onChange={refresh} />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Payment" icon={<Wallet className="h-4 w-4 text-cyan" />} subtitle="Server-side truth. The browser never sends amounts or order ids." />
            <PanelBody>
              <CheckoutPanel mission={mission} approvals={approvals} payments={payments} onChange={refresh} />
            </PanelBody>
          </Panel>
        </div>
      )}

      <Panel>
        <PanelHeader
          title="Audit events"
          icon={<FileClock className="h-4 w-4 text-cyan" />}
          actions={
            <Link href={`/audit?missionId=${mission.id}`} className="text-xs text-cyan hover:underline">
              Open in audit log
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-4 py-2">Hash</th>
              </tr>
            </thead>
            <tbody>
              {(events.data?.events ?? []).map((e) => (
                <tr key={e.id} className="border-b border-line/50">
                  <td className="px-4 py-1.5 font-mono text-muted">{e.seq}</td>
                  <td className="px-4 py-1.5 font-mono">{e.eventType}</td>
                  <td className="px-4 py-1.5 font-mono text-muted">{e.actor}</td>
                  <td className="px-4 py-1.5">
                    <StatusBadge status={e.outcome} />
                  </td>
                  <td className="px-4 py-1.5 font-mono text-muted" title={e.hash}>
                    {e.hash.slice(0, 12)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <Cpu className="h-3.5 w-3.5" aria-hidden /> Bounded agent workflow: orchestrated functions with narrow interfaces. No agent has shell, filesystem, network (beyond its provider adapter) or payment access.
      </p>
    </div>
  );
}
