"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Star } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/components/ui/badge";
import { cn } from "@/lib/client/cn";
import type { MissionProductDTO } from "./types";

function Bar({ value, tone }: { value: number; tone: "trust" | "coverage" }) {
  const color = tone === "trust" ? (value >= 75 ? "bg-success" : value >= 40 ? "bg-warning" : "bg-critical") : value >= 70 ? "bg-cyan" : "bg-warning";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-line" aria-hidden>
        <div className={cn("h-full", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums">{value}</span>
    </div>
  );
}

export function Comparison({ products, recommendedProductId, currency }: { products: MissionProductDTO[]; recommendedProductId: string | null; currency: string }) {
  const [open, setOpen] = useState<string | null>(recommendedProductId);
  if (products.length === 0) return <p className="p-4 text-sm text-muted">No candidates yet. Run the workflow to search the provider.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <caption className="sr-only">Candidate offers with all-in totals, trust, evidence coverage and policy decision</caption>
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="w-8 px-3 py-2" />
            <th className="px-3 py-2">Offer</th>
            <th className="px-3 py-2">Seller</th>
            <th className="px-3 py-2 text-right">All-in total</th>
            <th className="px-3 py-2">Trust</th>
            <th className="px-3 py-2">Evidence</th>
            <th className="px-3 py-2">Rank</th>
            <th className="px-3 py-2">Policy</th>
          </tr>
        </thead>
        <tbody>
          {products.map((mp) => {
            const isRec = mp.productId === recommendedProductId;
            const expanded = open === mp.productId;
            return (
              <Fragment key={mp.id}>
                <tr className={cn("border-b border-line/60 align-top hover:bg-elevated/40", isRec && "bg-cyan/5")}>
                  <td className="px-3 py-2.5">
                    <button onClick={() => setOpen(expanded ? null : mp.productId)} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for ${mp.product.title}`} className="text-muted hover:text-fg">
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="max-w-[280px] px-3 py-2.5">
                    <div className="flex items-start gap-1.5">
                      {isRec && <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-cyan text-cyan" aria-label="Recommended" />}
                      {/* Untrusted listing text: rendered as plain text only. */}
                      <span className="line-clamp-2">{mp.product.title}</span>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted">
                      {mp.quantity} × {formatMoney(mp.product.unitPriceMinor, mp.product.currency)}
                      {mp.product.isDemoData && <span className="ml-2 rounded bg-purple/10 px-1 text-purple">DEMO DATA</span>}
                      {!mp.product.isDemoData && <span className="ml-2 rounded bg-blue/10 px-1 text-blue">LIVE · {mp.product.provider}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="line-clamp-1 max-w-[180px]">{mp.product.sellerName ?? <em className="text-muted">undisclosed</em>}</span>
                    <StatusBadge status={mp.product.sellerVerificationStatus} className="mt-1" />
                    {mp.product.metadata?.sellerTrustBasis === "policy-trusted-domain" && <span className="mt-0.5 block text-[10px] text-muted">trusted by your policy</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {mp.totalMinor == null ? (
                      <span className="text-warning">unknown</span>
                    ) : mp.amountBasis === "CAP" ? (
                      <span title="Shipping/tax undisclosed: upper bound enforced by a PayPal authorization hold">
                        ≤ {formatMoney(mp.totalMinor, currency)}
                        <span className="block text-[10px] font-sans uppercase tracking-wide text-cyan">spending cap</span>
                      </span>
                    ) : (
                      formatMoney(mp.totalMinor, currency)
                    )}
                  </td>
                  <td className="px-3 py-2.5">{mp.trustScore == null ? "—" : <Bar value={mp.trustScore} tone="trust" />}</td>
                  <td className="px-3 py-2.5">{mp.evidenceCoverage == null ? "—" : <Bar value={mp.evidenceCoverage} tone="coverage" />}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{mp.recommendationRank ? `#${mp.recommendationRank}` : <span className="text-muted">not ranked</span>}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={mp.policyDecision} />
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-line bg-bg/60">
                    <td colSpan={8} className="px-4 py-4">
                      <ProductDetail mp={mp} currency={currency} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductDetail({ mp, currency }: { mp: MissionProductDTO; currency: string }) {
  const p = mp.product;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Offer evidence</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Unit price</dt>
          <dd className="font-mono">{formatMoney(p.unitPriceMinor, p.currency)}</dd>
          <dt className="text-muted">Shipping</dt>
          <dd className="font-mono">{p.shippingMinor == null ? <span className="text-warning">not disclosed</span> : formatMoney(p.shippingMinor, p.currency)}</dd>
          <dt className="text-muted">Tax</dt>
          <dd className="font-mono">{p.taxMinor == null ? <span className="text-warning">not disclosed</span> : formatMoney(p.taxMinor, p.currency)}</dd>
          <dt className="text-muted">{mp.amountBasis === "CAP" ? "Spending cap" : "All-in total"}</dt>
          <dd className="font-mono">
            {mp.totalMinor == null ? <span className="text-warning">unknown</span> : formatMoney(mp.totalMinor, currency)}
            {mp.amountBasis === "CAP" && mp.allowanceMinor != null && <span className="block font-sans text-muted">includes {formatMoney(mp.allowanceMinor, currency)} allowance for undisclosed shipping/tax</span>}
          </dd>
          {p.metadata?.baselineUnitPriceMinor != null && (
            <>
              <dt className="text-muted">Reference price</dt>
              <dd className="font-mono">
                {formatMoney(p.metadata.baselineUnitPriceMinor, p.currency)}{" "}
                <span className="font-sans text-muted">({(p.metadata.baselineSource ?? "provider").replace(/-/g, " ")})</span>
              </dd>
            </>
          )}
          <dt className="text-muted">Delivery</dt>
          <dd>{p.shippingEstimateDays == null ? <span className="text-warning">no estimate</span> : `${p.shippingEstimateDays} days`}</dd>
          <dt className="text-muted">Stock</dt>
          <dd>{p.stockQuantity ?? (p.metadata?.inStock ? "in stock (quantity not disclosed)" : <span className="text-warning">not disclosed</span>)}</dd>
          {Object.entries(p.attributes).map(([k, v]) => (
            <Fragment key={k}>
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </Fragment>
          ))}
        </dl>
        {p.metadata?.offerUrl && (
          <a href={p.metadata.offerUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-cyan hover:underline">
            View offer at {p.sellerId ?? "retailer"} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
        {p.description && (
          <p className="rounded border border-line bg-bg-2 p-2 text-muted">
            <span className="block text-[10px] uppercase tracking-wider">Listing text (untrusted, shown as data)</span>
            {p.description}
          </p>
        )}
      </div>
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Risk factors {mp.riskScore != null && <span className="ml-1 font-mono normal-case text-fg">risk {mp.riskScore}/100 · trust {mp.trustScore}</span>}
        </h4>
        <ul className="space-y-1.5">
          {mp.riskEvidence?.factors.map((f) => (
            <li key={f.id} className="flex items-start gap-2">
              <span className={cn("mt-0.5 w-12 shrink-0 text-right font-mono", f.contribution > 0 ? (f.status === "MISSING" ? "text-warning" : "text-critical") : "text-success")}>+{f.contribution}</span>
              <span>
                <span className="text-fg">{f.label}</span> <span className="text-[10px] uppercase text-muted">({f.status.toLowerCase()})</span>
                <span className="block text-muted">{f.evidence}</span>
              </span>
            </li>
          ))}
        </ul>
        {mp.riskEvidence && <p className="text-[11px] italic text-muted">{mp.riskEvidence.basis}</p>}
      </div>
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Policy checks</h4>
        <ul className="space-y-1">
          {mp.policyResult?.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2">
              <span className={cn("w-[74px] shrink-0 font-mono text-[10px] uppercase", c.result === "PASS" ? "text-success" : c.result === "BLOCK" ? "text-critical" : "text-warning")}>
                {c.result === "REQUIRE_APPROVAL" ? "APPROVAL" : c.result}
              </span>
              <span>
                {c.label}
                {c.floor && <span className="ml-1 rounded bg-line px-1 text-[9px] uppercase text-muted">floor</span>}
                <span className="block text-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {mp.optimizerExplanation && <p className="border-t border-line pt-2 text-muted">{mp.optimizerExplanation}</p>}
      </div>
    </div>
  );
}
