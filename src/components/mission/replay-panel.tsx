"use client";
/**
 * Replay is structurally read-only: it consumes events already fetched over GET and runs the
 * same pure reducer client-side. It makes no network requests at all — no writes, no provider
 * calls, no capture.
 */
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { reduceEvents, SCENE_LABEL, type MissionEvent } from "@/domain/viewmodel/reducer";
import { NetworkView } from "@/components/three/network-view";
import { Button } from "@/components/ui/button";
import { Timeline } from "./timeline";
import type { ProductMarker } from "@/components/three/scene";

const SPEEDS = [0.5, 1, 2, 4];

export function ReplayPanel({ events, products }: { events: MissionEvent[]; products: ProductMarker[] }) {
  const [index, setIndex] = useState(0); // number of events applied
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const total = events.length;

  useEffect(() => {
    if (!playing) return;
    if (index >= total) {
      setPlaying(false); // eslint-disable-line react-hooks/set-state-in-effect -- stop at the end of the stream
      return;
    }
    const t = setTimeout(() => setIndex((i) => Math.min(total, i + 1)), 900 / speed);
    return () => clearTimeout(t);
  }, [playing, index, total, speed]);

  const upTo = index === 0 ? 0 : events[index - 1].seq;
  const vm = useMemo(() => reduceEvents(events, upTo), [events, upTo]);
  const current = index > 0 ? events[index - 1] : null;

  return (
    <div className="space-y-3" data-testid="replay-panel">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Replay controls">
        <Button size="sm" onClick={() => setPlaying((p) => !p)} disabled={total === 0} aria-label={playing ? "Pause replay" : "Play replay"} data-testid="replay-play">
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setIndex(0);
            setPlaying(false);
          }}
          aria-label="Restart replay"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Restart
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded border border-line-strong bg-bg px-1.5 py-1 text-xs text-fg">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 items-center gap-2 text-xs text-muted">
          <span className="sr-only">Replay position</span>
          <input type="range" min={0} max={total} value={index} onChange={(e) => setIndex(Number(e.target.value))} className="w-full accent-[#56E0F0]" data-testid="replay-scrubber" />
          <span className="w-14 text-right font-mono">
            {index}/{total}
          </span>
        </label>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <NetworkView vm={vm} products={products} height="h-[300px]" caption={<span className="rounded bg-bg/80 px-1.5 py-0.5">Replay · read-only · {SCENE_LABEL[vm.scene]}</span>} />
        <div className="space-y-2">
          <div className="rounded-md border border-line p-3 text-xs" aria-live="polite">
            <p className="text-[11px] uppercase tracking-wider text-muted">Current event</p>
            {current ? (
              <>
                <p className="mt-1 text-sm text-fg">{vm.lastEvent?.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted">
                  #{current.seq} · {current.eventType} · {current.actor} · schema v{current.schemaVersion} · {current.mode}
                </p>
                <pre className="mt-2 max-h-32 overflow-auto rounded bg-bg p-2 font-mono text-[10px] text-muted">{JSON.stringify(current.metadata, null, 2)}</pre>
              </>
            ) : (
              <p className="mt-1 text-muted">Press play or drag the scrubber.</p>
            )}
          </div>
          <Timeline items={vm.timeline} highlightSeq={current?.seq} maxHeight="max-h-[160px]" />
        </div>
      </div>
    </div>
  );
}
