"use client";

import { AlertTriangle, Ban, CheckCircle2, HelpCircle } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { HoverCard } from "@/components/ui/hover-card";
import type { PolicyCheckDTO } from "@/components/mission/types";

interface PolicyCheckItemProps {
  check: PolicyCheckDTO;
  className?: string;
}

const RESULT_STYLE: Record<string, { icon: React.ReactNode; color: string }> = {
  PASS: { icon: <CheckCircle2 className="h-4 w-4" />, color: "text-success" },
  REQUIRE_APPROVAL: { icon: <AlertTriangle className="h-4 w-4" />, color: "text-warning" },
  BLOCK: { icon: <Ban className="h-4 w-4" />, color: "text-critical" },
};

export function PolicyCheckItem({ check, className }: PolicyCheckItemProps) {
  const style = RESULT_STYLE[check.result] ?? { icon: <HelpCircle className="h-4 w-4" />, color: "text-muted" };

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[4px] px-3 py-2.5 border transition-colors",
        {
          "border-success/20 bg-success/[0.04]": check.result === "PASS",
          "border-warning/20 bg-warning/[0.04]": check.result === "REQUIRE_APPROVAL",
          "border-critical/20 bg-critical/[0.04]": check.result === "BLOCK",
        },
        className,
      )}
    >
      <span className={cn("mt-px shrink-0", style.color)} aria-hidden>
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <HoverCard
          trigger={
            <button
              type="button"
              className="text-left text-xs font-medium text-fg/90 hover:text-fg hover:underline focus:outline-none focus-visible:underline"
            >
              {check.label}
            </button>
          }
          side="right"
        >
          <p className="mb-2 font-mono text-[10px] tracking-[0.14em] text-faint uppercase">
            {check.result.replace(/_/g, " ")}
          </p>
          <p className="text-xs leading-relaxed text-fg/85">{check.detail}</p>
          {check.floor && (
            <p className="mt-1.5 text-[10px] text-warning">
              This is a floor check — it cannot be overridden.
            </p>
          )}
        </HoverCard>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{check.detail}</p>
      </div>
    </div>
  );
}

