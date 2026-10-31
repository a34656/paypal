"use client";

import Image from "next/image";
import { AlertTriangle } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { cn } from "@/lib/client/cn";
import { formatMoney, CURRENCY_EXPONENTS, type Currency } from "@/lib/money";
import type { MissionProductDTO, MissionDTO } from "@/components/mission/types";

interface PurchaseSummaryProps {
  mission: MissionDTO;
  product: MissionProductDTO;
  className?: string;
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className={cn("text-xs", bold ? "text-fg/80 font-medium" : "text-muted")}>{label}</dt>
      <dd className={cn("font-mono tabular-nums", bold ? "text-lg text-fg" : "text-sm text-fg/90")}>{value}</dd>
    </div>
  );
}

export function PurchaseSummary({ mission, product, className }: PurchaseSummaryProps) {
  const p = product.product;
  const currency = p.currency ?? mission.currency ?? "USD";
  const subtotal = p.unitPriceMinor * product.quantity;
  const isCap = product.amountBasis === "CAP";

  return (
    <div className={cn("space-y-4", className)}>
      {/* Product identity */}
      <div className="flex gap-3">
        {p.imageUrl ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[4px] border border-line bg-elevated">
            <Image
              src={p.imageUrl}
              alt={p.title}
              fill
              className="object-cover"
              sizes="64px"
              unoptimized
            />
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[4px] border border-line bg-elevated">
            <span className="font-mono text-[10px] text-faint">NO IMG</span>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug text-fg">{p.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {p.sellerName ?? "Unknown seller"}
            {p.sellerVerificationStatus === "VERIFIED" && (
              <span className="ml-1.5 text-success">· Verified</span>
            )}
          </p>
          {p.isDemoData && (
            <span className="mt-1 inline-block rounded bg-purple/10 px-1.5 py-0.5 font-mono text-[9px] text-purple tracking-[0.1em] uppercase">
              Demo data
            </span>
          )}
        </div>
      </div>

      {/* Itemized amounts */}
      <dl className="divide-y divide-line/60">
        <Row label={`${product.quantity} × ${formatMoney(p.unitPriceMinor, currency)}`} value={formatMoney(subtotal, currency)} />
        <Row
          label="Shipping"
          value={
            p.shippingMinor == null ? (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3 w-3" aria-hidden /> Not provided{isCap ? " · in cap" : ""}
              </span>
            ) : (
              formatMoney(p.shippingMinor, currency)
            )
          }
        />
        <Row
          label="Tax"
          value={
            p.taxMinor == null ? (
              <span className="flex items-center gap-1 text-warning">
                <AlertTriangle className="h-3 w-3" aria-hidden /> Not provided{isCap ? " · in cap" : ""}
              </span>
            ) : (
              formatMoney(p.taxMinor, currency)
            )
          }
        />
        {isCap && product.allowanceMinor != null && (
          <Row label={`Undisclosed cost allowance (${mission.parsedProposal ? "" : ""}cap)`} value={formatMoney(product.allowanceMinor, currency)} />
        )}
        <div className="flex items-baseline justify-between gap-3 pt-3">
          <dt className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-fg/70">
            {isCap ? "Maximum · Spending cap" : "Total · All-in"}
          </dt>
          <dd className="font-mono text-2xl font-semibold tabular-nums text-fg flex items-baseline">
            {product.totalMinor == null ? (
              <span className="text-warning text-base">Cannot be stated</span>
            ) : (
              <>
                {isCap && <span className="mr-1">≤</span>}
                <NumberFlow
                  value={product.totalMinor / 10 ** (CURRENCY_EXPONENTS[currency as Currency] ?? 2)}
                  format={{
                    style: "currency",
                    currency: currency,
                    minimumFractionDigits: CURRENCY_EXPONENTS[currency as Currency] ?? 2,
                    maximumFractionDigits: CURRENCY_EXPONENTS[currency as Currency] ?? 2,
                  }}
                />
              </>
            )}
          </dd>
        </div>
      </dl>

      {isCap && (
        <p className="rounded-[4px] border border-warning/25 bg-warning/5 px-3 py-2 text-xs leading-relaxed text-warning">
          Shipping and tax are not disclosed by this seller. The spending cap includes an allowance for undisclosed costs.
          The final amount will be settled at the real cost, which can never exceed this cap.
        </p>
      )}
    </div>
  );
}

