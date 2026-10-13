import { cn } from "@/lib/client/cn";
import { formatTime } from "@/lib/client/format";
import type { TimelineItem } from "@/domain/viewmodel/reducer";

const DOT: Record<string, string> = { SUCCESS: "bg-success", FAILURE: "bg-critical", BLOCKED: "bg-critical", DENIED: "bg-critical", INFO: "bg-blue" };

export function Timeline({ items, highlightSeq, maxHeight = "max-h-[420px]" }: { items: TimelineItem[]; highlightSeq?: number; maxHeight?: string }) {
  if (items.length === 0) return <p className="text-xs text-muted">No events yet.</p>;
  return (
    <ol className={cn("relative space-y-0 overflow-y-auto pr-1", maxHeight)} aria-label="Execution timeline">
      {items.map((t) => (
        <li key={t.seq} className={cn("relative flex gap-3 border-l border-line py-1.5 pl-4", highlightSeq === t.seq && "bg-cyan/5")} aria-current={highlightSeq === t.seq ? "step" : undefined}>
          <span className={cn("absolute -left-[4.5px] top-3 h-2 w-2 rounded-full", DOT[t.outcome] ?? "bg-muted")} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-fg">{t.label}</p>
            <p className="font-mono text-[10px] text-muted">
              #{t.seq} · {t.actor} · <span className="uppercase">{t.outcome}</span> · {formatTime(t.at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
