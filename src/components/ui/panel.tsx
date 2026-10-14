import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/client/cn";

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn("surface rounded-[var(--radius-panel)]", className)} {...props} />;
}

export function PanelHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line/80 px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-fg/85 [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>}
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
      <div className="tech-label">{label}</div>
      <div className={cn("mt-1.5 truncate font-mono text-[22px] font-light leading-none tabular-nums", toneClass)}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}
