"use client";
import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDashed, Loader2, MessageCircleQuestion, Pause, Play, RotateCcw, ShieldAlert, Ban, X, XCircle, Hand } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { useDemo } from "./controller";
import { CHAPTERS, matchQuestion, resolve, timelineUpTo } from "./scenes";
import type { AgentId, AgentStatus, DemoQuestion, TimelineEvent } from "./types";

const AGENT_NAMES: Record<AgentId, string> = { scout: "Scout", risk: "Risk", optimizer: "Optimizer", policy: "Policy Guard", human: "Human Authorization", payment: "PayPal Payment Agent" };
const STATUS: Record<AgentStatus, { label: string; icon: typeof Circle; tone: string }> = {
  pending: { label: "Pending", icon: CircleDashed, tone: "text-faint" },
  running: { label: "Running", icon: Loader2, tone: "text-cyan" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "text-success" },
  flagged: { label: "Flagged", icon: ShieldAlert, tone: "text-warning" },
  awaiting_authorization: { label: "Awaiting authorization", icon: Hand, tone: "text-warning" },
  blocked: { label: "Blocked by policy", icon: Ban, tone: "text-critical" },
  failed: { label: "Failed", icon: XCircle, tone: "text-critical" },
};
const SOURCE_LABEL = { engine: "engine · fictional input", simulated: "simulated", live: "live" } as const;

/** Reveals narration progressively; keyed by text so each scene starts from empty. Screen readers get the whole sentence via the live region. */
function Typed({ text, enabled }: { text: string; enabled: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setShown((n) => (n >= text.length ? (clearInterval(id), n) : n + 2)), 18);
    return () => clearInterval(id);
  }, [text, enabled]);
  const visible = enabled ? text.slice(0, shown) : text;
  return (
    <>
      {visible}
      {visible.length < text.length && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-cyan/70" />}
    </>
  );
}

