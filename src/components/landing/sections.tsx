"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ScrollText } from "lucide-react";
import { useApi } from "@/lib/client/api";
import type { SessionInfo } from "@/components/shell/identity-menu";
import { ModeIndicator } from "@/components/shell/mode-indicator";

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

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="tech-label mb-5 flex items-center gap-3 !text-cyan">
      <span className="h-px w-10 bg-cyan/60" aria-hidden /> {children}
    </p>
  );
}

/** Mirrors the checks in src/domain/policy/engine.ts; keep in step with it. */
const CHECKS: { group: string; items: [string, string][] }[] = [
  {
    group: "Limits",
    items: [
      ["Mission budget & per-purchase maximum", "Over the maximum blocks; over the mission budget blocks or asks for approval, as configured."],
      ["Automatic-purchase ceiling", "Anything above it needs a person, even when every other check passes."],
      ["Approval threshold", "Amounts above it always route to an approver."],
    ],
  },
  {
    group: "Evidence",
    items: [
      ["Known total", "Undisclosed shipping or tax blocks — or, if allowed, becomes a capped authorization hold that an approver signs."],
      ["Evidence coverage & risk score", "Below your minimum coverage or above your risk ceiling, the purchase is blocked or escalated."],
      ["Instructions hidden in listings", "Prompt-injection attempts in product text block the offer outright."],
    ],
  },
  {
    group: "Scope",
    items: [
      ["Seller verification", "Only retailer domains you trust count as verified; others block or escalate."],
      ["Allowed & blocked categories", "A blocked category, or one outside your allow-list, blocks."],
      ["Duplicate window", "A repeat purchase inside the window blocks or asks for approval."],
    ],
  },
];

export function PolicySection() {
  return (
    <section id="policy" aria-labelledby="policy-title" className="relative mx-auto max-w-[1440px] scroll-mt-20 px-5 py-28 md:px-10 md:py-36">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Reveal>
          <Eyebrow>Policy Guard</Eyebrow>
          <h2 id="policy-title" className="editorial max-w-[14ch] text-4xl md:text-6xl">
            Rules, not vibes. <span className="text-fg/45">Most restrictive wins.</span>
          </h2>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
            Policy is a versioned configuration evaluated by deterministic code. An AI&apos;s confidence is never an input. Every check reports PASS, REQUIRE APPROVAL or BLOCK, and the strictest result becomes the decision.
          </p>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-px overflow-hidden rounded-[6px] border border-line bg-line text-center">
            {[
              ["ALLOW", "Checks pass; a person still authorizes checkout", "text-success"],
              ["APPROVE", "An approver signs the exact snapshot", "text-warning"],
              ["BLOCK", "No order can be created", "text-critical"],
            ].map(([k, v, tone]) => (
              <div key={k} className="bg-bg px-3 py-4">
                <dt className={`font-mono text-[11px] tracking-[0.18em] ${tone}`}>{k}</dt>
                <dd className="mt-2 text-[12px] leading-snug text-muted">{v}</dd>
              </div>
            ))}
          </dl>
          <Link href="/policies" className="mt-8 inline-flex items-center gap-2 text-sm text-cyan underline-offset-4 hover:underline">
            Inspect the active policy <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Reveal>
        <div className="grid gap-8 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {CHECKS.map((g, gi) => (
            <Reveal key={g.group} delay={gi * 0.06}>
              <h3 className="border-t border-line-strong pt-5 font-mono text-[11px] tracking-[0.2em] text-muted">{g.group.toUpperCase()}</h3>
              <ul className="mt-4 space-y-5">
                {g.items.map(([t, b]) => (
                  <li key={t}>
                    <p className="text-[15px] font-medium tracking-tight">{t}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </div>
      <Reveal className="mt-20 grid gap-10 border-t border-line pt-10 md:grid-cols-3">
        {[
          ["Bound approvals", "An approval is tied to the snapshot hash, the policy version and an expiry. Change any of them and it no longer counts."],
          ["Re-checked at the gate", "Before an order is created the server evaluates the current policy again. A stale approval is invalidated, not honoured."],
          ["A ledger that remembers", "Append-only, hash-chained audit events are written in the same database transaction as every state change."],
        ].map(([t, b], i) => (
          <div key={t}>
            <p className="font-mono text-[11px] text-faint">0{i + 1}</p>
            <h3 className="mt-3 text-lg font-medium tracking-tight">{t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

const PAYPAL_STEPS: [string, string][] = [
  ["Order created server-side", "Amount and items come from the approved snapshot, never from the browser."],
  ["Buyer approves in PayPal", "The PayPal checkout window is the second, independent approval."],
  ["Verified, then captured", "The server confirms the PayPal order matches amount, currency and IDs before capture or hold."],
];

export function PaymentsSection() {
  const { data: session } = useApi<SessionInfo>("/api/session");
  const mode = session?.mode;
  return (
    <section id="payments" aria-labelledby="payments-title" className="relative scroll-mt-20 border-y border-line bg-bg-2/40">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-28 md:px-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-36">
        <Reveal>
          <Eyebrow>Payment Agent · PayPal</Eyebrow>
          <h2 id="payments-title" className="editorial max-w-[14ch] text-4xl md:text-6xl">
            Money moves last. <span className="text-fg/45">Through PayPal.</span>
          </h2>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
            VANTA uses PayPal Orders for checkout, capture and authorization holds. Without credentials it runs a clearly labelled simulation; with Sandbox credentials it uses PayPal&apos;s test environment. Live payments are refused by default.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">This deployment:</span>
            <ModeIndicator mode={mode} />
            {session && <span className="font-mono text-[11px] tracking-[0.12em] text-faint">{session.paypalConnected ? "PAYPAL CREDENTIALS CONFIGURED" : "NO PAYPAL CREDENTIALS"}</span>}
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <ol className="grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-3">
            {PAYPAL_STEPS.map(([t, b], i) => (
              <li key={t} className="bg-bg p-6">
                <p className="font-mono text-[11px] text-faint">0{i + 1}</p>
                <h3 className="mt-6 text-[15px] font-medium tracking-tight">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/missions/new?scenario=robotics-lab" className="inline-flex h-11 items-center gap-2 rounded-[4px] bg-cyan px-5 text-sm font-medium text-bg transition-colors hover:bg-ice">
              Try it in the demo <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link href="/transactions" className="inline-flex h-11 items-center gap-2 rounded-[4px] border border-line-strong px-5 text-sm text-fg transition-colors hover:border-cyan/50">
              View your transactions
            </Link>
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-faint">
            Nothing on this page is a real payment. Transactions appear only after you run a mission, approve it and complete checkout.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="mx-auto max-w-[1440px] px-5 py-32 text-center md:px-10 md:py-40">
      <Reveal>
        <p className="tech-label">AI agents can act.</p>
        <h2 id="cta-title" className="editorial mx-auto mt-4 max-w-[20ch] text-4xl md:text-6xl">
          VANTA makes sure they act within policy.
        </h2>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link href="/command-center" className="inline-flex h-12 items-center gap-3 rounded-[4px] bg-cyan px-6 text-[15px] font-medium text-bg transition-colors hover:bg-ice">
            Launch Command Center <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/audit" className="inline-flex h-12 items-center gap-2 rounded-[4px] border border-line-strong px-6 text-[15px] text-fg transition-colors hover:border-cyan/50">
            Open the audit log <ScrollText className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
