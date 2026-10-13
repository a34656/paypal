"use client";
import Link from "next/link";
import { Bot, Check, X } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { relTime } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody, PanelHeader, Stat } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/states";

interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  permissions: Record<string, boolean | string>;
  tasksCompleted: number;
  failures: number;
  status: string;
  lastActivity: string | null;
  recentEvents: { seq: number; eventType: string; outcome: string; missionId: string | null; createdAt: string }[];
}

export function AgentsView() {
  const { data, error, mutate } = useApi<{ notice: string; agents: Agent[] }>("/api/agents", { refreshInterval: 5000 });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Bounded agent workflow" title="Agents" subtitle={data.notice} />
      <div className="grid gap-4 lg:grid-cols-2">
        {data.agents.map((a) => (
          <Panel key={a.id}>
            <PanelHeader title={a.name} subtitle={a.description} icon={<Bot className="h-4 w-4 text-cyan" />} actions={<StatusBadge status={a.status === "RUNNING" ? "RUNNING" : "QUEUED"} />} />
            <PanelBody className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Tasks completed" value={a.tasksCompleted} />
                <Stat label="Failures" value={a.failures} tone={a.failures ? "warning" : "default"} />
                <Stat label="Last activity" value={<span className="text-sm">{relTime(a.lastActivity)}</span>} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Capabilities</h3>
                  <ul className="space-y-0.5 font-mono text-xs">{a.capabilities.map((c) => <li key={c}>{c}</li>)}</ul>
                  <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">Tool access</h3>
                  <ul className="space-y-0.5 text-xs">{a.tools.map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
                <div>
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Permissions</h3>
                  <ul className="space-y-1 text-xs">
                    {Object.entries(a.permissions).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-2">
                        {v ? <Check className="h-3.5 w-3.5 text-warning" aria-hidden /> : <X className="h-3.5 w-3.5 text-success" aria-hidden />}
                        <span className="capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
                        <span className="text-muted">{v === false ? "— no access" : typeof v === "string" ? `— ${v}` : "— yes"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Recent events</h3>
                {a.recentEvents.length === 0 ? (
                  <p className="text-xs text-muted">No recorded events.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {a.recentEvents.map((e) => (
                      <li key={e.seq} className="flex items-center justify-between gap-2">
                        <span className="font-mono">
                          #{e.seq} {e.eventType}
                        </span>
                        <span className="flex items-center gap-2">
                          {e.missionId && (
                            <Link className="text-cyan hover:underline" href={`/missions/${e.missionId}`}>
                              mission
                            </Link>
                          )}
                          <span className="text-muted">{relTime(e.createdAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </PanelBody>
          </Panel>
        ))}
      </div>
    </div>
  );
}
