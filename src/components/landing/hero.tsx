"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowDown } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { useOnScreen, useRenderCapability } from "@/lib/client/render-capability";
import type { SessionInfo } from "@/components/shell/identity-menu";
import { AegisWordmark } from "@/components/shell/logo";
import { ModeIndicator } from "@/components/shell/mode-indicator";
import { CoreFallback } from "./core-fallback";

const CoreScene = dynamic(() => import("@/components/three/core-scene"), { ssr: false });

const EASE = [0.22, 1, 0.36, 1] as const;

export function LandingNav() {
  const { data: session } = useApi<SessionInfo>("/api/session");
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 md:px-10">
        <Link href="/" aria-label="AEGIS home">
          <AegisWordmark subtitle />
        </Link>
        <nav aria-label="Landing" className="flex items-center gap-1 md:gap-6">
          <a href="#protocol" className="hidden font-mono text-[11px] tracking-[0.2em] text-muted transition-colors hover:text-fg md:inline">
            WORKFLOW
          </a>
          <Link href="/command-center" className="hidden font-mono text-[11px] tracking-[0.2em] text-muted transition-colors hover:text-fg md:inline">
            COMMAND CENTER
          </Link>
          <Link href="/audit" className="hidden font-mono text-[11px] tracking-[0.2em] text-muted transition-colors hover:text-fg md:inline">
            AUDIT
          </Link>
          <ModeIndicator mode={session?.mode} className="hidden sm:inline-flex" />
          <Link
            href="/command-center"
            className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-bg/50 px-3 font-mono text-[11px] tracking-[0.16em] text-fg backdrop-blur transition-colors hover:border-cyan/50"
          >
            ENTER CONSOLE <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Real initialization checks only: renderer capability and the server session (mode, AI). */
function InitStatus({ renderer, session, sceneReady }: { renderer: string; session: SessionInfo | undefined; sceneReady: boolean }) {
  const [hidden, setHidden] = useState(false);
  const done = !!session && sceneReady;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setHidden(true), 1400);
    return () => clearTimeout(t);
  }, [done]);
  const rows: [string, string, boolean][] = [
    ["RENDERER", renderer, sceneReady],
    ["CONTROL PLANE", session ? "ONLINE" : "CONNECTING", !!session],
    ["PAYMENT ENV", session ? (session.mode === "SANDBOX" ? "PAYPAL SANDBOX" : session.mode === "LIVE" ? "LIVE" : "DEMO · SIMULATED") : "…", !!session],
    ["AI", session ? (session.aiConnected ? "GEMINI · ADVISORY" : "DETERMINISTIC") : "…", !!session],
  ];
  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="pointer-events-none absolute bottom-10 right-5 z-20 w-60 font-mono text-[10px] tracking-[0.14em] text-faint md:right-10"
    >
      <p className="mb-2 text-muted">{done ? "SYSTEM READY" : "INITIALIZING"}</p>
      <ul className="space-y-1 border-l border-line pl-3">
        {rows.map(([k, v, ok]) => (
          <li key={k} className="flex justify-between gap-3">
            <span>{k}</span>
            <span className={ok ? "text-cyan" : "text-faint"}>{v}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export function Hero() {
  const cap = useRenderCapability();
  const reduce = useReducedMotion();
  const { data: session } = useApi<SessionInfo>("/api/session");
  const section = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  const onScreen = useOnScreen(section);
  const [lost, setLost] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const h = section.current?.offsetHeight ?? window.innerHeight;
      scroll.current = Math.min(1, Math.max(0, window.scrollY / h));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const use3d = cap.mode === "3d" && !lost;
  const renderer = cap.mode === null ? "DETECTING" : use3d ? (cap.webgl === "webgl2" ? "WEBGL2" : "WEBGL") : lost ? "STATIC · CONTEXT LOST" : cap.reducedMotion ? "STATIC · REDUCED MOTION" : "STATIC · NO WEBGL";

  const line = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 28, filter: "blur(10px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: reduce ? 0.2 : 1.1, delay: reduce ? 0 : delay, ease: EASE },
  });

  return (
    <section ref={section} className="relative flex min-h-[100svh] items-end overflow-hidden" aria-labelledby="hero-title">
      {/* Scene layer */}
      <div className="absolute inset-x-0 top-0 h-[58%] opacity-70 md:inset-0 md:left-[38%] md:h-auto md:opacity-100">
        {use3d ? (
          <CoreScene scroll={scroll} lowPower={cap.lowPower} paused={!onScreen} onContextLost={() => setLost(true)} onReady={() => setReady(true)} />
        ) : (
          cap.mode !== null && <CoreFallback className="h-full w-full" />
        )}
      </div>
      {/* Atmosphere: vignette + horizon fog keep type readable over the scene. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_70%_40%,transparent_30%,#050608_85%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bg to-transparent" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_50%,black,transparent)]" aria-hidden />

      <InitStatus renderer={renderer} session={session} sceneReady={ready || (cap.mode !== null && !use3d)} />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 pb-16 pt-32 md:px-10 md:pb-24">
        <motion.p {...line(0.1)} className="tech-label mb-6 flex items-center gap-3 !text-cyan">
          <span className="h-px w-10 bg-cyan/60" aria-hidden /> AEGIS · AI Commerce Guardian
        </motion.p>
        <h1 id="hero-title" className="editorial max-w-[14ch] text-[12vw] text-fg [text-shadow:0_2px_40px_rgb(5_6_8/0.9)] sm:text-[8.5vw] lg:text-[104px]">
          <motion.span {...line(0.25)} className="block">
            INTELLIGENCE IN MOTION.
          </motion.span>
          <motion.span {...line(0.45)} className="block text-fg/55">
            TRUST IN CONTROL.
          </motion.span>
        </h1>
        <motion.div {...line(0.7)} className="mt-8 grid max-w-3xl gap-8 md:grid-cols-[1fr_auto] md:items-end">
          <p className="max-w-md text-[17px] leading-relaxed text-muted">An intelligent trust layer between autonomous commerce and payment execution.</p>
        </motion.div>
        <motion.div {...line(0.85)} className="mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/command-center"
            className="group inline-flex h-12 items-center gap-3 rounded-[4px] bg-cyan px-6 text-[15px] font-medium text-bg shadow-[0_0_40px_-12px_rgb(111_227_238/0.9)] transition-colors hover:bg-ice"
          >
            Launch Command Center <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
          <a href="#protocol" className="inline-flex h-12 items-center gap-2 rounded-[4px] border border-line-strong bg-bg/40 px-6 text-[15px] text-fg backdrop-blur transition-colors hover:border-cyan/50">
            Explore the Protocol <ArrowDown className="h-4 w-4" aria-hidden />
          </a>
          <Link href="/missions/new?scenario=robotics-lab" className="px-2 text-sm text-muted underline-offset-4 transition-colors hover:text-fg hover:underline">
            Run a demo mission
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
