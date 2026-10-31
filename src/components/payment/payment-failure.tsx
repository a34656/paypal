"use client";

import Link from "next/link";
import { AlertOctagon, ArrowLeft, RefreshCw } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "@/lib/client/cn";
import { Button } from "@/components/ui/button";
import type { PaymentDTO, MissionDTO } from "@/components/mission/types";

interface PaymentFailureProps {
  mission: MissionDTO;
  payment?: PaymentDTO | null;
  errorMessage?: string | null;
  onRetry?: () => void;
  className?: string;
}

export function PaymentFailure({
  mission,
  payment,
  errorMessage,
  onRetry,
  className,
}: PaymentFailureProps) {
  const reason = errorMessage ?? payment?.statusReason ?? "Payment processing could not be completed.";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn("surface rounded-[var(--radius-panel)] p-6 sm:p-8 space-y-6 max-w-xl mx-auto", className)}
    >
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-critical/15 border border-critical/30 shadow-[0_0_32px_-8px_rgb(255_93_108/0.5)]">
          <AlertOctagon className="h-7 w-7 text-critical" aria-hidden />
        </div>
        <div>
          <span className="font-mono text-[10px] tracking-[0.2em] text-critical uppercase">Transaction Notice</span>
          <h2 className="text-xl font-semibold tracking-[-0.02em] text-fg mt-1">Payment Could Not Be Completed</h2>
          <p className="text-xs text-muted max-w-md mx-auto mt-2 leading-relaxed">
            {reason}
          </p>
        </div>
      </div>

      {payment && (
        <div className="rounded-[4px] border border-line bg-elevated/40 p-3 divide-y divide-line/60 text-xs">
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <span className="text-muted">Payment ID</span>
            <span className="font-mono text-faint">{payment.id}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <span className="text-muted">Status</span>
            <span className="font-mono text-critical uppercase">{payment.status.replace(/_/g, " ")}</span>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
        {onRetry && (
          <Button variant="primary" size="md" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Try Again
          </Button>
        )}
        <Link href={`/missions/${mission.id}`}>
          <Button variant="secondary" size="md">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to Mission
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}

