import Link from "next/link";
import { ArrowRight, Bot, FileClock, Gavel, ShieldCheck, UserCheck, Wallet } from "lucide-react";
import { AegisWordmark } from "@/components/shell/logo";
import { LandingNetwork } from "@/components/landing-network";

const FLOW = [
  { icon: Bot, title: "The AI proposes", body: "Bounded agents parse, search, score and rank. They emit proposals only." },
  { icon: Gavel, title: "Policy enforces", body: "A pure, deterministic engine decides BLOCK, REQUIRE APPROVAL or ALLOW." },
  { icon: UserCheck, title: "A human authorizes", body: "Approval binds to the exact purchase by snapshot hash and expires." },
  { icon: Wallet, title: "PayPal processes", body: "Server-verified order and capture. Buyer approval is a second gate." },
  { icon: FileClock, title: "The audit log remembers", body: "Append-only, hash-chained, written in the same transaction." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg bg-grid">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5">
        <AegisWordmark />
        <nav aria-label="Landing" className="flex items-center gap-4 text-sm text-muted">
          <Link href="/command-center" className="hover:text-fg">
            Command Center
          </Link>
          <Link href="/audit" className="hidden hover:text-fg sm:inline">
            Audit
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-8 px-5 pb-10 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded border border-cyan/30 bg-cyan/5 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Autonomous commerce trust platform
            </p>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              LET AI MOVE MONEY.
              <br />
              <span className="text-cyan">NOT BLINDLY.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-muted sm:text-lg">Autonomous commerce, governed by intelligent trust policies and human control.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/command-center" className="inline-flex h-11 items-center gap-2 rounded-md bg-cyan px-5 text-sm font-semibold text-bg hover:bg-cyan/90">
                Launch Command Center <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/missions/new?scenario=robotics-lab" className="inline-flex h-11 items-center gap-2 rounded-md border border-line-strong bg-elevated px-5 text-sm font-medium hover:border-cyan/50">
                Explore a Demo Mission
              </Link>
            </div>
            <p className="mt-6 max-w-xl text-xs leading-relaxed text-muted">
              Hackathon MVP. Runs in a clearly labelled demo mode without credentials, and against PayPal Sandbox when configured. AEGIS does not guarantee fraud detection, and an AI&apos;s confidence is never treated as proof of safety.
            </p>
          </div>
          <LandingNetwork />
        </section>

        <section aria-labelledby="principle" className="border-y border-line bg-bg-2/60">
          <div className="mx-auto max-w-7xl px-5 py-10">
            <h2 id="principle" className="mb-6 text-[13px] font-semibold uppercase tracking-[0.16em] text-muted">
              The operating principle
            </h2>
            <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {FLOW.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="rounded-[var(--radius-panel)] border border-line bg-bg p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <Icon className="h-5 w-5 text-cyan" aria-hidden />
                    <span className="font-mono text-xs text-muted">0{i + 1}</span>
                  </div>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-12 text-center">
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-muted">AI can act.</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">AEGIS makes sure it acts responsibly.</p>
        </section>
      </main>
    </div>
  );
}
