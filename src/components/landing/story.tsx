"use client";
import { motion, useTransform, type MotionValue } from "motion/react";
import { ScrollChoreography } from "@/components/vanta/scroll-choreography";
import { usePrefersReducedMotion } from "@/lib/client/media";
import { cn } from "@/lib/client/cn";
import { Reveal } from "./sections";

/** Progress windows line up with the choreography: diagonal shuffle (0–0.3), convergence (0.35–0.65), expansion (0.7–0.9). */
const STAGES = [
  { n: "01", name: "Discover", agent: "Scout", from: 0, to: 0.13, body: "Searches the connected catalogue for candidate products and offers. Only what a listing actually states is kept; everything else stays unknown." },
  { n: "02", name: "Assess", agent: "Risk", from: 0.13, to: 0.26, body: "Scores seller, price, delivery and evidence coverage. Missing evidence is labelled unknown — never scored as safe." },
  { n: "03", name: "Optimize", agent: "Optimizer", from: 0.26, to: 0.42, body: "Ranks only the offers that pass hard gates, comparing price, quantity, delivery and constraints by the weights in your versioned policy." },
  { n: "04", name: "Govern", agent: "Policy Guard", from: 0.42, to: 0.64, body: "A deterministic engine checks the exact purchase against your rules and limits. The most restrictive result wins: BLOCK, REQUIRE APPROVAL, or ALLOW." },
  { n: "05", name: "Authorize", agent: "Human", from: 0.64, to: 0.82, body: "Where policy requires it, a person approves the exact snapshot — items, amount, currency, policy version — before an order can exist." },
  { n: "06", name: "Transact", agent: "Payment Agent", from: 0.82, to: 1.01, body: "PayPal checkout proceeds only after the server re-validates the policy decision and approval. The browser never chooses the amount. Every step is audited." },
] as const;

const IMAGES = {
  topLeft: { src: "/vanta/agent-scout.webp", alt: "Scout: a radar sweep picking out candidate offers from a field of listings" },
  bottomRight: { src: "/vanta/agent-risk.webp", alt: "Risk: an evidence grid of verified, uncertain and unknown signals; unknown is never treated as safe" },
  bottomLeft: { src: "/vanta/agent-optimizer.webp", alt: "Optimizer: offers plotted by price and delivery, with the best eligible offer inside the budget cap highlighted" },
  topRight: { src: "/vanta/trust-gate.webp", alt: "Illustration: agents converge into the Trust Core; one lane leaves through policy and human gates toward checkout" },
};

function Caption({ stage, progress, index }: { stage: (typeof STAGES)[number]; progress: MotionValue<number>; index: number }) {
  const first = index === 0;
  const last = index === STAGES.length - 1;
  // Cross-fade at each boundary; the first stays visible from the top, the last until the end.
  const opacity = useTransform(progress, [stage.from - 0.025, stage.from + 0.01, stage.to - 0.01, stage.to + 0.025], [first ? 1 : 0, 1, 1, last ? 1 : 0]);
  const y = useTransform(opacity, [0, 1], [14, 0]);
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-x-0 bottom-0">
      <p className="font-mono text-[11px] tracking-[0.2em] text-cyan">
        {stage.n} · {stage.agent.toUpperCase()}
      </p>
      <h3 className="editorial mt-3 text-3xl md:text-4xl">{stage.name}</h3>
      <p className="mt-3 text-[14px] leading-relaxed text-fg/80 md:text-[15px]">{stage.body}</p>
    </motion.div>
  );
}

function RailStep({ stage, progress }: { stage: (typeof STAGES)[number]; progress: MotionValue<number> }) {
  const fill = useTransform(progress, [stage.from, stage.to], [0, 1], { clamp: true });
  return (
    <li className="min-w-0 flex-1">
      <span className="block h-px w-full overflow-hidden bg-line-strong">
        <motion.span style={{ scaleX: fill }} className="block h-full origin-left bg-cyan" />
      </span>
      <span className="mt-2 hidden truncate font-mono text-[10px] tracking-[0.16em] text-muted sm:block">{stage.name.toUpperCase()}</span>
    </li>
  );
}

