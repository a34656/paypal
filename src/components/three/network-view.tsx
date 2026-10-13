"use client";
import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { Box, Pause, Play, RotateCcw, Square } from "lucide-react";
import type { MissionViewModel, NodeId } from "@/domain/viewmodel/reducer";
import { SCENE_LABEL } from "@/domain/viewmodel/reducer";
import { cn } from "@/lib/client/cn";
import { SceneFallback } from "./scene-fallback";
import type { ProductMarker } from "./scene";

// Lazy-load the WebGL canvas; never server-rendered.
const AegisScene = dynamic(() => import("./scene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-muted">Loading 3D view…</div>,
});

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface NodeInfo {
  title: string;
  lines: ReactNode[];
}

export function NetworkView({
  vm,
  products,
  nodeInfo,
  className,
  height = "h-[360px]",
  caption,
}: {
  vm: MissionViewModel | null;
  products?: ProductMarker[];
  nodeInfo?: Partial<Record<NodeId, NodeInfo>>;
  className?: string;
  height?: string;
  caption?: ReactNode;
}) {
  const [mode, setMode] = useState<"3d" | "2d" | null>(null);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<NodeId | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = (navigator.hardwareConcurrency ?? 8) <= 2 || window.innerWidth < 480;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability detection after mount
    setMode(!webglAvailable() || reduced || lowPower ? "2d" : "3d");
  }, []);

  const info = selected ? nodeInfo?.[selected] : undefined;

  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-panel)] border border-line bg-bg", className)}>
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        <span className="rounded border border-line bg-bg/80 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-muted">
          State: <span className="text-cyan">{vm ? SCENE_LABEL[vm.scene] : "Idle"}</span>
        </span>
      </div>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1" role="toolbar" aria-label="Network view controls">
        {mode === "3d" && (
          <>
            <button className="rounded border border-line bg-bg/80 p-1.5 text-muted hover:text-fg" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Resume animation" : "Pause animation"}>
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
            <button className="rounded border border-line bg-bg/80 p-1.5 text-muted hover:text-fg" onClick={() => setResetKey((k) => k + 1)} aria-label="Reset camera">
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button className="rounded border border-line bg-bg/80 p-1.5 text-muted hover:text-fg" onClick={() => setMode((m) => (m === "3d" ? "2d" : "3d"))} aria-label={mode === "3d" ? "Switch to 2D view" : "Switch to 3D view"}>
          {mode === "3d" ? <Square className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className={cn("w-full", height)}>
        {mode === "3d" && <AegisScene vm={vm} products={products} paused={paused} selected={selected} onSelect={setSelected} resetKey={resetKey} />}
        {mode === "2d" && <SceneFallback vm={vm} products={products} selected={selected} onSelect={setSelected} />}
      </div>
      {info && (
        <div className="absolute bottom-3 left-3 z-10 max-w-xs rounded-md border border-line-strong bg-elevated/95 p-3 text-xs shadow-xl" role="dialog" aria-label={`${info.title} details`}>
          <div className="mb-1 flex items-center justify-between gap-4">
            <p className="font-semibold text-fg">{info.title}</p>
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
      {caption && <div className="absolute bottom-3 right-3 z-10 max-w-[42%] text-right text-[11px] text-muted">{caption}</div>}
    </div>
  );
}