export function DemoStoryPanel() {
  const demo = useDemo();
  const [qaOpen, setQaOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const status = demo?.state.status ?? "idle";
  const scene = demo?.scene ?? null;
  const narration = scene && demo ? resolve(scene.narration, demo.ctx) : "";

  // Keyboard: Space pause/resume, ←/→ previous/next, Esc exit. Ignored while typing in a field.
  useEffect(() => {
    if (!demo || status === "idle" || status === "completed") return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === " ") {
        e.preventDefault();
        if (status === "paused") demo.resume();
        else demo.pause();
      } else if (e.key === "ArrowRight") demo.next();
      else if (e.key === "ArrowLeft") demo.prev();
      else if (e.key === "Escape") demo.exit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demo, status]);

  if (!demo || status === "idle" || status === "completed" || !scene) return null;
  const { state, scenes } = demo;
  const timeline = timelineUpTo(scenes, state.sceneIndex, demo.ctx);
  const why = resolve(scene.why, demo.ctx);
  const progress = ((state.sceneIndex + 1) / scenes.length) * 100;
  const decision = state.decision;

  return (
    <motion.aside
      initial={demo.reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      aria-label="VANTA walkthrough"
      data-demo-ui
      className="fixed inset-x-3 bottom-3 z-[80] flex max-h-[52vh] flex-col overflow-hidden rounded-[8px] border border-line-strong bg-bg-2/95 shadow-[0_24px_80px_-20px_rgb(0_0_0/0.9)] backdrop-blur-md md:inset-x-auto md:bottom-4 md:right-4 md:top-auto md:max-h-[calc(100vh-2rem)] md:w-[420px]"
    >
      <div className="h-0.5 bg-line" aria-hidden>
        <div className="h-full bg-cyan transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] tracking-[0.16em] text-muted">
            SCENE {state.sceneIndex + 1}/{scenes.length} · CHAPTER {scene.chapter} — {CHAPTERS[scene.chapter - 1].toUpperCase()}
          </p>
          <h2 className="mt-1 truncate text-[15px] font-medium tracking-tight">{scene.title}</h2>
          <p className={cn("mt-1 inline-block rounded-[3px] border px-1.5 py-px font-mono text-[9.5px] tracking-[0.14em]", state.mode === "live" ? "border-warning/40 text-warning" : "border-purple/40 text-purple")}>
            {state.mode === "live" ? "LIVE · SANDBOX BACKEND" : "PRESENTATION · NO REAL PAYMENTS"}
          </p>
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="rounded px-1.5 py-1 text-[11px] text-muted hover:text-fg md:hidden" aria-expanded={!collapsed}>
          {collapsed ? "More" : "Less"}
        </button>
        <button type="button" onClick={demo.exit} aria-label="Exit walkthrough" className="rounded p-1 text-muted hover:text-fg">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-3", collapsed && "hidden md:block")}>
        <p className="min-h-[4.5em] text-[14px] leading-relaxed text-fg/95" aria-hidden>
          <Typed key={`${state.runId}-${narration}`} text={narration} enabled={!demo.reducedMotion && state.status !== "paused"} />
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic>
          {narration}
        </p>

        {state.status === "paused" && (
          <p className="mt-3 rounded-[6px] border border-line-strong px-3 py-2 text-[12.5px] text-muted" role="status">
            {state.pausedReason ?? "Paused."}
          </p>
        )}
        {demo.ui.missingTarget && (
          <p className="mt-3 rounded-[6px] border border-dashed border-line-strong px-3 py-2 text-[12.5px] text-muted" role="status">
            The element this step points at is not on the page right now, so it is not highlighted. The story continues.
          </p>
        )}
        {state.status === "error" && state.error && (
          <div role="alert" className="mt-3 rounded-[6px] border border-critical/40 bg-critical/[0.06] px-3 py-2.5 text-[13px]">
            <p className="flex items-center gap-2 text-critical">
              <AlertTriangle className="h-4 w-4" aria-hidden /> This step could not finish
            </p>
            <p className="mt-1 text-fg/85">{state.error.message}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={demo.resume} className="rounded-[4px] border border-line-strong px-2.5 py-1 text-[12px] hover:border-cyan/50">
                Retry step
              </button>
              <button type="button" onClick={demo.next} className="rounded-[4px] px-2.5 py-1 text-[12px] text-muted hover:text-fg">
                Skip step
              </button>
            </div>
          </div>
        )}

        {decision && state.status === "awaiting_demo_decision" && (
          <div className="mt-3 rounded-[6px] border border-warning/40 bg-warning/[0.05] p-3" role="group" aria-label="Your decision">
            <p className="text-[13px] text-fg">{decision.prompt}</p>
            {decision.kind === "choice" ? (
              <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                {decision.options.map((o) => (
                  <button key={o.id} type="button" onClick={() => demo.decide(o.id)} className="rounded-[4px] border border-line-strong bg-bg px-3 py-2 text-left text-[13px] transition-colors hover:border-cyan/60 focus-visible:border-cyan">
                    {o.label}
                    {o.description && <span className="mt-0.5 block text-[11.5px] text-muted">{o.description}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
                <Loader2 className={cn("h-3.5 w-3.5", !demo.reducedMotion && "animate-spin")} aria-hidden /> Waiting for you. The walkthrough will not do this for you.
              </p>
            )}
          </div>
        )}

        <details className="mt-3 group" open>
          <summary className="cursor-pointer list-none font-mono text-[10px] tracking-[0.16em] text-muted hover:text-fg">WHY THIS MATTERS</summary>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{why}</p>
        </details>

        {timeline.length > 0 && <AgentTimeline events={timeline} />}

        {qaOpen && <AskPanel questions={scene.questions ?? []} />}
      </div>

      <footer className="flex items-center gap-1 border-t border-line px-2 py-2">
        <Ctl label="Previous step" onClick={demo.prev} disabled={state.sceneIndex === 0}>
          <ChevronLeft className="h-4 w-4" />
        </Ctl>
        {state.status === "paused" ? (
          <Ctl label="Resume" onClick={demo.resume} primary>
            <Play className="h-4 w-4" />
          </Ctl>
        ) : (
          <Ctl label="Pause" onClick={demo.pause} disabled={state.status === "error"}>
            <Pause className="h-4 w-4" />
          </Ctl>
        )}
        <Ctl label={decision?.kind === "human" ? "Skip this step" : "Next step"} onClick={demo.next}>
          <ChevronRight className="h-4 w-4" />
        </Ctl>
        <Ctl label="Replay from the start" onClick={demo.replay}>
          <RotateCcw className="h-4 w-4" />
        </Ctl>
        <button
          type="button"
          onClick={() => setQaOpen((o) => !o)}
          aria-expanded={qaOpen}
          className={cn("ml-auto inline-flex h-8 items-center gap-1.5 rounded-[4px] px-2.5 text-[12px] transition-colors", qaOpen ? "bg-cyan/10 text-cyan" : "text-muted hover:text-fg")}
        >
          <MessageCircleQuestion className="h-4 w-4" aria-hidden /> Ask about this step
        </button>
      </footer>
    </motion.aside>
  );
}

function Ctl({ label, onClick, disabled, primary, children }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn("inline-flex h-8 w-8 items-center justify-center rounded-[4px] transition-colors disabled:opacity-30", primary ? "bg-cyan text-bg hover:bg-ice" : "text-muted hover:bg-elevated hover:text-fg")}
    >
      {children}
    </button>
  );
}

function AgentTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="mt-3">
      <p className="font-mono text-[10px] tracking-[0.16em] text-muted">AGENT ACTIVITY</p>
      <ol className="mt-1.5 space-y-1">
        {events.map((ev) => {
          const s = STATUS[ev.status];
          const Icon = s.icon;
          return (
            <li key={ev.id} className="flex items-start gap-2 text-[12px]">
              <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.tone, ev.status === "running" && "animate-spin")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="text-fg/90">{AGENT_NAMES[ev.agent]}</span> <span className="text-muted">— {ev.label}</span>
                <span className="sr-only">. Status: {s.label}.</span>
              </span>
              <span className={cn("shrink-0 rounded-[3px] border px-1 font-mono text-[9px] leading-4 tracking-wider", ev.source === "live" ? "border-success/40 text-success" : ev.source === "engine" ? "border-cyan/30 text-cyan" : "border-purple/40 text-purple")}>
                {SOURCE_LABEL[ev.source]}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Grounded Q&A: answers are written from the walkthrough's own data, never generated. */
function AskPanel({ questions }: { questions: DemoQuestion[] }) {
  const demo = useDemo();
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [text, setText] = useState("");
  if (!demo) return null;
  const ask = (q: DemoQuestion) => setAnswer({ q: q.q, a: q.a(demo.ctx) });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const q = matchQuestion(questions, text);
    setAnswer(q ? { q: q.q, a: q.a(demo.ctx) } : { q: text, a: "I can only answer questions about this step from the walkthrough's own data. Try one of the questions above." });
    setText("");
  };
  return (
    <div className="mt-3 rounded-[6px] border border-line p-3">
      <ul className="flex flex-wrap gap-1.5">
        {questions.map((q) => (
          <li key={q.q}>
            <button type="button" onClick={() => ask(q)} className="rounded-full border border-line-strong px-2.5 py-1 text-left text-[11.5px] text-fg/85 hover:border-cyan/50">
              {q.q}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-2 flex gap-2">
        <label htmlFor="demo-ask" className="sr-only">
          Ask about this step
        </label>
        <input id="demo-ask" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type a question…" className="h-8 min-w-0 flex-1 rounded-[4px] border border-line-strong bg-bg px-2 text-[12.5px] outline-none focus:border-cyan/60" />
        <button type="submit" disabled={!text.trim()} className="rounded-[4px] border border-line-strong px-2.5 text-[12px] disabled:opacity-40">
          Ask
        </button>
      </form>
      <AnimatePresence mode="wait">
        {answer && (
          <motion.div key={answer.q} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2.5" aria-live="polite">
            <p className="text-[12px] text-muted">{answer.q}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-fg/90">{answer.a}</p>
            <p className="mt-1 font-mono text-[9.5px] tracking-[0.14em] text-faint">SCRIPTED ANSWER · GROUNDED IN THIS WALKTHROUGH&apos;S DATA</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