function Overlay({ progress }: { progress: MotionValue<number> }) {
  // The full-bleed panel is an illustration, so the label appears with it.
  const tagOpacity = useTransform(progress, [0.72, 0.8], [0, 1]);
  return (
    <div aria-hidden className="relative mx-auto flex h-full max-w-[1440px] flex-col justify-between px-4 pb-6 pt-20 md:px-10 md:pb-10 md:pt-24">
      {/* Keeps the rail legible once the final panel fills the screen. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-44 bg-gradient-to-b from-bg via-bg/70 to-transparent" />
      <ol className="flex gap-2 md:gap-3">
        {STAGES.map((s) => (
          <RailStep key={s.n} stage={s} progress={progress} />
        ))}
      </ol>
      <div className="flex items-end justify-between gap-6">
        <div className="relative w-full max-w-md rounded-[6px] border border-line bg-bg/85 p-5 backdrop-blur-md md:p-6">
          {/* Height comes from the tallest caption so the card never jumps between stages. */}
          <div className="invisible">
            <p className="font-mono text-[11px]">00</p>
            <h3 className="editorial mt-3 text-3xl md:text-4xl">Authorize</h3>
            <p className="mt-3 text-[14px] leading-relaxed md:text-[15px]">{STAGES[3].body}</p>
          </div>
          <div className="absolute inset-5 md:inset-6">
            {STAGES.map((s, i) => (
              <Caption key={s.n} stage={s} progress={progress} index={i} />
            ))}
          </div>
        </div>
        <motion.span style={{ opacity: tagOpacity }} className="hidden shrink-0 rounded-[3px] border border-purple/40 bg-bg/70 px-2 py-1 font-mono text-[10px] tracking-[0.16em] text-purple md:inline">
          ILLUSTRATIVE · NOT LIVE DATA
        </motion.span>
      </div>
    </div>
  );
}

function StageList({ className, visible }: { className?: string; visible: boolean }) {
  return (
    <ol className={cn(visible ? "mt-12 grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3" : "sr-only", className)}>
      {STAGES.map((s) => (
        <li key={s.n} className={visible ? "bg-bg p-6" : undefined}>
          <p className="font-mono text-[11px] tracking-[0.2em] text-cyan">
            {s.n} · {s.agent.toUpperCase()}
          </p>
          <h3 className={visible ? "mt-3 text-xl font-medium tracking-tight" : undefined}>{s.name}</h3>
          <p className={visible ? "mt-2 text-sm leading-relaxed text-muted" : undefined}>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function StorySection() {
  const reduced = usePrefersReducedMotion();
  return (
    <section id="story" aria-labelledby="story-title" className="relative scroll-mt-20">
      <div data-demo-target="governance-workflow" className="mx-auto max-w-[1440px] px-5 pt-28 md:px-10 md:pt-40">
        <Reveal>
          <p className="tech-label mb-5 flex items-center gap-3 !text-cyan">
            <span className="h-px w-10 bg-cyan/60" aria-hidden /> How VANTA governs a purchase
          </p>
          <h2 id="story-title" className="editorial max-w-[18ch] text-5xl md:text-7xl">
            Six stages. <span className="text-fg/45">One gate the AI cannot open.</span>
          </h2>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted">
            Agents propose. Policy decides. People authorize. Payment happens last — and only if every earlier stage still holds when the server checks again.
          </p>
        </Reveal>
        {/* Screen readers and reduced-motion visitors get the whole sequence as a plain list. */}
        <StageList visible={reduced} />
      </div>
      <div className={reduced ? "mx-auto max-w-[1440px] px-5 pb-10 pt-6 md:px-10" : "mt-10"}>
        <ScrollChoreography images={IMAGES} overlay={(progress) => <Overlay progress={progress} />} />
      </div>
    </section>
  );
}
