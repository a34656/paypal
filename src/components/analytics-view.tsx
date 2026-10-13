"use client";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody, PanelHeader, Stat } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/states";
import { cn } from "@/lib/client/cn";

/** Categorical slots validated (CVD + normal-vision + contrast) against the #090D14 chart surface. */
const SERIES = ["#3987e5", "#d95926", "#199e70"] as const;
const STATUS = { LOW: "#43D9A3", MEDIUM: "#F4BB61", HIGH: "#FF8A5C", CRITICAL: "#FF647C" } as const;
const AXIS = { stroke: "#263347", tick: { fill: "#8B9AAF", fontSize: 11 } };

interface ModeStats {
  missions: number;
  outcomes: Record<string, number>;
  proposedMinor: number;
  approvedMinor: number;
  capturedMinor: number;
  blocked: number;
  pendingApprovals: number;
  spendByCategory: Record<string, number>;
}
interface Analytics {
  currency: string;
  byMode: Record<"DEMO" | "SANDBOX" | "LIVE", ModeStats>;
  riskDistribution: Record<string, number>;
  agentActivity: Record<string, { completed: number; failed: number; running: number }>;
  sources: Record<string, string>;
}

function ChartPanel({ title, source, children, table }: { title: string; source: string; children: ReactNode; table: { head: string[]; rows: (string | number)[][] } }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Panel>
      <PanelHeader
        title={title}
        subtitle={<span>Source: {source}</span>}
        actions={
          <button onClick={() => setAsTable((t) => !t)} className="text-xs text-cyan hover:underline" aria-pressed={asTable}>
            {asTable ? "View chart" : "View table"}
          </button>
        }
      />
      <PanelBody>
        {asTable ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                {table.head.map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-line/50">
                  {r.map((c, j) => (
                    <td key={j} className={cn("py-1.5 pr-3", j > 0 && "font-mono tabular-nums")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="h-64">{children}</div>
        )}
      </PanelBody>
    </Panel>
  );
}

const tooltipStyle = { contentStyle: { background: "#0D1420", border: "1px solid #263347", borderRadius: 6, fontSize: 12, color: "#F3F7FB" }, labelStyle: { color: "#F3F7FB" }, itemStyle: { color: "#F3F7FB" }, cursor: { fill: "rgba(86,224,240,0.06)" } };

export function AnalyticsView() {
  const { data, error, isLoading, mutate } = useApi<Analytics>("/api/analytics", { refreshInterval: 15_000 });
  const [mode, setMode] = useState<"DEMO" | "SANDBOX">("DEMO");
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (isLoading || !data) return <Spinner />;

  const m = data.byMode[mode];
  const cur = data.currency;
  const major = (minor: number) => minor / 100; // chart axis only; labels use formatMoney
  const spend = [
    { name: "Proposed", value: m.proposedMinor },
    { name: "Approved", value: m.approvedMinor },
    { name: "Captured", value: m.capturedMinor },
  ];
  const outcomes = Object.entries(m.outcomes).map(([k, v]) => ({ name: k.replace(/_/g, " ").toLowerCase(), value: v }));
  const risk = (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((k) => ({ name: k.toLowerCase(), key: k, value: data.riskDistribution[k] ?? 0 }));
  const agents = Object.entries(data.agentActivity).map(([k, v]) => ({ name: k, ...v }));
  const categories = Object.entries(m.spendByCategory).map(([k, v]) => ({ name: k, value: v }));
  const capturedLabel = mode === "DEMO" ? "Simulated captures (no money moved)" : "PayPal Sandbox captures (test money)";

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Insight"
        title="Analytics"
        subtitle="Every figure is labelled with its source. Demo (simulated) and PayPal Sandbox volumes are shown separately and never added together."
        actions={
          <div role="radiogroup" aria-label="Data mode" className="flex rounded-md border border-line-strong p-0.5">
            {(["DEMO", "SANDBOX"] as const).map((k) => (
              <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)} className={cn("rounded px-3 py-1 text-xs", mode === k ? "bg-cyan/15 text-cyan" : "text-muted hover:text-fg")}>
                {k === "DEMO" ? "Demo (simulated)" : "PayPal Sandbox"}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex items-center gap-2 text-xs text-muted">
        <Badge tone={mode === "DEMO" ? "purple" : "blue"}>{mode === "DEMO" ? "Simulated data" : "Sandbox data"}</Badge>
        {mode === "DEMO" ? "Simulated volume is not money processed." : "Sandbox volume is PayPal test money, not real funds."}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Missions", m.missions, "default"],
          ["Pending approvals", m.pendingApprovals, m.pendingApprovals ? "warning" : "default"],
          ["Blocked", m.blocked, m.blocked ? "critical" : "default"],
          ["Approved spend", formatMoney(m.approvedMinor, cur), "cyan"],
          [capturedLabel, formatMoney(m.capturedMinor, cur), "success"],
        ].map(([label, value, tone]) => (
          <Panel key={label as string}>
            <PanelBody>
              <Stat label={label as string} value={value as ReactNode} tone={tone as "default"} />
            </PanelBody>
          </Panel>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartPanel title="Proposed vs approved vs captured" source={`${mode === "DEMO" ? "simulated" : "PayPal Sandbox"} records, ${cur}`} table={{ head: ["Stage", "Amount"], rows: spend.map((s) => [s.name, formatMoney(s.value, cur)]) }}>
          <ResponsiveContainer>
            <BarChart data={spend.map((s) => ({ ...s, major: major(s.value) }))} barCategoryGap="30%">
              <CartesianGrid stroke="#1A2433" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} width={70} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
              <Tooltip {...tooltipStyle} formatter={(_v, _n, p) => [formatMoney((p.payload as { value: number }).value, cur), "Amount"]} />
              <Bar dataKey="major" name="Amount" fill={SERIES[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Mission outcomes" source="recorded events (derived status)" table={{ head: ["Outcome", "Missions"], rows: outcomes.map((o) => [o.name, o.value]) }}>
          {outcomes.length === 0 ? (
            <p className="text-sm text-muted">No missions in this mode yet.</p>
          ) : (
            <ResponsiveContainer>
              <BarChart data={outcomes} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid stroke="#1A2433" horizontal={false} />
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis type="category" dataKey="name" width={130} {...AXIS} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="value" name="Missions" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Risk distribution of evaluated offers" source="deterministic risk engine over demo evidence (all modes)" table={{ head: ["Risk level", "Offers"], rows: risk.map((r) => [r.name, r.value]) }}>
          <ResponsiveContainer>
            <BarChart data={risk}>
              <CartesianGrid stroke="#1A2433" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} width={40} />
              <Tooltip {...tooltipStyle} />
              {/* Status colours carry the level, and the axis label names it (never colour alone). */}
              <Bar dataKey="value" name="Offers" radius={[4, 4, 0, 0]} shape={(props: unknown) => {
                const p = props as { x: number; y: number; width: number; height: number; payload: { key: keyof typeof STATUS } };
                return <rect x={p.x} y={p.y} width={p.width} height={Math.max(0, p.height)} rx={3} fill={STATUS[p.payload.key]} />;
              }} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Agent activity" source="AgentRun records (all modes)" table={{ head: ["Agent", "Completed", "Failed", "Running"], rows: agents.map((a) => [a.name, a.completed, a.failed, a.running]) }}>
          {agents.length === 0 ? (
            <p className="text-sm text-muted">No agent runs yet.</p>
          ) : (
            <ResponsiveContainer>
              <BarChart data={agents}>
                <CartesianGrid stroke="#1A2433" vertical={false} />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis allowDecimals={false} {...AXIS} width={40} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11, color: "#8B9AAF" }} />
                <Bar dataKey="completed" name="Completed" stackId="a" fill={SERIES[0]} stroke="#090D14" strokeWidth={2} />
                <Bar dataKey="failed" name="Failed (retried or final)" stackId="a" fill={SERIES[1]} stroke="#090D14" strokeWidth={2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <ChartPanel title="Captured spend by category" source={`${mode === "DEMO" ? "simulated captures" : "PayPal Sandbox captures"}, ${cur}`} table={{ head: ["Category", "Amount"], rows: categories.map((c) => [c.name, formatMoney(c.value, cur)]) }}>
          {categories.length === 0 ? (
            <p className="text-sm text-muted">No captured spend in this mode yet.</p>
          ) : (
            <ResponsiveContainer>
              <BarChart data={categories.map((c) => ({ ...c, major: major(c.value) }))}>
                <CartesianGrid stroke="#1A2433" vertical={false} />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis {...AXIS} width={70} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip {...tooltipStyle} formatter={(_v, _n, p) => [formatMoney((p.payload as { value: number }).value, cur), "Captured"]} />
                <Bar dataKey="major" name="Captured" fill={SERIES[2]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        <Panel>
          <PanelHeader title="Simulated vs Sandbox volume" subtitle="Side by side, never summed" />
          <PanelBody className="grid grid-cols-2 gap-4">
            <Stat label="Demo · simulated captures" value={formatMoney(data.byMode.DEMO.capturedMinor, cur)} hint="No money moved" />
            <Stat label="PayPal Sandbox captures" value={formatMoney(data.byMode.SANDBOX.capturedMinor, cur)} hint="Sandbox test money" />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
