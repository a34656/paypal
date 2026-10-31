"use client";

import Link from "next/link";
import { CheckCircle2, Printer, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";

import { cn } from "@/lib/client/cn";
import { CURRENCY_EXPONENTS, formatMoney, type Currency } from "@/lib/money";
import { formatTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import type { PaymentDTO, MissionProductDTO, MissionDTO } from "@/components/mission/types";
import type { TimelineItem } from "@/domain/viewmodel/reducer";

interface PaymentSuccessProps {
  mission: MissionDTO;
  product: MissionProductDTO;
  payment: PaymentDTO;
  timeline?: TimelineItem[];
  className?: string;
}

export function PaymentSuccess({
  mission,
  product,
  payment,
  timeline = [],
  className,
}: PaymentSuccessProps) {
  const p = product.product;
  const currency = payment.currency || p.currency || mission.currency || "USD";
  const exp = CURRENCY_EXPONENTS[currency as Currency] ?? 2;
  const effectiveMinor = payment.settledMinor ?? payment.amountMinor;
  const amountMajor = effectiveMinor / 10 ** exp;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn("surface rounded-[var(--radius-panel)] p-6 sm:p-8 space-y-6 max-w-2xl mx-auto print:border-none print:shadow-none", className)}
    >
      {/* Success header */}
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 border border-success/30 shadow-[0_0_32px_-8px_rgb(82_211_163/0.6)]">
          <CheckCircle2 className="h-8 w-8 text-success" aria-hidden />
        </div>
        <div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-success uppercase">Transaction Verified · Official Receipt</span>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-fg mt-1">Payment Successful</h2>
          <p className="text-xs text-muted max-w-md mx-auto mt-1 leading-relaxed">
            Your purchase has been securely processed and recorded through VANTA&apos;s governance layer.
          </p>
        </div>
        <div className="pt-2 font-mono text-3xl font-light tabular-nums text-fg flex items-baseline justify-center">
          <NumberFlow
            value={amountMajor}
            format={{
              style: "currency",
              currency: currency,
              minimumFractionDigits: exp,
              maximumFractionDigits: exp,
            }}
          />
        </div>
      </div>

      {/* Transaction details card */}
      <div className="rounded-[4px] border border-line bg-elevated/40 divide-y divide-line/60 text-xs">
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Product</span>
          <span className="font-medium text-fg text-right max-w-[65%] truncate">{p.title}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Seller</span>
          <span className="text-fg">{p.sellerName ?? "Unknown seller"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Mission ID</span>
          <span className="font-mono text-faint">#{mission.id.slice(0, 16)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Payment ID</span>
          <span className="font-mono text-faint">{payment.id}</span>
        </div>
        {payment.providerCaptureId && (
          <div className="flex items-baseline justify-between gap-4 p-3">
            <span className="text-muted">PayPal Capture ID</span>
            <span className="font-mono text-faint">{payment.providerCaptureId}</span>
          </div>
        )}
        {payment.settledMinor != null && (
          <div className="flex items-baseline justify-between gap-4 p-3">
            <span className="text-muted">Settled Amount</span>
            <span className="font-mono text-fg">{formatMoney(payment.settledMinor, currency)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Payment Provider</span>
          <span className="text-fg capitalize">{payment.provider === "simulated" ? "Simulated (Demo)" : "PayPal Sandbox"}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Timestamp</span>
          <span className="font-mono text-faint">{formatTime(payment.createdAt)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-4 p-3">
          <span className="text-muted">Status</span>
          <span className="font-mono text-success uppercase tracking-[0.08em] flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Captured
          </span>
        </div>
      </div>

      {/* Verified timeline sequence (only real events) */}
      {timeline.length > 0 && (
        <div className="space-y-2">
          <p className="tech-label">Verified Event Sequence</p>
          <ol className="divide-y divide-line/40 rounded-[4px] border border-line bg-elevated/20 max-h-48 overflow-y-auto">
            {timeline.slice(-6).map((item) => (
              <li key={item.seq} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span className="text-fg/85 truncate">{item.label}</span>
                <span className="font-mono text-[10px] text-faint shrink-0">{formatTime(item.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Action links */}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2 print:hidden">
        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            if (typeof window !== "undefined") window.print();
          }}
          className="gap-1.5"
        >
          <Printer className="h-4 w-4" aria-hidden />
          <span>Print Receipt</span>
        </Button>
        <Link href={`/missions/${mission.id}`}>
          <Button variant="secondary" size="md">
            View Mission Details
          </Button>
        </Link>
        <Link href="/missions">
          <Button variant="primary" size="md">
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}
