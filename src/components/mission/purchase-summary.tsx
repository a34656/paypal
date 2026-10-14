"use client";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/client/cn";
import type { MissionProductDTO } from "./types";

/** Itemized amount, exactly as the server computed it. Unknown stays unknown. */
export function ItemizedTotal({ mp, currency, className }: { mp: MissionProductDTO; currency: string; className?: string }) {
  const p = mp.product;
  const subtotal = p.unitPriceMinor * mp.quantity;
  const cap = mp.amountBasis === "CAP";
  const row = (label: string, value: React.ReactNode, tone?: string) => (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("font-mono text-[13px] tabular-nums", tone)}>{value}</dd>
    </div>
  );
  return (
    <dl className={cn("divide-y divide-line/70", className)}>
      {row(`${mp.quantity} × ${formatMoney(p.unitPriceMinor, p.currency)}`, formatMoney(subtotal, p.currency))}
      {row("Shipping", p.shippingMinor == null ? <span className="text-warning">unknown{cap ? " · in allowance" : ""}</span> : formatMoney(p.shippingMinor, p.currency))}
      {row("Tax", p.taxMinor == null ? <span className="text-warning">unknown{cap ? " · in allowance" : ""}</span> : formatMoney(p.taxMinor, p.currency))}
      {cap && mp.allowanceMinor != null && row("Allowance (upper bound)", formatMoney(mp.allowanceMinor, currency), "text-muted")}
      <div className="flex items-baseline justify-between gap-4 pt-2.5">
        <dt className="tech-label !text-fg/80">{cap ? "Maximum · spending cap" : "Total · all-in"}</dt>
        <dd className="font-mono text-lg tabular-nums text-fg">{mp.totalMinor == null ? <span className="text-warning">cannot be stated</span> : `${cap ? "≤ " : ""}${formatMoney(mp.totalMinor, currency)}`}</dd>
      </div>
    </dl>
  );
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  OK: { label: "ok", cls: "text-success" },
  CONCERN: { label: "concern", cls: "text-warning" },
  MISSING: { label: "unknown", cls: "text-muted" },
};

/** Risk with its contributing factors. "Unknown" means not disclosed — it raises risk, it is not an accusation. */
export function RiskSummary({ mp, limit = 4 }: { mp: MissionProductDTO; limit?: number }) {
  if (mp.riskScore == null) return <p className="text-xs text-muted">Not assessed yet.</p>;
  const factors = (mp.riskEvidence?.factors ?? []).filter((f) => f.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const level = mp.riskLevel ?? "";
  const tone = level === "LOW" ? "text-success" : level === "MEDIUM" ? "text-warning" : "text-critical";
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="tech-label">Risk</p>
          <p className={cn("mt-1 font-mono text-3xl font-light tabular-nums leading-none", tone)}>
            {mp.riskScore}
            <span className="text-sm text-faint">/100</span>
          </p>
        </div>
        <div className="text-right">
          <p className="tech-label">Evidence</p>
          <p className="mt-1 font-mono text-sm tabular-nums">{mp.evidenceCoverage ?? "—"}%</p>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className={cn("h-full", level === "LOW" ? "bg-success" : level === "MEDIUM" ? "bg-warning" : "bg-critical")} style={{ width: `${mp.riskScore}%` }} />
      </div>
      {factors.length === 0 ? (
        <p className="text-xs text-success">No factor added risk.</p>
      ) : (
        <ul className="space-y-1.5">
          {factors.slice(0, limit).map((f) => (
            <li key={f.id} className="grid grid-cols-[32px_1fr] gap-2 text-xs">
              <span className="text-right font-mono text-faint">+{f.contribution}</span>
              <span className="min-w-0">
                <span className="text-fg/90">{f.label}</span> <span className={cn("font-mono text-[10px] uppercase", STATUS_LABEL[f.status]?.cls)}>{STATUS_LABEL[f.status]?.label}</span>
                <span className="block truncate text-faint" title={f.evidence}>
                  {f.evidence}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-faint">Unknown = the seller or catalogue did not disclose it. It raises risk; it is not evidence of fraud.</p>
    </div>
  );
}
