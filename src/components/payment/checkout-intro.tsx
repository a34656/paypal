"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/client/cn";

type CheckoutStatus = "AWAITING_AUTHORIZATION" | "POLICY_BLOCKED" | "APPROVAL_REQUIRED" | "AWAITING_APPROVAL"
  | "APPROVED" | "READY_TO_PAY" | "PAYMENT_PENDING" | "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "PAYMENT_CANCELLED";

const STATUS_CONFIG: Record<CheckoutStatus, { label: string; dot: string; pulse: boolean }> = {
  AWAITING_AUTHORIZATION: { label: "AWAITING AUTHORIZATION", dot: "bg-blue", pulse: true },
  POLICY_BLOCKED: { label: "POLICY BLOCKED", dot: "bg-critical", pulse: false },
  APPROVAL_REQUIRED: { label: "APPROVAL REQUIRED", dot: "bg-warning", pulse: true },
  AWAITING_APPROVAL: { label: "AWAITING HUMAN APPROVAL", dot: "bg-warning", pulse: true },
  APPROVED: { label: "PURCHASE AUTHORIZED", dot: "bg-success", pulse: false },
  READY_TO_PAY: { label: "READY FOR SECURE PAYMENT", dot: "bg-cyan", pulse: false },
  PAYMENT_PENDING: { label: "PROCESSING PAYMENT", dot: "bg-blue", pulse: true },
  PAYMENT_SUCCESS: { label: "PAYMENT SUCCESSFUL", dot: "bg-success", pulse: false },
  PAYMENT_FAILED: { label: "PAYMENT FAILED", dot: "bg-critical", pulse: false },
  PAYMENT_CANCELLED: { label: "PAYMENT CANCELLED", dot: "bg-muted", pulse: false },
};

interface CheckoutIntroProps {
  missionId: string;
  missionTitle: string;
  status: CheckoutStatus;
  className?: string;
}

export function CheckoutIntro({ missionId, missionTitle, status, className }: CheckoutIntroProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn("space-y-2", className)}
    >
      <p className="font-mono text-[10.5px] tracking-[0.2em] text-faint uppercase">
        Mission <span className="text-cyan">#{missionId.slice(0, 12).toUpperCase()}</span> · <span className="text-fg/80">{missionTitle}</span>
      </p>
      <h1 className="text-2xl font-medium tracking-[-0.02em] text-fg md:text-[30px]">
        Complete Your Purchase
      </h1>
      <p className="max-w-lg text-sm leading-relaxed text-muted">
        Your AI agent has evaluated this transaction. Review the purchase details and authorize payment securely.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <span
          className={cn("h-1.5 w-1.5 rounded-full", cfg.dot, cfg.pulse && "animate-aegis-pulse")}
          aria-hidden
        />
        <span className="font-mono text-[10px] tracking-[0.16em] text-muted uppercase">{cfg.label}</span>
      </div>
    </motion.div>
  );
}

