"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Clapperboard, Play, RotateCcw, X } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/client/cn";
import { useDemo } from "./controller";
import type { DemoMode } from "./state";

/** Hero call to action: "Show me how VANTA works" opens the mode chooser. */
export function DemoCta({ className }: { className?: string }) {
  const demo = useDemo();
  const [open, setOpen] = useState(false);
  if (!demo) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("group inline-flex h-12 items-center gap-3 rounded-[4px] bg-cyan px-6 text-[15px] font-medium text-bg shadow-[0_0_40px_-12px_rgb(111_227_238/0.9)] transition-colors hover:bg-ice", className)}
      >
        <Play className="h-4 w-4" aria-hidden /> Show me how VANTA works
      </button>
      {open && <ModeDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ModeDialog({ onClose }: { onClose: () => void }) {
  const demo = useDemo();
  const [mode, setMode] = useState<DemoMode>("presentation");
  const ref = useRef<HTMLDialogElement>(null);
  // No close() in cleanup: it fires `close`, which would unmount the dialog during Strict Mode's re-run.
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  if (!demo) return null;
  const go = () => {
    onClose();
    demo.start(mode);
  };
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="demo-mode-title"
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-[8px] border border-line-strong bg-bg-2 p-0 text-fg backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="tech-label">GUIDED WALKTHROUGH · ABOUT 3 MINUTES</p>
          <h2 id="demo-mode-title" className="mt-1 text-lg font-medium tracking-tight">
            Watch an AI agent try to spend money
          </h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:text-fg">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <fieldset className="space-y-2 px-5 py-4">
        <legend className="sr-only">Walkthrough mode</legend>
        {(
          [
            ["presentation", "Presentation", "Recommended. Fictional offers, scored by VANTA's real risk and policy engines. Creates nothing, approves nothing, pays nothing."],
            ["live", "Live (PayPal Sandbox)", "Creates a real mission in your session. You click Parse, Confirm, Approve and Checkout yourself; the walkthrough only narrates the real results. Sandbox uses test money, and the mission stays in your audit log."],
          ] as const
        ).map(([id, label, desc]) => (
          <label key={id} className={cn("flex cursor-pointer gap-3 rounded-[6px] border p-3 transition-colors", mode === id ? "border-cyan/60 bg-cyan/[0.05]" : "border-line hover:border-line-strong")}>
            <input type="radio" name="demo-mode" value={id} checked={mode === id} onChange={() => setMode(id)} className="mt-1 accent-[var(--color-cyan)]" />
            <span>
              <span className="block text-[14px]">{label}</span>
              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{desc}</span>
            </span>
          </label>
        ))}
        {mode === "live" && (
          <p className="flex gap-2 rounded-[6px] border border-warning/40 bg-warning/[0.05] px-3 py-2 text-[12.5px] text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Live mode writes real records. Nothing is approved or paid unless you do it yourself.
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <p className="mr-auto text-[11.5px] text-faint">Space pauses · ←/→ steps · Esc exits</p>
        <button type="button" onClick={onClose} className="h-9 rounded-[4px] px-3 text-sm text-muted hover:text-fg">
          Explore on my own
        </button>
        <button type="button" onClick={go} autoFocus className="inline-flex h-9 items-center gap-2 rounded-[4px] bg-cyan px-4 text-sm font-medium text-bg hover:bg-ice">
          <Clapperboard className="h-4 w-4" aria-hidden /> Start walkthrough
        </button>
      </div>
    </dialog>
  );
}

/** End screen: what was demonstrated, with honest provenance, and a way back to the site. */
export function DemoCompletion() {
  const demo = useDemo();
  const router = useRouter();
  if (!demo || demo.state.status !== "completed") return null;
  const { state, ctx } = demo;
  const e = ctx.evaluation;
  const rec = e?.offers.find((o) => o.key === e.recommendedKey);
  const branch = state.decisions["approval-branch"];
  const payment = ctx.live?.payments[0];

  const rows: [string, string][] =
    state.mode === "presentation"
      ? [
          ["Agent recommendation", rec ? `${rec.title} · ${rec.seller}` : "—"],
          ["Policy decision", e ? `${e.decision.replace(/_/g, " ")} (policy v${e.policy.version}, computed by VANTA's engines on fictional offers)` : "—"],
          ["Blocked offers", e ? String(e.offers.filter((o) => o.policy.decision === "BLOCK").length) : "—"],
          ["Human authorization", branch ? `Simulated ${branch === "approve" ? "approval" : "denial"} — nothing was recorded` : "Not chosen"],
          ["Payment", "None. Presentation mode never creates a payment."],
          ["Audit trail", "Unchanged. The walkthrough wrote no audit events."],
        ]
      : [
          ["Live mission", ctx.live?.mission.title ?? "Not created"],
          ["Mission status (server)", ctx.live?.mission.displayStatus ?? ctx.live?.mission.status ?? "—"],
          ["Policy decision (server)", ctx.live?.mission.decision?.replace(/_/g, " ") ?? "—"],
          ["Payment (server)", payment ? `${payment.status.replace(/_/g, " ").toLowerCase()} · ${formatMoney(payment.amountMinor, payment.currency)} · ${payment.provider}` : "No payment record"],
          ["Audit trail", "Real events, viewable in the audit log"],
        ];

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-labelledby="demo-done-title">
      <motion.div initial={demo.reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="w-full max-w-lg overflow-hidden rounded-[8px] border border-line-strong bg-bg-2">
        <div className="border-b border-line px-6 py-5">
          <p className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-success">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> WALKTHROUGH COMPLETE · {state.mode === "live" ? "LIVE" : "PRESENTATION"}
          </p>
          <h2 id="demo-done-title" className="mt-2 text-xl font-medium tracking-tight">
            Agents proposed. Policy decided. A person stayed in control.
          </h2>
        </div>
        <dl className="divide-y divide-line px-6">
          {rows.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[160px_1fr]">
              <dt className="text-[12.5px] text-muted">{k}</dt>
              <dd className="text-[13px] text-fg">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2 border-t border-line px-6 py-4">
          <button type="button" onClick={demo.replay} className="inline-flex h-9 items-center gap-2 rounded-[4px] border border-line-strong px-3 text-sm hover:border-cyan/50">
            <RotateCcw className="h-4 w-4" aria-hidden /> Replay
          </button>
          <Link href="/missions/new" onClick={demo.exit} className="inline-flex h-9 items-center rounded-[4px] border border-line-strong px-3 text-sm hover:border-cyan/50">
            Try your own mission
          </Link>
          <button
            type="button"
            autoFocus
            onClick={() => {
              demo.exit();
              router.push("/");
            }}
            className="ml-auto inline-flex h-9 items-center rounded-[4px] bg-cyan px-4 text-sm font-medium text-bg hover:bg-ice"
          >
            Back to the site
          </button>
        </div>
      </motion.div>
    </div>
  );
}

