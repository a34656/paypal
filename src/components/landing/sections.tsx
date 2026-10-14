"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { LandingNetwork } from "@/components/landing-network";
import { cn } from "@/lib/client/cn";

const EASE = [0.22, 1, 0.36, 1] as const;

export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12% 0px" }}
      transition={{ duration: reduce ? 0.2 : 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

const STAGES = [
  { n: "01", name: "DISCOVER", agent: "Scout", body: "Searches Channel3's live cross-retailer catalogue. Only what the catalogue states is kept; the rest stays unknown." },
  { n: "02", name: "ANALYZE", agent: "Risk", body: "Scores seller, price, delivery and evidence 0–100. Missing evidence is labelled unknown and never scored as safe." },
  { n: "03", name: "OPTIMIZE", agent: "Optimizer", body: "Ranks only the offers that pass hard gates, by weights in your versioned policy. Disclosed totals beat estimates." },
  { n: "04", name: "AUTHORIZE", agent: "Policy Guard + Human", body: "A deterministic engine decides. A human approves the exact purchase — bound by snapshot hash, policy version and expiry." },
  { n: "05", name: "EXECUTE", agent: "PayPal", body: "Server-verified order, capture or authorization hold. The browser never chooses the amount. Every step is audited." },
];

export function ProtocolSection() {
  return (
    <section id="protocol" aria-labelledby="protocol-title" className="relative mx-auto max-w-[1440px] scroll-mt-20 px-5 py-28 md:px-10 md:py-40">
      <Reveal>
        <p className="tech-label mb-5 flex items-center gap-3 !text-cyan">
          <span className="h-px w-10 bg-cyan/60" aria-hidden /> The protocol
        </p>
        <h2 id="protocol-title" className="editorial max-w-[18ch] text-5xl md:text-7xl">
          Five stages. <span className="text-fg/45">One gate the AI cannot open.</span>
        </h2>
      </Reveal>
      <ol className="relative mt-20 grid gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-5">
        {STAGES.map((s, i) => (
          <li key={s.n} className="relative bg-bg">
            <Reveal delay={i * 0.08} className="flex h-full flex-col p-6 md:min-h-[320px]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-faint">{s.n}</span>
                {i < STAGES.length - 1 && <ArrowRight className="hidden h-3.5 w-3.5 text-faint md:block" aria-hidden />}
              </div>
              <h3 className={cn("mt-10 font-mono text-[15px] tracking-[0.22em]", i === 3 ? "text-warning" : i === 4 ? "text-cyan" : "text-fg")}>{s.name}</h3>
              <p className="tech-label mt-2 !text-faint">{s.agent}</p>
              <p className="mt-auto pt-8 text-sm leading-relaxed text-muted">{s.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

const SAMPLE: { t: string; stage: string; label: string; tone: "cyan" | "warning" | "success" | "critical" | "muted" }[] = [
  { t: "00:00.0", stage: "CORE", label: "Mission confirmed — 2 × Raspberry Pi 5 starter kit (8GB), budget $700", tone: "muted" },
  { t: "00:01.8", stage: "SCOUT", label: "12 retailer offers discovered", tone: "cyan" },
  { t: "00:01.9", stage: "RISK", label: "4GB kit, accessories “for Raspberry Pi 5” and Pi 500 rejected as mismatches", tone: "critical" },
  { t: "00:02.0", stage: "OPTIMIZER", label: "Starter Kit PRO ranked #1 of 1 eligible offer", tone: "cyan" },
  { t: "00:02.1", stage: "POLICY", label: "APPROVAL REQUIRED — shipping/tax undisclosed → spending cap $620.89", tone: "warning" },
  { t: "04:12.4", stage: "HUMAN", label: "Approver signed the exact snapshot (expires in 30 min)", tone: "success" },
  { t: "04:40.2", stage: "PAYPAL", label: "Authorization hold placed for at most $620.89", tone: "cyan" },
  { t: "2 days", stage: "PAYPAL", label: "Settled at the invoice total $583.40 · $37.49 released", tone: "success" },
];

const TONE = { cyan: "text-cyan", warning: "text-warning", success: "text-success", critical: "text-critical", muted: "text-muted" };

export function NetworkSection() {
  return (
    <section aria-labelledby="network-title" className="relative border-y border-line bg-bg-2/40">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-28 md:px-10 lg:grid-cols-[1.25fr_1fr] lg:py-36">
        <Reveal>
          <p className="tech-label mb-5 !text-cyan">The agent network</p>
          <h2 id="network-title" className="editorial max-w-[16ch] text-4xl md:text-6xl">
            Every agent bounded. <span className="text-fg/45">Every signal recorded.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-muted">
            Scout, Risk, Optimizer and Policy Guard orbit a core that can propose but never pay. PayPal activates only after the policy decision, a human approval and buyer checkout. In the console this network is driven by real mission events — nothing animates unless something actually happened.
          </p>
          <div className="mt-10">
            <LandingNetwork />
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="surface rounded-[6px]">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="tech-label">Sample mission timeline</p>
              <span className="rounded-[3px] border border-purple/30 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-purple">ILLUSTRATIVE · NOT LIVE DATA</span>
            </div>
            <ol className="divide-y divide-line/70">
              {SAMPLE.map((e) => (
                <li key={e.t + e.label} className="grid grid-cols-[64px_78px_1fr] items-baseline gap-3 px-5 py-3.5">
                  <span className="font-mono text-[11px] text-faint">{e.t}</span>
                  <span className={cn("font-mono text-[10px] tracking-[0.16em]", TONE[e.tone])}>{e.stage}</span>
                  <span className="text-[13px] leading-snug text-fg/90">{e.label}</span>
                </li>
              ))}
            </ol>
            <p className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-faint">
              Shape of a real run recorded on 2026-10-14 against live Channel3 data. Your own missions replay from the audit log.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const GUARANTEES = [
  ["Evidence, not confidence", "LLM text is display-only. Unknown is labelled unknown. Instructions hidden in listings block the offer."],
  ["Two gates before money moves", "An unexpired, snapshot-matching AEGIS approval and PayPal buyer approval — both verified on the server."],
  ["A ledger that remembers", "Append-only, hash-chained audit events written in the same transaction as every state change."],
];

export function GuaranteesSection() {
  return (
    <section aria-labelledby="guarantees-title" className="mx-auto max-w-[1440px] px-5 py-28 md:px-10 md:py-36">
      <h2 id="guarantees-title" className="sr-only">
        Guarantees
      </h2>
      <div className="grid gap-12 md:grid-cols-3">
        {GUARANTEES.map(([t, b], i) => (
          <Reveal key={t} delay={i * 0.08}>
            <div className="border-t border-line-strong pt-6">
              <p className="font-mono text-[11px] text-faint">0{i + 1}</p>
              <h3 className="mt-4 text-xl font-medium tracking-tight">{t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{b}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal className="mt-32 text-center">
        <p className="tech-label">AI can act.</p>
        <p className="editorial mx-auto mt-4 max-w-[20ch] text-4xl md:text-6xl">AEGIS makes sure it acts responsibly.</p>
        <Link href="/command-center" className="mt-10 inline-flex h-12 items-center gap-3 rounded-[4px] bg-cyan px-6 text-[15px] font-medium text-bg transition-colors hover:bg-ice">
          Launch Command Center <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </Reveal>
    </section>
  );
}
