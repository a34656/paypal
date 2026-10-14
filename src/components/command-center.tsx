"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Plus, X } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { formatMoney } from "@/lib/money";
import { relTime } from "@/lib/client/format";
import { cn } from "@/lib/client/cn";
import { reduceEvents, type MissionEvent } from "@/domain/viewmodel/reducer";
import { PageHeader } from "@/components/shell/page-header";
import { ModeIndicator } from "@/components/shell/mode-indicator";
import type { SessionInfo } from "@/components/shell/identity-menu";
import { Panel, PanelBody, PanelHeader, Stat } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { NetworkView } from "@/components/three/network-view";
import { MissionComposer } from "@/components/mission/mission-composer";
import { ApprovalPanel } from "@/components/mission/approval-panel";
import { ItemizedTotal, RiskSummary } from "@/components/mission/purchase-summary";
import type { MissionRow } from "@/components/mission/missions-list";
import type { MissionDetailDTO } from "@/components/mission/types";

interface AuditRow {
  id: string;
  seq: number;
  missionId: string | null;
  actor: string;
  eventType: string;
  outcome: string;
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
interface ModeStats {
  missions: number;
  proposedMinor: number;
  approvedMinor: number;
  capturedMinor: number;
  heldMinor: number;
  refundedMinor: number;
  budgetMinor: number;
}
interface Analytics {
  currency: string;
  byMode: Record<string, ModeStats>;
}
interface AgentsResp {
  agents: { id: string; name: string; status: string; tasksCompleted: number; failures: number; lastActivity: string | null }[];
}
interface PolicyResp {
  current: { version: number; configuration: { maxPurchaseMinor: number; approvalThresholdMinor: number; minTrustScore: number; costAllowancePct: number; currency: string; trustedSellerDomains: string[]; blockUnverifiedSellers: boolean } };
}
interface PayPalCfg {
  mode: string;
  paypalConnected: boolean;
  publicClientId: string | null;
  clientIdMismatch: boolean;
}

const ACTIVE = ["CONFIRMED", "SCOUTING", "SCOUTED", "RISK_ANALYSIS", "OPTIMIZING", "POLICY_EVALUATION"];

export function CommandCenter({ scenario }: { scenario?: string }) {
  const missions = useApi<{ items: MissionRow[] }>("/api/missions?take=100", { refreshInterval: 5000 });
  const audit = useApi<{ events: AuditRow[] }>("/api/audit?take=40", { refreshInterval: 5000 });
  const tx = useApi<{ rows: TxRow[] }>("/api/transactions", { refreshInterval: 10000 });
  const analytics = useApi<Analytics>("/api/analytics", { refreshInterval: 15000 });
  const agents = useApi<AgentsResp>("/api/agents", { refreshInterval: 5000 });
  const policy = useApi<PolicyResp>("/api/policies");
  const paypal = useApi<PayPalCfg>("/api/paypal/config");
  const { data: session } = useApi<SessionInfo>("/api/session");
  const [composerOpen, setComposerOpen] = useState(!!scenario);
  const [picked, setPicked] = useState<string | null>(null);

  const items = useMemo(() => missions.data?.items ?? [], [missions.data]);
  const latestActivity = audit.data?.events.find((e) => e.missionId)?.missionId ?? null;
  const focusId = picked ?? latestActivity ?? items[0]?.id ?? null;
  const detail = useApi<MissionDetailDTO>(focusId ? `/api/missions/${focusId}` : null, {
    refreshInterval: (d) => (d && ACTIVE.includes(d.mission.status) ? 1500 : 5000),
  });
  const events = useApi<{ events: MissionEvent[] }>(focusId ? `/api/missions/${focusId}/events` : null, {
    refreshInterval: () => (detail.data && ACTIVE.includes(detail.data.mission.status) ? 1500 : 5000),
  });
  const vm = useMemo(() => (events.data ? reduceEvents(events.data.events) : null), [events.data]);

  const pending = items.filter((m) => m.displayStatus === "AWAITING_APPROVAL");
  const blocked = items.filter((m) => m.displayStatus === "BLOCKED").length;
  const completed = items.filter((m) => ["COMPLETED", "REFUNDED"].includes(m.displayStatus)).length;
  const mode = session?.mode ?? "DEMO";
  const stats = analytics.data?.byMode[mode];
  const markers = (detail.data?.products ?? []).map((p) => ({ id: p.id, label: p.product.title, decision: p.policyDecision, rank: p.recommendationRank, risk: p.riskScore, coverage: p.evidenceCoverage }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Command Center"
        title="Autonomous commerce, under control."
        subtitle="Watch the bounded agents work on real mission events, and act on the decisions that need a human."
        actions={
          <>
            <ModeIndicator mode={session?.mode} />
            <Button variant="primary" onClick={() => setComposerOpen(true)} aria-haspopup="dialog">
              <Plus className="h-4 w-4" aria-hidden /> Create mission
            </Button>
          </>
        }
      />

      {/* Mission focus strip */}
      {items.length > 0 && (
        <nav aria-label="Focus a mission" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {items.slice(0, 12).map((m) => (
            <button
              key={m.id}
              onClick={() => setPicked(m.id)}
              aria-pressed={focusId === m.id}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-[4px] border px-3 py-1.5 text-left text-xs transition-colors",
                focusId === m.id ? "border-cyan/45 bg-cyan/[0.06] text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              <span className="max-w-[220px] truncate">{m.title}</span>
              <StatusBadge status={m.displayStatus} />
            </button>
          ))}
        </nav>
      )}

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <NetworkView
            vm={vm}
            products={markers}
            height="h-[340px] md:h-[460px]"
            caption={
              detail.data ? (
                <Link href={`/missions/${detail.data.mission.id}`} className="pointer-events-auto rounded-[3px] bg-bg/70 px-1.5 py-0.5 hover:text-fg">
                  {detail.data.mission.title} · {vm?.eventCount ?? 0} recorded events
                </Link>
              ) : (
                "No mission yet — create one to see the agents work."
              )
            }
          />
          {focusId ? <MissionWorkspace detail={detail.data} error={detail.error} session={session} onChange={() => void detail.mutate()} /> : <FirstMission onCreate={() => setComposerOpen(true)} />}
        </div>

        <aside className="space-y-5 xl:col-span-4" aria-label="Operations">
          <Panel>
            <PanelBody className="grid grid-cols-2 gap-x-4 gap-y-5">
              <Stat label="Missions" value={items.length} />
              <Stat label="Awaiting approval" value={pending.length} tone={pending.length ? "warning" : "default"} />
              <Stat label="Blocked" value={blocked} tone={blocked ? "critical" : "default"} />
              <Stat label="Completed" value={completed} tone="success" />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Budget utilization" subtitle={`${mode === "DEMO" ? "Simulated" : mode === "SANDBOX" ? "PayPal Sandbox" : "Live"} missions · USD`} />
            <PanelBody>
              {!stats ? <Skeleton className="h-16" /> : <BudgetBars stats={stats} currency={analytics.data?.currency ?? "USD"} />}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Policy state" actions={<Link href="/policies" className="text-[11px] text-cyan hover:underline">Edit</Link>} />
            <PanelBody>
              {!policy.data ? (
                <Skeleton className="h-16" />
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <Kv k="Version" v={`v${policy.data.current.version}`} />
                  <Kv k="Max purchase" v={formatMoney(policy.data.current.configuration.maxPurchaseMinor, policy.data.current.configuration.currency)} />
                  <Kv k="Approval above" v={formatMoney(policy.data.current.configuration.approvalThresholdMinor, policy.data.current.configuration.currency)} />
                  <Kv k="Min trust" v={String(policy.data.current.configuration.minTrustScore)} />
                  <Kv k="Cap allowance" v={`${policy.data.current.configuration.costAllowancePct}%`} />
                  <Kv k="Trusted retailers" v={String(policy.data.current.configuration.trustedSellerDomains.length)} />
                </dl>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="PayPal" />
            <PanelBody className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted">Environment</span>
                <ModeIndicator mode={paypal.data?.mode as SessionInfo["mode"] | undefined} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Server credentials</span>
                <span className={cn("font-mono", paypal.data?.paypalConnected ? "text-success" : "text-purple")}>{paypal.data ? (paypal.data.paypalConnected ? "CONNECTED" : "NOT SET · SIMULATED") : "…"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">Checkout button</span>
                <span className={cn("font-mono", paypal.data?.publicClientId && !paypal.data.clientIdMismatch ? "text-success" : "text-warning")}>
                  {paypal.data ? (paypal.data.clientIdMismatch ? "CLIENT ID MISMATCH" : paypal.data.publicClientId ? "READY" : paypal.data.paypalConnected ? "MISSING ID" : "SIMULATED") : "…"}
                </span>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Agent activity" actions={<Link href="/agents" className="text-[11px] text-cyan hover:underline">Details</Link>} />
            <ul className="divide-y divide-line/70">
              {(agents.data?.agents ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span className="flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 rounded-full", a.status === "RUNNING" ? "animate-aegis-pulse bg-cyan" : a.failures > 0 ? "bg-warning" : "bg-faint")} aria-hidden />
                    {a.name}
                  </span>
                  <span className="font-mono text-[11px] text-faint">
                    {a.status === "RUNNING" ? <span className="text-cyan">RUNNING</span> : `${a.tasksCompleted} done${a.failures ? ` · ${a.failures} failed` : ""}`}
                  </span>
                </li>
              ))}
              {!agents.data && (
                <li className="p-4">
                  <Skeleton className="h-16" />
                </li>
              )}
            </ul>
          </Panel>
        </aside>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <PanelHeader title="Pending approvals" />
          {pending.length === 0 ? (
            <EmptyState title="Nothing waiting on you" body="Purchases that policy routes to a human appear here." />
          ) : (
            <ul className="divide-y divide-line/70">
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
          <PanelHeader
            title="Recent transactions"
            actions={
              <Link href="/transactions" className="text-[11px] text-cyan hover:underline">
                All
              </Link>
            }
          />
          {tx.data && tx.data.rows.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <ul className="divide-y divide-line/70">
              {tx.data?.rows.slice(0, 7).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0">
                    <Link href={`/missions/${r.missionId}`} className="block truncate hover:text-cyan">
                      {r.missionTitle}
                    </Link>
                    <span className="mt-1 flex items-center gap-1">
                      <StatusBadge status={r.status} />
                      <ModeBadge mode={r.mode} simulated={r.simulated} />
                    </span>
                  </span>
                  <span className="shrink-0 font-mono">{formatMoney(r.amountMinor, r.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Audit stream"
            actions={
              <Link href="/audit" className="text-[11px] text-cyan hover:underline">
                Open
              </Link>
            }
          />
          <ErrorState error={audit.error} />
          {audit.data && audit.data.events.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="max-h-[300px] divide-y divide-line/70 overflow-y-auto">
              {audit.data?.events.slice(0, 20).map((e) => (
                <li key={e.id} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-fg/90">{e.eventType}</span>
                    <span className="block truncate text-faint">{e.actor}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <StatusBadge status={e.outcome} />
                    <span className="font-mono text-[10px] text-faint">{relTime(e.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <ComposerDrawer open={composerOpen} onClose={() => setComposerOpen(false)} scenario={scenario} />
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="tech-label !text-[9.5px] !text-faint">{k}</dt>
      <dd className="mt-1 font-mono text-[13px] tabular-nums">{v}</dd>
    </div>
  );
}

function BudgetBars({ stats, currency }: { stats: ModeStats; currency: string }) {
  const budget = stats.budgetMinor;
  if (budget === 0) return <p className="text-xs text-muted">No confirmed mission budgets yet.</p>;
  const rows: [string, number, string][] = [
    ["Recommended", stats.proposedMinor, "bg-blue/70"],
    ["Approved", stats.approvedMinor, "bg-warning/80"],
    ["On hold", stats.heldMinor, "bg-cyan/70"],
    ["Captured", stats.capturedMinor, "bg-success"],
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="tech-label">Confirmed budgets</span>
        <span className="font-mono text-sm tabular-nums">{formatMoney(budget, currency)}</span>
      </div>
      {rows.map(([label, v, cls]) => (
        <div key={label}>
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-muted">{label}</span>
            <span className="font-mono tabular-nums text-fg/85">
              {formatMoney(v, currency)} <span className="text-faint">· {Math.round((v / budget) * 100)}%</span>
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line" role="presentation">
            <div className={cn("h-full rounded-full", cls)} style={{ width: `${Math.min(100, (v / budget) * 100)}%` }} />
          </div>
        </div>
      ))}
      {stats.refundedMinor > 0 && <p className="text-[11px] text-faint">Refunded: {formatMoney(stats.refundedMinor, currency)}</p>}
    </div>
  );
}

function FirstMission({ onCreate }: { onCreate: () => void }) {
  return (
    <Panel>
      <EmptyState
        title="No missions yet"
        body="Describe a purchase. The agents search real retailer offers, score the evidence and route the decision — you approve before anything is paid."
        action={
          <Button variant="primary" onClick={onCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Create your first mission
          </Button>
        }
      />
    </Panel>
  );
}

/** The focused mission: brief, recommendation, risk, policy, approval and payment — all server data. */
function MissionWorkspace({ detail, error, session, onChange }: { detail: MissionDetailDTO | undefined; error: unknown; session: SessionInfo | undefined; onChange: () => void }) {
  if (error) return <ErrorState error={error as { message: string }} />;
  if (!detail)
    return (
      <Panel>
        <PanelBody>
          <Skeleton className="h-40" />
        </PanelBody>
      </Panel>
    );
  const { mission, products, approvals, payments } = detail;
  const currency = mission.currency ?? "USD";
  const rec = products.find((p) => p.productId === mission.recommendedProductId) ?? null;
  const firstBlock = rec?.policyResult?.checks.find((c) => c.result !== "PASS");
  const live = payments[0] ?? null;
  const decisionNeeded = (mission.status === "AWAITING_APPROVAL" || mission.status === "READY_FOR_CHECKOUT") && !!mission.decision;

  return (
    <Panel>
      <PanelHeader
        title="Mission workspace"
        subtitle={<span className="font-mono">{mission.id}</span>}
        actions={
          <Link href={`/missions/${mission.id}`} className="inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
            Open mission <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        }
      />
      <div className="grid gap-px bg-line md:grid-cols-3">
        <section className="bg-bg-2 p-4" aria-label="Mission brief">
          <p className="tech-label">Brief</p>
          <h3 className="mt-2 text-[15px] leading-snug">{mission.title}</h3>
          <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">“{mission.rawInputText}”</p>
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <Kv k="Budget" v={formatMoney(mission.budgetMinor, currency)} />
            <Kv k="Quantity" v={String(mission.quantity ?? "—")} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            <StatusBadge status={mission.displayStatus} />
            <ModeBadge mode={mission.mode} />
          </div>
        </section>
        <section className="bg-bg-2 p-4" aria-label="Recommendation">
          <p className="tech-label">Recommendation</p>
          {rec ? (
            <>
              <h3 className="mt-2 line-clamp-2 text-[13px] leading-snug">{rec.product.title}</h3>
              <p className="mt-1 text-[11px] text-faint">
                {rec.product.sellerName ?? "undisclosed seller"} · {rec.product.isDemoData ? "demo data" : rec.product.provider}
              </p>
              <ItemizedTotal mp={rec} currency={currency} className="mt-3" />
            </>
          ) : (
            <p className="mt-2 text-xs text-muted">{products.length ? "No eligible offer. Every candidate was blocked or failed a requirement." : "No candidates yet."}</p>
          )}
        </section>
        <section className="bg-bg-2 p-4" aria-label="Risk and policy">
          {rec ? <RiskSummary mp={rec} limit={3} /> : <p className="tech-label">Risk</p>}
          <div className="mt-4 border-t border-line pt-3">
            <p className="tech-label">Policy decision</p>
            <div className="mt-2">{mission.decision ? <StatusBadge status={mission.decision} /> : <span className="text-xs text-muted">Pending</span>}</div>
            {firstBlock && <p className="mt-2 text-[11px] leading-relaxed text-muted">{firstBlock.detail}</p>}
          </div>
        </section>
      </div>
      {(decisionNeeded || live) && (
        <div className="grid gap-px border-t border-line bg-line md:grid-cols-2">
          <section className="bg-bg-2 p-4" aria-label="Human approval">
            <p className="tech-label mb-3">Human approval</p>
            <ApprovalPanel mission={mission} recommended={rec} approvals={approvals} isApprover={session?.user.roles.includes("APPROVER") ?? false} onChange={onChange} compact />
          </section>
          <section className="bg-bg-2 p-4" aria-label="Payment status">
            <p className="tech-label mb-3">Payment</p>
            {live ? (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <StatusBadge status={live.status} />
                  <span className="font-mono text-sm">{formatMoney(live.settledMinor ?? live.amountMinor, live.currency)}</span>
                </div>
                <p className="font-mono text-[11px] text-faint">{live.providerOrderId ?? "no provider order yet"}</p>
                <ModeBadge mode={live.mode} simulated={live.provider === "simulated"} />
              </div>
            ) : (
              <p className="text-xs text-muted">Checkout opens after approval.</p>
            )}
            <Link href={`/missions/${mission.id}#payment`} className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan hover:underline">
              Checkout & payment controls <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </section>
        </div>
      )}
    </Panel>
  );
}

function ComposerDrawer({ open, onClose, scenario }: { open: boolean; onClose: () => void; scenario?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("input,textarea,select,button")?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>("a,button,input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter((el) => !el.hasAttribute("disabled"));
        if (f.length === 0) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0].focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-title"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-line-strong bg-bg-2/95 backdrop-blur-xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div>
                <p className="tech-label !text-cyan">Create mission</p>
                <h2 id="composer-title" className="mt-1 text-lg">
                  What should the agents buy?
                </h2>
              </div>
              <button onClick={onClose} className="rounded p-1.5 text-muted hover:text-fg" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <MissionComposer initialScenario={scenario} compact />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
