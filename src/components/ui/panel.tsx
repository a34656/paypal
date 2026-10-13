import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/client/cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-[var(--radius-panel)] border border-line bg-bg-2/80", className)} {...props} />;
}

export function PanelHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-fg">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "success" | "warning" | "critical" | "cyan" }) {
  const toneClass = { default: "text-fg", success: "text-success", warning: "text-warning", critical: "text-critical", cyan: "text-cyan" }[tone];
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={cn("mt-1 truncate font-mono text-xl font-semibold tabular-nums", toneClass)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
