import { cn } from "@/lib/client/cn";
import { formatTime } from "@/lib/client/format";
import type { TimelineItem } from "@/domain/viewmodel/reducer";

const DOT: Record<string, string> = { SUCCESS: "bg-success", FAILURE: "bg-critical", BLOCKED: "bg-critical", DENIED: "bg-critical", INFO: "bg-blue" };
const NODE_TAG: Record<string, string> = { core: "CORE", interpreter: "PARSE", scout: "SCOUT", risk: "RISK", optimizer: "OPTIM", policy: "POLICY", human: "HUMAN", paypal: "PAYPAL" };

export function Timeline({ items, highlightSeq, maxHeight = "max-h-[420px]" }: { items: TimelineItem[]; highlightSeq?: number; maxHeight?: string }) {
  if (items.length === 0) return <p className="text-xs text-muted">No events yet.</p>;
  return (
    <ol className={cn("relative overflow-y-auto pr-1", maxHeight)} aria-label="Execution timeline">
      {items.map((t) => (
        <li
          key={t.seq}
          className={cn("relative grid grid-cols-[52px_1fr] gap-3 border-l border-line py-2 pl-4 transition-colors", highlightSeq === t.seq && "border-cyan/60 bg-cyan/[0.05]")}
          aria-current={highlightSeq === t.seq ? "step" : undefined}
        >
          <span className={cn("absolute -left-[3.5px] top-[13px] h-1.5 w-1.5 rounded-full", DOT[t.outcome] ?? "bg-muted")} aria-hidden />
          <span className="pt-px font-mono text-[9.5px] tracking-[0.14em] text-faint">{NODE_TAG[t.node] ?? "CORE"}</span>
          <div className="min-w-0">
            <p className="text-xs leading-snug text-fg/90">{t.label}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-faint">
              #{t.seq} · {t.actor} · <span className="uppercase">{t.outcome}</span> · {formatTime(t.at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
