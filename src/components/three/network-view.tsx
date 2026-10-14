"use client";
import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertOctagon, Box, Pause, Play, RotateCcw, Square } from "lucide-react";
import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";
import { SCENE_LABEL } from "@/domain/viewmodel/reducer";
import { cn } from "@/lib/client/cn";
import { useOnScreen, useRenderCapability } from "@/lib/client/render-capability";
import { SceneFallback } from "./scene-fallback";
import type { ProductMarker } from "./scene";

// Lazy-load the WebGL canvas; never server-rendered.
const AegisScene = dynamic(() => import("./scene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center font-mono text-[10px] tracking-[0.2em] text-faint">LOADING NETWORK RENDERER…</div>,
});

export interface NodeInfo {
  title: string;
  lines: ReactNode[];
}

const VERDICT: Record<string, { label: string; cls: string }> = {
  ALLOW_CHECKOUT: { label: "ALLOWED", cls: "border-success/40 text-success" },
  REQUIRE_APPROVAL: { label: "APPROVAL REQUIRED", cls: "border-warning/40 text-warning" },
  BLOCK: { label: "BLOCKED", cls: "border-critical/45 text-critical" },
};

export function NetworkView({
  vm,
  products,
  nodeInfo,
  className,
  height = "h-[360px]",
  caption,
  compact = false,
}: {
  vm: MissionViewModel | null;
  products?: ProductMarker[];
  nodeInfo?: Partial<Record<NodeId, NodeInfo>>;
  className?: string;
  height?: string;
  caption?: ReactNode;
  compact?: boolean;
}) {
  const cap = useRenderCapability();
  const [override, setOverride] = useState<"3d" | "2d" | null>(null);
  const [lost, setLost] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(root, "100px");

  const mode = lost ? "2d" : (override ?? cap.mode);
  const info = selected ? nodeInfo?.[selected] : undefined;
  const verdict = vm?.decision ? VERDICT[vm.decision] : null;
  const showEvidence = !compact && !!vm && (vm.steps.RISK === "running" || (vm.scene === "RISK" && vm.steps.RISK === "done")) && (products?.some((p) => p.risk != null) ?? false);
  const evidence = (products ?? []).filter((p) => p.risk != null).sort((a, b) => (a.risk ?? 0) - (b.risk ?? 0)).slice(0, 3);

  return (
    <div ref={root} className={cn("relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-[radial-gradient(90%_70%_at_50%_45%,#0b0f17,#050608)]", className)}>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <span className="rounded-[3px] border border-line bg-bg/70 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint backdrop-blur">
          State · <span className={vm?.scene === "FAILED" || vm?.scene === "BLOCKED" ? "text-critical" : "text-cyan"}>{vm ? SCENE_LABEL[vm.scene] : "Idle"}</span>
        </span>
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1" role="toolbar" aria-label="Network view controls">
        {mode === "3d" && (
          <>
            <button className="rounded-[3px] border border-line bg-bg/70 p-1.5 text-muted hover:text-fg" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume animation" : "Pause animation"}>
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
            <button className="rounded-[3px] border border-line bg-bg/70 p-1.5 text-muted hover:text-fg" onClick={() => setResetKey((k) => k + 1)} aria-label="Reset camera">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {mode !== null && !lost && (
          <button className="rounded-[3px] border border-line bg-bg/70 p-1.5 text-muted hover:text-fg" onClick={() => setOverride(mode === "3d" ? "2d" : "3d")} aria-label={mode === "3d" ? "Switch to 2D view" : "Switch to 3D view"}>
            {mode === "3d" ? <Square className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <div className={cn("w-full", height)}>
        {mode === "3d" && (
          <AegisScene vm={vm} products={products} paused={paused || !onScreen} selected={selected} onSelect={setSelected} resetKey={resetKey} lowPower={cap.lowPower} onContextLost={() => setLost(true)} />
        )}
        {mode === "2d" && <SceneFallback vm={vm} products={products} selected={selected} onSelect={setSelected} />}
      </div>

      {/* Policy verdict ribbon: shown once Policy Guard has recorded a decision. */}
      <AnimatePresence>
        {verdict && !compact && (
          <motion.div
            key={vm?.decision}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className={cn("absolute left-3 top-12 z-10 rounded-[3px] border bg-bg/80 px-3 py-1 font-mono text-[10.5px] tracking-[0.22em] backdrop-blur", verdict.cls)}
            role="status"
          >
            POLICY GUARD · {verdict.label}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Evidence panel while Risk is (or just was) the focus — persisted risk rows only. */}
      <AnimatePresence>
        {showEvidence && (
          <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="absolute bottom-3 left-3 z-10 w-64 rounded-[4px] border border-warning/25 bg-bg/85 p-3 backdrop-blur">
            <p className="tech-label !text-warning">Risk evidence</p>
            <ul className="mt-2 space-y-1.5">
              {evidence.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate text-fg/85">{p.label}</span>
                  <span className="shrink-0 font-mono text-muted">
                    r{p.risk} · {p.coverage ?? "—"}%
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {vm?.scene === "FAILED" && !compact && (
        <div className="absolute inset-x-3 bottom-3 z-10 flex items-start gap-2 rounded-[4px] border border-critical/35 bg-bg/90 p-3 text-xs backdrop-blur" role="alert">
          <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden />
          <div>
            <p className="text-critical">A step failed. Nothing was purchased.</p>
            <p className="mt-0.5 text-muted">The workflow is resumable: steps are idempotent and nothing past the failure ran. See the timeline for the recorded error.</p>
          </div>
        </div>
      )}

      {info && (
        <div className="absolute bottom-3 right-3 z-20 max-w-xs rounded-[4px] border border-line-strong bg-elevated/95 p-3 text-xs shadow-2xl backdrop-blur" role="dialog" aria-label={`${info.title} details`}>
          <div className="mb-1.5 flex items-center justify-between gap-4">
            <p className="tech-label !text-fg">{info.title}</p>
            <button className="text-muted hover:text-fg" onClick={() => setSelected(null)} aria-label="Close details">
              ✕
            </button>
          </div>
          <ul className="space-y-0.5 text-muted">
            {info.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {caption && !info && <div className="absolute bottom-3 right-3 z-10 max-w-[46%] text-right text-[11px] text-faint">{caption}</div>}
    </div>
  );
}
