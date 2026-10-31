"use client";

import { cn } from "@/lib/client/cn";
import { formatTime } from "@/lib/client/format";
import type { TimelineItem } from "@/domain/viewmodel/reducer";

const NODE_LABEL: Record<string, string> = {
  core: "CORE",
  interpreter: "PARSE",
  scout: "SCOUT",
  risk: "RISK",
  optimizer: "OPTIM",
  policy: "POLICY",
  human: "HUMAN",
  paypal: "PAYPAL",
};

const OUTCOME_DOT: Record<string, string> = {
  SUCCESS: "bg-success",
  FAILURE: "bg-critical",
  BLOCKED: "bg-critical",
  DENIED: "bg-critical",
  INFO: "bg-blue",
};

interface TransactionAuditProps {
  items: TimelineItem[];
  className?: string;
}

export function TransactionAudit({ items, className }: TransactionAuditProps) {
  if (items.length === 0) {
    return (
      <div className={cn("rounded-[4px] border border-line bg-elevated/30 px-4 py-6 text-center", className)}>
        <p className="text-xs text-muted">No audit events recorded yet.</p>
      </div>
    );
  }

  return (
    <details className={cn("group rounded-[4px] border border-line bg-elevated/20", className)}>
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted hover:text-fg list-none [&::-webkit-details-marker]:hidden">
        <span>Transaction Audit Trail</span>
        <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px]">{items.length}</span>
      </summary>
      <ol className="max-h-[380px] overflow-y-auto divide-y divide-line/40 border-t border-line/60" aria-label="Audit trail">
        {items.map((item) => (
          <li key={item.seq} className="grid grid-cols-[44px_1fr] gap-3 px-4 py-2.5">
            <span className="pt-0.5 font-mono text-[9px] tracking-[0.12em] text-faint">{NODE_LABEL[item.node] ?? "CORE"}</span>
            <div>
              <p className="text-xs leading-snug text-fg/90">{item.label}</p>
              <p className="mt-0.5 font-mono text-[10px] text-faint">
                #{item.seq} · <span className={cn("uppercase", OUTCOME_DOT[item.outcome] ? "" : "text-muted")}>{item.outcome}</span> · {formatTime(item.at)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

