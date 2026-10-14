"use client";
import Link from "next/link";
import { Fragment, useState } from "react";
import { Link2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Panel } from "@/components/ui/panel";
import { Input, Select } from "@/components/ui/field";
import { Badge, ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";

interface AuditEventDTO {
  id: string;
  seq: number;
  missionId: string | null;
  actor: string;
  eventType: string;
  resource: string;
  outcome: string;
  correlationId: string;
  metadata: unknown;
  schemaVersion: number;
  mode: string;
  prevHash: string;
  hash: string;
  createdAt: string;
}
interface ChainStatus {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string | null;
}

export function ChainIndicator() {
  const { data, error } = useApi<ChainStatus>("/api/audit/verify", { refreshInterval: 30_000 });
  if (error) return <Badge tone="critical">Chain check failed</Badge>;
  if (!data) return <Badge>Verifying chain…</Badge>;
  return data.ok ? (
    <Badge tone="success" icon={<ShieldCheck className="h-3 w-3" aria-hidden />}>
      Hash chain verified · {data.checked} events
    </Badge>
  ) : (
    <Badge tone="critical" icon={<ShieldAlert className="h-3 w-3" aria-hidden />}>
      Chain broken at #{data.brokenAtSeq}: {data.reason}
    </Badge>
  );
}

export function AuditView({ initialMissionId }: { initialMissionId: string }) {
  const [actor, setActor] = useState("");
  const [eventType, setEventType] = useState("");
  const [outcome, setOutcome] = useState("");
  const [missionId, setMissionId] = useState(initialMissionId);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const params = new URLSearchParams({ take: "200" });
  if (actor) params.set("actor", actor);
  if (eventType) params.set("eventType", eventType);
  if (outcome) params.set("outcome", outcome);
  if (missionId) params.set("missionId", missionId);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  const { data, error, isLoading, mutate } = useApi<{ events: AuditEventDTO[] }>(`/api/audit?${params}`, { keepPreviousData: true, refreshInterval: 10_000 });

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Accountability" title="Audit log" subtitle="Append-only and hash-chained: hash = SHA-256(prevHash ‖ canonical(event)). Every financial state change commits with its event in one transaction." actions={<ChainIndicator />} />
      <Input aria-label="Search loaded events" placeholder="Search event, actor, reason, decision…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Select aria-label="Filter by agent or actor" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">All actors</option>
          <option value="agent:scout">Scout</option>
          <option value="agent:risk">Risk</option>
          <option value="agent:optimizer">Optimizer</option>
          <option value="agent:policy-guard">Policy Guard</option>
          <option value="agent:mission-interpreter">Interpreter</option>
          <option value="user:">Humans</option>
          <option value="provider:">Payment provider</option>
          <option value="system">System</option>
        </Select>
        <Select aria-label="Filter by event type" value={eventType} onChange={(e) => setEventType(e.target.value)}>
          <option value="">All event types</option>
          {["mission.", "agent.", "policy.", "approval.", "payment.", "webhook.", "identity."].map((p) => (
            <option key={p} value={p}>
              {p}*
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">All outcomes</option>
          {["SUCCESS", "FAILURE", "DENIED", "BLOCKED", "INFO"].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
        <Input aria-label="Filter by mission id" placeholder="Mission id" value={missionId} onChange={(e) => setMissionId(e.target.value.trim())} />
        <Input aria-label="From time" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input aria-label="To time" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <ErrorState error={error} retry={() => mutate()} />
      <Panel>
        {isLoading && !data ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </div>
        ) : data && data.events.length === 0 ? (
          <EmptyState title="No events match these filters" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-3 py-2">Seq</th>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">State · decision</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Mission</th>
                  <th className="px-3 py-2">Hash</th>
                </tr>
              </thead>
              <tbody>
                {data?.events.filter((e) => matches(e, q)).map((e) => (
                  <Fragment key={e.id}>
                    <tr className="cursor-pointer border-b border-line/50 hover:bg-elevated/40" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="px-3 py-1.5 font-mono text-muted">
                        <button className="hover:text-fg" aria-expanded={open === e.id} aria-label={`Toggle details for event ${e.seq}`}>
                          {e.seq}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-muted">{formatTime(e.createdAt)}</td>
                      <td className="px-3 py-1.5 font-mono">{e.eventType}</td>
                      <td className="px-3 py-1.5 font-mono text-muted">{e.actor}</td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={e.outcome} />
                      </td>
                      <td className="max-w-[260px] px-3 py-1.5">
                        <StateCell metadata={e.metadata} />
                      </td>
                      <td className="px-3 py-1.5">
                        <ModeBadge mode={e.mode} />
                      </td>
                      <td className="px-3 py-1.5">
                        {e.missionId ? (
                          <span className="flex items-center gap-2">
                            <Link href={`/missions/${e.missionId}`} className="font-mono text-cyan hover:underline" onClick={(ev) => ev.stopPropagation()}>
                              {e.missionId.slice(0, 10)}…
                            </Link>
                            <Link href={`/missions/${e.missionId}#replay`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint hover:text-fg" onClick={(ev) => ev.stopPropagation()} aria-label={`Replay mission ${e.missionId}`}>
                              replay
                            </Link>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-muted" title={e.hash}>
                        {e.hash.slice(0, 10)}…
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr className="border-b border-line bg-bg/60">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid gap-3 lg:grid-cols-2">
                            <pre className="max-h-64 overflow-auto rounded bg-bg-2 p-2 font-mono text-[11px] text-muted">{JSON.stringify(e.metadata, null, 2)}</pre>
                            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                              <dt className="text-muted">resource</dt>
                              <dd className="break-all">{e.resource}</dd>
                              <dt className="text-muted">correlation</dt>
                              <dd className="break-all">{e.correlationId}</dd>
                              <dt className="text-muted">schema</dt>
                              <dd>v{e.schemaVersion}</dd>
                              <dt className="flex items-center gap-1 text-muted">
                                <Link2 className="h-3 w-3" aria-hidden />
                                prevHash
                              </dt>
                              <dd className="break-all">{e.prevHash}</dd>
                              <dt className="text-muted">hash</dt>
                              <dd className="break-all">{e.hash}</dd>
                            </dl>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

type Meta = Record<string, unknown>;
const metaOf = (m: unknown): Meta => (m && typeof m === "object" ? (m as Meta) : {});

function matches(e: { eventType: string; actor: string; metadata: unknown }, q: string): boolean {
  if (!q.trim()) return true;
  const hay = `${e.eventType} ${e.actor} ${JSON.stringify(e.metadata ?? {})}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

/** Before → after state, policy decision and reason, when the event recorded them. */
function StateCell({ metadata }: { metadata: unknown }) {
  const m = metaOf(metadata);
  const from = typeof m.from === "string" ? m.from : null;
  const to = typeof m.to === "string" ? m.to : null;
  const decision = typeof m.decision === "string" ? m.decision : null;
  const reason = typeof m.reason === "string" ? m.reason : null;
  if (!from && !to && !decision && !reason) return <span className="text-faint">—</span>;
  return (
    <span className="block">
      {(from || to) && (
        <span className="block font-mono text-[11px]">
          <span className="text-faint">{from ?? "·"}</span> <span className="text-faint">→</span> <span className="text-fg/90">{to ?? "·"}</span>
        </span>
      )}
      {decision && <span className="block font-mono text-[10.5px] text-warning">{decision.replace(/_/g, " ")}</span>}
      {reason && (
        <span className="block truncate text-[11px] text-muted" title={reason}>
          {reason}
        </span>
      )}
    </span>
  );
}
