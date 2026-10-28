"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { formatTime } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { Input, Select } from "@/components/ui/field";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

export interface MissionRow {
  id: string;
  title: string;
  status: string;
  displayStatus: string;
  decision: string | null;
  budgetMinor: number | null;
  currency: string | null;
  quantity: number | null;
  mode: string;
  paymentStatus: string | null;
  createdAt: string;
}

const STATUSES = ["AWAITING_CONFIRMATION", "QUEUED", "RUNNING", "AWAITING_APPROVAL", "READY_FOR_CHECKOUT", "CHECKOUT_IN_PROGRESS", "CAPTURE_PENDING", "HOLD_PLACED", "COMPLETED", "REFUNDED", "BLOCKED", "DENIED", "EXPIRED", "FAILED"];

export function MissionsList({ initialStatus }: { initialStatus: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const params = new URLSearchParams({ take: "100", ...(q ? { q } : {}), ...(status ? { status } : {}) });
  const { data, error, isLoading, mutate } = useApi<{ items: MissionRow[] }>(`/api/missions?${params}`, { keepPreviousData: true });

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="Missions"
        subtitle="Every purchasing mission, its derived status and policy decision."
        actions={
          <Link href="/missions/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan px-4 text-sm font-medium text-bg hover:bg-cyan/90">
            <Plus className="h-4 w-4" aria-hidden /> New mission
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <Input aria-label="Search missions" placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </Select>
      </div>
      <ErrorState error={error} retry={() => mutate()} />
      <Panel>
        {isLoading && !data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState
            title={q || status ? "No missions match these filters" : "No missions yet"}
            body="Launch a mission to see VANTA parse, scout, score, rank and govern a purchase."
            action={
              <Link href="/missions/new?scenario=robotics-lab" className="text-sm text-cyan hover:underline">
                Start the robotics-lab demo mission
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-2">Mission</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Decision</th>
                  <th className="px-4 py-2 text-right">Budget</th>
                  <th className="px-4 py-2">Mode</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((m) => (
                  <tr key={m.id} className="border-b border-line/60 hover:bg-elevated/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/missions/${m.id}`} className="font-medium text-fg hover:text-cyan">
                        {m.title}
                      </Link>
                      <div className="font-mono text-[10px] text-muted">{m.id}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={m.displayStatus} />
                    </td>
                    <td className="px-4 py-2.5">{m.decision ? <StatusBadge status={m.decision} /> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatMoney(m.budgetMinor, m.currency)}</td>
                    <td className="px-4 py-2.5">
                      <ModeBadge mode={m.mode} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">{formatTime(m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
