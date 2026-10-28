"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Spiral3DSliderHandle } from "@/components/vanta/spiral-3d-slider";
import { WebGLFallback } from "@/components/ui/webgl-error-boundary";
import { useRenderCapability } from "@/lib/client/render-capability";
import { useMediaQuery } from "@/lib/client/media";
import { cn } from "@/lib/client/cn";
import { Reveal } from "./sections";

const Spiral3DSlider = dynamic(() => import("@/components/vanta/spiral-3d-slider").then((m) => m.Spiral3DSlider), {
  ssr: false,
  loading: () => <WebGLFallback className="h-full w-full" />,
});

const AGENTS = [
  { id: "scout", name: "Scout", role: "Discovery", src: "/vanta/agent-scout.webp", body: "Finds candidate products and offers in the connected catalogue. Keeps only stated facts; never fills gaps with guesses.", alt: "Scout: radar sweep over a field of candidate offers" },
  { id: "risk", name: "Risk", role: "Evidence assessment", src: "/vanta/agent-risk.webp", body: "Scores seller, price, delivery and evidence coverage 0–100. Unknown evidence is shown as unknown, not as low risk.", alt: "Risk: grid of verified, uncertain and unknown evidence signals" },
  { id: "optimizer", name: "Optimizer", role: "Cost & constraints", src: "/vanta/agent-optimizer.webp", body: "Ranks the offers that pass hard gates by your policy's weights for cost, budget, compatibility, delivery and seller.", alt: "Optimizer: offers plotted by price and delivery with a budget cap" },
  { id: "policy", name: "Policy Guard", role: "Deterministic decisions", src: "/vanta/agent-policy.webp", body: "Not a model. A rules engine that evaluates every check and returns the most restrictive result, with its reasons.", alt: "Policy Guard: a hexagonal gate with rule lines passing or failing" },
  { id: "human", name: "Human approver", role: "Explicit authorization", src: "/vanta/agent-human.webp", body: "Signs off on the exact snapshot when policy requires it. Approval expires and is void if the policy or offer changes.", alt: "Human approval: a snapshot card next to a fingerprint pattern" },
  { id: "payment", name: "Payment Agent", role: "PayPal orchestration", src: "/vanta/agent-payment.webp", body: "Creates, verifies and captures PayPal orders only after server-side re-validation. Sandbox in this build; live payments are refused.", alt: "Payment Agent: an order lane passing two gates before capture, labelled sandbox only" },
] as const;

const SLIDES = AGENTS.map((a) => ({ src: a.src, alt: `${a.name} — ${a.role}. ${a.alt}` }));

export function AgentsSection() {
  const cap = useRenderCapability();
  const stage = useRef<HTMLDivElement>(null);
  // Mount the canvas only once it approaches, so it never initializes alongside the hero scene.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const mounted = near && cap.mode === "3d";
  const slider = useRef<Spiral3DSliderHandle>(null);
  const [active, setActive] = useState(0);
  const use3d = cap.mode === "3d";
  const narrow = useMediaQuery("(max-width: 767px)");

  return (
    <section id="agents" aria-labelledby="agents-title" className="relative scroll-mt-20 border-y border-line bg-bg-2/40">
      <div className="mx-auto max-w-[1440px] px-5 py-28 md:px-10 lg:py-36">
        <Reveal className="grid gap-6 lg:grid-cols-2 lg:items-end">
          <div>
            <p className="tech-label mb-5 !text-cyan">The agent network</p>
            <h2 id="agents-title" className="editorial max-w-[16ch] text-4xl md:text-6xl">
              Every agent bounded. <span className="text-fg/45">None can pay.</span>
            </h2>
          </div>
          <p className="max-w-lg text-[15px] leading-relaxed text-muted lg:justify-self-end">
            Each role has one job and a narrow interface. They can propose; only the server — after policy and, where required, a person — can move money.
          </p>
        </Reveal>

        <div ref={stage} className="mt-12">
          {use3d ? (
            <div className="relative h-[24rem] overflow-hidden rounded-[6px] border border-line bg-[radial-gradient(60%_70%_at_50%_50%,rgb(111_227_238/0.07),transparent_70%)] sm:h-[32rem] lg:h-[38rem]">
              {mounted && (
                <Spiral3DSlider
                  ref={slider}
                  items={SLIDES}
                  className="h-full min-h-0 bg-transparent"
                  radius={300}
                  verticalGap={64}
                  cardWidth={340}
                  cardAspectRatio={3 / 2}
                  autoSpeed={0.08}
                  blurStrength={1.4}
                  bend={0.15}
                  ariaLabel="VANTA agents, one slide per role"
                  cardViewportRatio={narrow ? 0.46 : 0.225}
                  radiusViewportRatio={narrow ? 0.28 : 0.245}
                  onActiveChange={setActive}
                />
              )}
            </div>
          ) : (
            // Reduced motion or no WebGL: the same art as a still grid.
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="VANTA agents">
              {AGENTS.map((a) => (
                <li key={a.id} className="overflow-hidden rounded-[6px] border border-line bg-bg">
                  <Image src={a.src} alt={a.alt} width={960} height={640} sizes="(min-width: 640px) 30vw, 45vw" className="aspect-[3/2] h-auto w-full object-cover" />
                  <p className="px-3 py-2 text-[13px] font-medium">{a.name}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {use3d && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="min-w-0 text-sm text-muted" aria-live="polite">
              <span className="font-mono text-[11px] text-cyan">0{active + 1}</span> <span className="text-fg">{AGENTS[active].name}</span> — {AGENTS[active].body}
            </p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => slider.current?.step(-1)} aria-label="Previous agent" className="grid h-10 w-10 place-items-center rounded-[4px] border border-line-strong text-muted transition-colors hover:border-cyan/50 hover:text-fg">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => slider.current?.step(1)} aria-label="Next agent" className="grid h-10 w-10 place-items-center rounded-[4px] border border-line-strong text-muted transition-colors hover:border-cyan/50 hover:text-fg">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}

        {/* The readable roster: the canvas alone is not enough to communicate the roles. */}
        <ol className="mt-10 grid gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {AGENTS.map((a, i) => {
            const on = use3d && i === active;
            return (
              <li key={a.id} className="bg-bg">
                <button
                  type="button"
                  onClick={() => slider.current?.goTo(i)}
                  disabled={!use3d}
                  aria-current={on ? "true" : undefined}
                  className={cn("flex h-full w-full flex-col p-5 text-left transition-colors disabled:cursor-default", on ? "bg-cyan/[0.06]" : "enabled:hover:bg-elevated")}
                >
                  <span className={cn("font-mono text-[11px] transition-colors", on ? "text-cyan" : "text-faint")}>0{i + 1}</span>
                  <span className="mt-4 text-[16px] font-medium tracking-tight">{a.name}</span>
                  <span className="tech-label mt-1 !text-faint">{a.role}</span>
                  <span className="mt-3 text-[13px] leading-relaxed text-muted">{a.body}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
