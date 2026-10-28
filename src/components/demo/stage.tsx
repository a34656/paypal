"use client";
import { useState } from "react";
import { motion } from "motion/react";
import { Ban, CheckCircle2, ChevronDown, CircleDashed, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/client/cn";
import { useDemo } from "./controller";
import type { DemoCheck, DemoEvaluation, DemoOffer, StageView } from "./types";

const money = (m: number | null | undefined) => formatMoney(m ?? null, "USD");
const fictional = (s: string | null) => (s ?? "Unknown seller").replace(" (fictional)", "");

const DECISION_TONE = {
  ALLOW_CHECKOUT: "text-success border-success/40",
  REQUIRE_APPROVAL: "text-warning border-warning/40",
  BLOCK: "text-critical border-critical/40",
} as const;

function Decision({ d }: { d: DemoOffer["policy"]["decision"] }) {
  return <span className={cn("rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em]", DECISION_TONE[d])}>{d.replace(/_/g, " ")}</span>;
}

function Provenance({ kind }: { kind: "engine" | "simulated" }) {
  return kind === "engine" ? (
    <p className="font-mono text-[10px] tracking-[0.14em] text-purple">FICTIONAL OFFERS · RESULTS COMPUTED BY VANTA&apos;S REAL ENGINES · NOTHING SAVED</p>
  ) : (
    <p className="font-mono text-[10px] tracking-[0.14em] text-purple">SIMULATION · NOT EXECUTED · NOTHING RECORDED</p>
  );
}

const TITLES: Record<StageView, string> = {
  offers: "Scout & Optimizer",
  risk: "Risk assessment",
  policy: "Policy Guard",
  approval: "Approval request",
  payment: "Payment workflow",
  audit: "What the audit log would record",
};

export function DemoStage() {
  const demo = useDemo();
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  const view = demo?.ui.stage ?? null;
  const e = demo?.ui.evaluation ?? null;
  if (!demo || !view || hiddenFor === `${demo.state.runId}-${view}`) return null;
  const branch = demo.state.decisions["approval-branch"] ?? null;

  return (
    <motion.section
      key={view}
      initial={demo.reducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: demo.reducedMotion ? 0.1 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      aria-label={`Walkthrough: ${TITLES[view]}`}
      className="fixed inset-x-3 top-16 z-[75] max-h-[46vh] overflow-y-auto rounded-[8px] border border-line-strong bg-bg/95 shadow-2xl backdrop-blur-md md:left-6 md:right-[452px] md:top-20 md:max-h-[calc(100vh-7rem)] md:max-w-3xl"
    >
      <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-bg/95 px-5 py-3">
        <div>
          <h2 className="text-[15px] font-medium tracking-tight">{TITLES[view]}</h2>
          <div className="mt-1">
            <Provenance kind={view === "offers" || view === "risk" || view === "policy" ? "engine" : "simulated"} />
          </div>
        </div>
        <button type="button" onClick={() => setHiddenFor(`${demo.state.runId}-${view}`)} aria-label="Hide this panel" className="rounded p-1 text-muted hover:text-fg">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>
      <div className="p-5">
        {!e && view !== "audit" ? (
          <p className="text-sm text-muted">Loading the evaluation…</p>
        ) : view === "offers" ? (
          <OffersView e={e!} reduced={demo.reducedMotion} />
        ) : view === "risk" ? (
          <RiskView e={e!} reduced={demo.reducedMotion} />
        ) : view === "policy" ? (
          <PolicyView e={e!} reduced={demo.reducedMotion} />
        ) : view === "approval" ? (
          <DemoApprovalCard e={e!} branch={branch} />
        ) : view === "payment" ? (
          <PaymentView e={e!} branch={branch} />
        ) : (
          <AuditView e={e} branch={branch} />
        )}
      </div>
    </motion.section>
  );
}

const stagger = (i: number, reduced: boolean) => ({
  initial: reduced ? { opacity: 0 } : { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
  transition: { delay: reduced ? 0 : 0.25 + i * 0.18, duration: 0.35 },
});

function OffersView({ e, reduced }: { e: DemoEvaluation; reduced: boolean }) {
  const rec = e.offers.find((o) => o.key === e.recommendedKey);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Task: {e.mission.quantity} × {e.mission.title.toLowerCase()} · budget {money(e.mission.budgetMinor)} · within {e.mission.deadlineDays} days
      </p>
      <ul className="divide-y divide-line rounded-[6px] border border-line">
        {e.offers.map((o, i) => (
          <motion.li key={o.key} {...stagger(i, reduced)} className={cn("grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center", o.key === e.recommendedKey && "bg-cyan/[0.06]")}>
            <div className="min-w-0">
              <p className="truncate text-[14px] text-fg">
                {o.title} <span className="text-muted">· {fictional(o.seller)}</span>
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                {o.amounts ? `${o.amounts.basis === "CAP" ? "cap " : ""}${money(o.amounts.totalMinor)} all-in` : "total unknown"} · {o.shippingEstimateDays ?? "?"} days · seller {o.sellerVerification.toLowerCase()}
              </p>
            </div>
            <p className={cn("font-mono text-[11px]", o.optimizer.eligible ? "text-cyan" : "text-warning")}>{o.optimizer.eligible ? `RANK #${o.optimizer.rank}` : `INELIGIBLE — ${o.optimizer.ineligibleReasons[0]?.toLowerCase() ?? ""}`}</p>
          </motion.li>
        ))}
      </ul>
      {rec && (
        <div className="rounded-[6px] border border-cyan/30 bg-cyan/[0.04] p-4">
          <p className="tech-label !text-cyan">Why Optimizer chose it</p>
          <p className="mt-2 text-sm leading-relaxed text-fg/90">{rec.optimizer.explanation}</p>
        </div>
      )}
    </div>
  );
}

function RiskView({ e, reduced }: { e: DemoEvaluation; reduced: boolean }) {
  return (
    <ul className="space-y-3">
      {e.offers.map((o, i) => {
        const concerns = o.risk.factors.filter((f) => f.status !== "OK");
        return (
          <motion.li key={o.key} {...stagger(i, reduced)} className="rounded-[6px] border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[14px]">{fictional(o.seller)}</p>
              <p className="font-mono text-[11px] text-muted">
                risk <span className={o.risk.score > 35 ? "text-warning" : "text-success"}>{o.risk.score}</span>/100 · {o.risk.level.toLowerCase()} · evidence {o.risk.evidenceCoverage}%
              </p>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded bg-line" aria-hidden>
              <motion.div className={cn("h-full", o.risk.score > 35 ? "bg-warning" : "bg-success")} initial={{ width: 0 }} animate={{ width: `${Math.max(2, o.risk.score)}%` }} transition={{ delay: reduced ? 0 : 0.3 + i * 0.18, duration: reduced ? 0 : 0.7 }} />
            </div>
            {o.risk.injectionSignals.length > 0 && <p className="mt-2 text-[12.5px] text-critical">Listing text addresses the agent ({o.risk.injectionSignals.join(", ")}). It can never lower a score; policy blocks it.</p>}
            {concerns.length > 0 && (
              <ul className="mt-2 space-y-1">
                {concerns.slice(0, 3).map((f) => (
                  <li key={f.id} className="text-[12.5px] text-muted">
                    <span className="text-warning">{f.label}:</span> {f.evidence}
                  </li>
                ))}
              </ul>
            )}
            {concerns.length === 0 && o.risk.injectionSignals.length === 0 && <p className="mt-2 text-[12.5px] text-muted">All scored evidence present and within range.</p>}
          </motion.li>
        );
      })}
      <li className="text-[11.5px] text-faint">Deterministic, rule-based scores (0 = lowest risk) — not a machine-learning prediction.</li>
    </ul>
  );
}

function CheckRow({ c }: { c: DemoCheck }) {
  const Icon = c.result === "PASS" ? CheckCircle2 : c.result === "BLOCK" ? Ban : ShieldAlert;
  return (
    <li className="flex gap-2 text-[12.5px]">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", c.result === "PASS" ? "text-success" : c.result === "BLOCK" ? "text-critical" : "text-warning")} aria-hidden />
      <span>
        <span className="text-fg">{c.label}</span> <span className="text-muted">— {c.detail.replace(/AEGIS/g, "VANTA")}</span>
      </span>
    </li>
  );
}

function PolicyView({ e, reduced }: { e: DemoEvaluation; reduced: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Policy version {e.policy.version}. Each offer runs every check; the most restrictive result becomes its decision.</p>
      {e.offers.map((o, i) => {
        const flagged = o.policy.checks.filter((c) => c.result !== "PASS");
        const passed = o.policy.checks.length - flagged.length;
        return (
          <motion.div key={o.key} {...stagger(i, reduced)} className="rounded-[6px] border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px]">{fictional(o.seller)}</p>
              <Decision d={o.policy.decision} />
            </div>
            <ul className="mt-3 space-y-1.5">
              {flagged.map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
            </ul>
            <button type="button" onClick={() => setOpen(open === o.key ? null : o.key)} aria-expanded={open === o.key} className="mt-2 inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open === o.key && "rotate-180")} aria-hidden /> {passed} checks passed
            </button>
            {open === o.key && (
              <ul className="mt-2 space-y-1.5">
                {o.policy.checks
                  .filter((c) => c.result === "PASS")
                  .map((c) => (
                    <CheckRow key={c.id} c={c} />
                  ))}
              </ul>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/** Explanation of an approval request. Its buttons live in the story panel and only choose a story branch. */
function DemoApprovalCard({ e, branch }: { e: DemoEvaluation; branch: string | null }) {
  const o = e.offers.find((x) => x.key === e.recommendedKey);
  if (!o || !o.amounts) return <p className="text-sm text-muted">No offer survived policy, so there is nothing to authorize.</p>;
  const findings = o.policy.checks.filter((c) => c.result !== "PASS");
  return (
    <div className="space-y-4">
      <dl className="grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-2">
        {[
          ["Amount", `${money(o.amounts.totalMinor)} USD (${o.amounts.basis === "EXACT" ? "exact all-in total" : "spending cap"})`],
          ["Recipient", fictional(o.seller)],
          ["Items", `${e.mission.quantity} × ${o.title}`],
          ["Purpose", e.mission.objective],
          ["Policy decision", o.policy.decision.replace(/_/g, " ")],
          ["Requested permission", `Create one PayPal order for at most ${money(o.amounts.totalMinor)}, valid ${e.policy.approvalTtlMinutes} min`],
        ].map(([k, v]) => (
          <div key={k} className="bg-bg px-4 py-3">
            <dt className="tech-label">{k}</dt>
            <dd className="mt-1 text-[13.5px] text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="tech-label mb-2">Why a person is required</p>
        <ul className="space-y-1.5">
          {findings.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </ul>
      </div>
      {branch ? (
        <p className={cn("flex items-center gap-2 rounded-[6px] border px-4 py-3 text-sm", branch === "approve" ? "border-success/40 text-success" : "border-critical/40 text-critical")}>
          {branch === "approve" ? <ShieldCheck className="h-4 w-4" aria-hidden /> : <Ban className="h-4 w-4" aria-hidden />}
          {branch === "approve" ? "Simulated approval — no approval was recorded." : "Simulated denial — no denial was recorded."}
        </p>
      ) : (
        <p className="rounded-[6px] border border-dashed border-line-strong px-4 py-3 text-[12.5px] text-muted">
          In the real console this panel binds an approval to the exact snapshot above. Here, the story panel only lets you pick which branch to watch.
        </p>
      )}
    </div>
  );
}

function PaymentView({ e, branch }: { e: DemoEvaluation; branch: string | null }) {
  const o = e.offers.find((x) => x.key === e.recommendedKey);
  const steps = ["Server creates the PayPal order from the approved snapshot", "Buyer approves in the PayPal window", "Server verifies amount, currency and IDs", "Capture (or authorization hold)"];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {branch === "deny" ? "Approval was denied (simulated), so the payment workflow never starts." : `Authorization state: simulated approval for at most ${money(o?.amounts?.totalMinor)}.`}
      </p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-3 rounded-[6px] border border-line px-4 py-3 text-[13px]">
            <CircleDashed className="h-4 w-4 shrink-0 text-faint" aria-hidden />
            <span className="flex-1 text-fg/85">
              {i + 1}. {s}
            </span>
            <span className="font-mono text-[10px] tracking-[0.12em] text-faint">{branch === "deny" ? "NOT STARTED" : "NOT EXECUTED"}</span>
          </li>
        ))}
      </ol>
      <p className="rounded-[6px] border border-purple/30 bg-purple/[0.05] px-4 py-3 text-[13px] text-fg/90">No PayPal order was created and no payment was made. Run the walkthrough in live mode to see real Sandbox results.</p>
    </div>
  );
}

function AuditView({ e, branch }: { e: DemoEvaluation | null; branch: string | null }) {
  const rec = e?.offers.find((x) => x.key === e.recommendedKey);
  const events: [string, string][] = [
    ["mission.created", "Task received from the requester"],
    ["mission.parsed", "Plain language turned into proposed constraints"],
    ["mission.confirmed", "Requester confirmed the constraints"],
    ["agent.step_completed", `Scout: ${e?.offers.length ?? 4} offers discovered`],
    ["agent.step_completed", "Risk: every offer scored"],
    ["agent.step_completed", "Optimizer: eligible offers ranked"],
    ["policy.evaluated", `Decision ${e?.decision.replace(/_/g, " ") ?? "—"} for ${fictional(rec?.seller ?? null)}`],
    ...(branch === "deny" ? [["approval.denied", "Approver denied the purchase"] as [string, string]] : branch === "approve" ? [["approval.granted", "Approver approved the exact snapshot"] as [string, string]] : []),
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">These are the event types VANTA writes for a mission like this one. None were written — the real log behind this panel is unchanged.</p>
      <ol className="space-y-1.5 border-l border-line pl-4">
        {events.map(([t, d], i) => (
          <li key={`${t}-${i}`} className="text-[13px]">
            <span className="font-mono text-[11px] text-cyan">{t}</span> <span className="text-muted">— {d}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
