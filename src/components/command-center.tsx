"use client";
import Link from "next/link";
import { Activity, AlertTriangle, Gauge, Receipt, Rocket } from "lucide-react";
import { useMemo } from "react";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { relTime } from "@/lib/client/format";
import { reduceEvents, type MissionEvent } from "@/domain/viewmodel/reducer";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody, PanelHeader, Stat } from "@/components/ui/panel";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { NetworkView } from "@/components/three/network-view";
import { MissionLauncher } from "@/components/mission/mission-launcher";
import type { MissionRow } from "@/components/mission/missions-list";

interface AuditRow {
  id: string;
  seq: number;
  missionId: string | null;
  actor: string;
  eventType: string;
  outcome: string;
  metadata: unknown;
  schemaVersion: number;
  mode: string;
  createdAt: string;
}
interface TxRow {
  id: string;
  kind: string;
  missionId: string;
  missionTitle: string;
  amountMinor: number | null;
  currency: string;
  status: string;
  mode: string;
  simulated: boolean;
  createdAt: string;
}

export function CommandCenter({ scenario }: { scenario?: string }) {
  const missions = useApi<{ items: MissionRow[] }>("/api/missions?take=100", { refreshInterval: 5000 });
  const audit = useApi<{ events: AuditRow[] }>("/api/audit?take=40", { refreshInterval: 5000 });
  const tx = useApi<{ rows: TxRow[] }>("/api/transactions", { refreshInterval: 10000 });

  const latestMissionId = audit.data?.events.find((e) => e.missionId)?.missionId ?? null;
  const latestEvents = useApi<{ events: MissionEvent[] }>(latestMissionId ? `/api/missions/${latestMissionId}/events` : null, { refreshInterval: 3000 });
  const vm = useMemo(() => (latestEvents.data ? reduceEvents(latestEvents.data.events) : null), [latestEvents.data]);

  const items = missions.data?.items ?? [];
  const pending = items.filter((m) => m.displayStatus === "AWAITING_APPROVAL");
  const blocked = items.filter((m) => m.displayStatus === "BLOCKED").length;
  const completed = items.filter((m) => m.displayStatus === "COMPLETED").length;
  const latestMission = items.find((m) => m.id === latestMissionId);

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Command Center" title="Autonomous commerce, under control" subtitle="Launch missions, watch the bounded workflow, and act on decisions that need a human." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Panel>
          <PanelBody>
            <Stat label="Missions" value={items.length} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <Stat label="Awaiting approval" value={pending.length} tone={pending.length ? "warning" : "default"} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <Stat label="Blocked by policy" value={blocked} tone={blocked ? "critical" : "default"} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <Stat label="Completed" value={completed} tone="success" />
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-2">
          <NetworkView
            vm={vm}
            height="h-[300px] md:h-[380px]"
            caption={latestMission ? <Link href={`/missions/${latestMission.id}`} className="rounded bg-bg/80 px-1.5 py-0.5 hover:text-fg">Showing latest activity: {latestMission.title}</Link> : "No mission activity yet"}
          />
        </div>
        <Panel>
          <PanelHeader title="Mission launcher" icon={<Rocket className="h-4 w-4 text-cyan" />} />
          <PanelBody>
            <MissionLauncher initialScenario={scenario} compact />
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Pending approvals" icon={<AlertTriangle className="h-4 w-4 text-warning" />} />
          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting on you" body="Purchases that policy routes to a human appear here." />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <Link href={`/missions/${m.id}`} className="truncate hover:text-cyan">
                    {m.title}
                  </Link>
                  <span className="font-mono text-xs text-muted">{formatMoney(m.budgetMinor, m.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader title="Live activity" icon={<Activity className="h-4 w-4 text-cyan" />} subtitle="Recorded audit events" />
          <ErrorState error={audit.error} />
          {audit.data && audit.data.events.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="max-h-[300px] divide-y divide-line overflow-y-auto">
              {audit.data?.events.slice(0, 20).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-fg">{e.eventType}</span>
                    <span className="block truncate text-muted">{e.actor}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={e.outcome} />
                    <span className="text-[10px] text-muted">{relTime(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent transactions"
            icon={<Receipt className="h-4 w-4 text-cyan" />}
            actions={
              <Link href="/transactions" className="text-xs text-cyan hover:underline">
                All
              </Link>
            }
          />
          {tx.data && tx.data.rows.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <ul className="divide-y divide-line">
              {tx.data?.rows.slice(0, 8).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0">
                    <Link href={`/missions/${r.missionId}`} className="block truncate hover:text-cyan">
                      {r.missionTitle}
                    </Link>
                    <span className="mt-0.5 flex items-center gap-1">
                      <StatusBadge status={r.kind === "PROPOSAL" ? r.status : r.status} />
                      <ModeBadge mode={r.mode} simulated={r.simulated} />
                    </span>
                  </span>
                  <span className="shrink-0 font-mono">{formatMoney(r.amountMinor, r.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Trust overview" icon={<Gauge className="h-4 w-4 text-cyan" />} />
        <PanelBody className="grid gap-3 text-xs text-muted md:grid-cols-3">
          <p>
            <strong className="text-fg">Policy floor:</strong> unknown totals, missing risk assessments, currency mismatches and over-cap budgets always block — no configuration can relax them.
          </p>
          <p>
            <strong className="text-fg">Two gates before money moves:</strong> an unexpired, snapshot-matching AEGIS approval and PayPal buyer approval, both verified server-side.
          </p>
          <p>
            <strong className="text-fg">Evidence, not confidence:</strong> missing evidence is scored as worst case. LLM text is display-only and cannot change scores or decisions.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
