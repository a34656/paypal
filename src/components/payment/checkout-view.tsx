"use client";

/**
 * VANTA Payment Gateway — Checkout Page
 * Route: /checkout/[missionId]
 *
 * Architecture:
 * - Loads mission data via the existing /api/missions/[id] endpoint
 * - Loads PayPal config via /api/paypal/config
 * - Derives checkout state from backend data only — never invents approvals or captures
 * - Uses existing CheckoutPanel logic adapted into premium payment-focused components
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowLeft, RotateCcw } from "lucide-react";

import { useApi } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";

import { PaymentHeader } from "@/components/payment/payment-header";
import { CheckoutIntro } from "@/components/payment/checkout-intro";
import { PurchaseSummary } from "@/components/payment/purchase-summary";
import { PaymentMethod } from "@/components/payment/payment-method";
import { PaymentTrustPanel } from "@/components/payment/payment-trust-panel";
import { AuthorizationPanel } from "@/components/payment/authorization-panel";
import { TransactionAudit } from "@/components/payment/transaction-audit";
import { PaymentSuccess } from "@/components/payment/payment-success";
import { Skeleton, ErrorState } from "@/components/ui/states";

import { reduceEvents } from "@/domain/viewmodel/reducer";
import type { MissionDetailDTO, EventsDTO, PaymentDTO } from "@/components/mission/types";

type CheckoutStatus =
  | "AWAITING_AUTHORIZATION"
  | "POLICY_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "READY_TO_PAY"
  | "PAYMENT_PENDING"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED";

interface PayPalConfig {
  mode: string;
  paypalConnected: boolean;
  publicClientId: string | null;
  clientIdMismatch: boolean;
}

const LIVE_PAYMENT_STATUSES = [
  "APPROVED", "ORDER_CREATED", "CHECKOUT_PENDING", "CAPTURE_PENDING",
  "CAPTURE_PROVIDER_PENDING", "AUTHORIZE_PENDING", "AUTHORIZED",
  "SETTLE_PENDING", "CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED",
];

function deriveCheckoutStatus(
  missionStatus: string,
  policyDecision: string | null,
  activeApproval: boolean,
  payments: PaymentDTO[],
): CheckoutStatus {
  const captured = payments.find((p) => p.status === "CAPTURED");
  if (captured) return "PAYMENT_SUCCESS";

  const live = payments.find((p) =>
    [
      "ORDER_CREATED",
      "CHECKOUT_PENDING",
      "CAPTURE_PENDING",
      "CAPTURE_PROVIDER_PENDING",
      "AUTHORIZE_PENDING",
      "SETTLE_PENDING",
      "AUTHORIZED",
    ].includes(p.status)
  );
  if (live) return "PAYMENT_PENDING";

  if (policyDecision === "BLOCK" || policyDecision === "BLOCKED") return "POLICY_BLOCKED";

  if (missionStatus === "READY_FOR_CHECKOUT") {
    if (policyDecision === "ALLOW_CHECKOUT" && activeApproval) return "READY_TO_PAY";
    if (policyDecision === "REQUIRE_APPROVAL" && activeApproval) return "READY_TO_PAY";
    if (policyDecision === "REQUIRE_APPROVAL" && !activeApproval) return "AWAITING_APPROVAL";
    return "READY_TO_PAY";
  }

  const latestPayment = payments[0] ?? null;
  if (latestPayment?.status === "FAILED" || latestPayment?.status === "DENIED") return "PAYMENT_FAILED";
  if (latestPayment?.status === "CANCELLED") return "PAYMENT_CANCELLED";

  if (policyDecision === "REQUIRE_APPROVAL") return "APPROVAL_REQUIRED";
  if (policyDecision === "ALLOW_CHECKOUT") return "APPROVED";

  return "AWAITING_AUTHORIZATION";
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader skeletons
// ─────────────────────────────────────────────────────────────────────────────

function CheckoutSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading checkout…">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-56" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main checkout view (client component with live data)
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ["CONFIRMED", "SCOUTING", "SCOUTED", "RISK_ANALYSIS", "OPTIMIZING", "POLICY_EVALUATION"];
const PAYMENT_ACTIVE = ["CHECKOUT_IN_PROGRESS", "CAPTURE_PENDING"];

export function CheckoutView({ missionId }: { missionId: string }) {
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  const detail = useApi<MissionDetailDTO>(`/api/missions/${missionId}`, {
    refreshInterval: (d) =>
      d && (ACTIVE_STATUSES.includes(d.mission.status) || PAYMENT_ACTIVE.includes(d.mission.displayStatus))
        ? 1500
        : 0,
  });
  const events = useApi<EventsDTO>(`/api/missions/${missionId}/events`, {
    refreshInterval: () =>
      detail.data &&
      (ACTIVE_STATUSES.includes(detail.data.mission.status) ||
        PAYMENT_ACTIVE.includes(detail.data.mission.displayStatus))
        ? 1500
        : 0,
  });
  const { data: paypalConfig } = useApi<PayPalConfig>("/api/paypal/config");

  const vm = useMemo(() => reduceEvents(events.data?.events ?? []), [events.data]);

  if (detail.error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <ErrorState error={detail.error} retry={() => detail.mutate()} />
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <CheckoutSkeleton />
      </div>
    );
  }

  const { mission, products, approvals, payments } = detail.data;
  const recommended = products.find((p) => p.productId === mission.recommendedProductId) ?? products[0] ?? null;

  if (!recommended) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 text-center">
        <p className="text-sm text-muted">No product selected for this mission yet.</p>
        <Link href={`/missions/${missionId}`} className="mt-4 inline-flex items-center gap-1.5 text-sm text-cyan hover:underline">
          <ArrowLeft className="h-4 w-4" /> Return to mission
        </Link>
      </div>
    );
  }

  const activeApproval = approvals.find((a) => a.status === "ACTIVE" && new Date(a.expiresAt) > new Date()) ?? null;
  const livePayment = payments.find((p) => LIVE_PAYMENT_STATUSES.includes(p.status)) ?? null;
  const capturedPayment = payments.find((p) => p.status === "CAPTURED") ?? null;
  const simulated = livePayment ? livePayment.provider === "simulated" : !paypalConfig?.paypalConnected;

  const checkoutStatus = deriveCheckoutStatus(
    mission.status,
    recommended.policyDecision,
    !!activeApproval,
    payments,
  );

  // Dedicated Official Receipt view when purchase is completed
  if (checkoutStatus === "PAYMENT_SUCCESS" && capturedPayment) {
    return (
      <>
        <PaymentHeader mode={mission.mode} missionId={missionId} simulated={simulated} />
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6" id="main-content">
          <Link
            href={`/missions/${missionId}`}
            className="mb-6 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint hover:text-fg transition-colors print:hidden"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Return to Mission Detail
          </Link>
          <PaymentSuccess
            mission={mission}
            product={recommended}
            payment={capturedPayment}
            timeline={vm.timeline}
          />
        </main>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <PaymentHeader mode={mission.mode} missionId={missionId} simulated={simulated} />

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6" id="main-content">
        {/* Back navigation */}
        <Link
          href={`/missions/${missionId}`}
          className="mb-6 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint hover:text-fg transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Mission detail
        </Link>

        {/* Intro */}
        <CheckoutIntro
          missionId={missionId}
          missionTitle={mission.title}
          status={checkoutStatus}
          className="mb-8"
        />

        {/* Two-column layout */}
        <div className="grid gap-8 lg:grid-cols-[1fr_420px]">

          {/* ── LEFT COLUMN (Payment Method & Immediate Authorization) ── */}
          <div className="space-y-6">

            {/* 1. Payment Method card (Dither Credit Card) */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
              className="surface rounded-[var(--radius-panel)]"
              aria-labelledby="payment-method-heading"
            >
              <header className="border-b border-line/80 px-4 py-3">
                <h2 id="payment-method-heading" className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-fg/85">
                  Payment Method
                </h2>
              </header>
              <div className="p-4">
                <PaymentMethod mode={mission.mode} simulated={simulated} />
              </div>
            </motion.section>

            {/* 2. Authorization panel — PLACED DIRECTLY BELOW DITHER CARD */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              className={cn(
                "surface rounded-[var(--radius-panel)]",
                (checkoutStatus === "READY_TO_PAY" || checkoutStatus === "PAYMENT_PENDING") && "glow-cyan",
              )}
              aria-labelledby="authorization-heading"
            >
              <header className="border-b border-line/80 px-4 py-3">
                <h2 id="authorization-heading" className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-fg/85">
                  Authorization & Checkout
                </h2>
              </header>
              <div className="p-4">
                <AuthorizationPanel
                  mission={mission}
                  product={recommended}
                  approvals={approvals}
                  payments={payments}
                  paypalConfig={paypalConfig ?? null}
                  onChange={() => {
                    refresh();
                    void detail.mutate();
                    void events.mutate();
                  }}
                />
              </div>
            </motion.section>

            {/* 3. Purchase Summary card */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
              className="surface rounded-[var(--radius-panel)]"
              aria-labelledby="purchase-summary-heading"
            >
              <header className="flex items-center justify-between border-b border-line/80 px-4 py-3">
                <h2 id="purchase-summary-heading" className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-fg/85">
                  Purchase Summary
                </h2>
                {recommended.product.isDemoData && (
                  <span className="rounded bg-purple/10 px-1.5 py-0.5 font-mono text-[9px] text-purple tracking-[0.1em] uppercase">Demo</span>
                )}
              </header>
              <div className="p-4">
                <PurchaseSummary mission={mission} product={recommended} />
              </div>
            </motion.section>

          </div>

          {/* ── RIGHT COLUMN (Trust Verification & Transaction Audit) ── */}
          <div className="space-y-6">

            {/* Trust panel (with compact, collapsible policy checks) */}
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
              className="surface rounded-[var(--radius-panel)]"
              aria-labelledby="trust-panel-heading"
            >
              <header className="border-b border-line/80 px-4 py-3">
                <h2 id="trust-panel-heading" className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-fg/85">
                  Trust Verification
                </h2>
              </header>
              <div className="p-4">
                <PaymentTrustPanel mission={mission} product={recommended} />
              </div>
            </motion.section>

            {/* Audit trail */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
            >
              <TransactionAudit items={vm.timeline} />
            </motion.div>

          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line/60 pt-6 text-[11px] text-faint">
          <div className="flex items-center gap-3">
            <span>VANTA AI — Trust Layer for Agentic Commerce</span>
            <span>·</span>
            <span className={cn("font-mono uppercase tracking-[0.08em]", simulated ? "text-purple" : mission.mode === "LIVE" ? "text-critical" : "text-blue")}>
              {simulated ? "DEMO · SIMULATED" : mission.mode === "LIVE" ? "LIVE" : "SANDBOX"}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/missions/${missionId}`} className="hover:text-fg transition-colors">
              Mission Detail
            </Link>
            <button
              onClick={() => { void detail.mutate(); void events.mutate(); }}
              className="flex items-center gap-1 hover:text-fg transition-colors"
            >
              <RotateCcw className="h-3 w-3" aria-hidden /> Refresh
            </button>
          </div>
        </footer>
      </main>
    </>
  );
}

