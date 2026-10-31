"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Clock,
  FlaskConical,
  Loader2,
  Lock,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { motion, AnimatePresence } from "motion/react";

import { cn } from "@/lib/client/cn";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { ErrorState } from "@/components/ui/states";
import type { ApprovalDTO, MissionDTO, MissionProductDTO, PaymentDTO } from "@/components/mission/types";

interface PayPalConfig {
  mode: string;
  paypalConnected: boolean;
  publicClientId: string | null;
  clientIdMismatch: boolean;
}

interface OrderResult {
  paymentId: string;
  providerOrderId: string;
  provider: string;
  mode: string;
  status: string;
}

interface CaptureResult {
  paymentId: string;
  status: string;
  simulated: boolean;
  message: string;
}

const LIVE_PAYMENT = [
  "APPROVED",
  "ORDER_CREATED",
  "CHECKOUT_PENDING",
  "CAPTURE_PENDING",
  "CAPTURE_PROVIDER_PENDING",
  "AUTHORIZE_PENDING",
  "AUTHORIZED",
  "SETTLE_PENDING",
  "CAPTURED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "DISPUTED",
];

interface AuthorizationPanelProps {
  mission: MissionDTO;
  product: MissionProductDTO;
  approvals: ApprovalDTO[];
  payments: PaymentDTO[];
  paypalConfig: PayPalConfig | null | undefined;
  onChange: () => void;
}

export function AuthorizationPanel({
  mission,
  product,
  approvals,
  payments,
  paypalConfig,
  onChange,
}: AuthorizationPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [holdDone, setHoldDone] = useState(false);
  const [finalAmount, setFinalAmount] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const paymentRef = useRef<string | null>(null);

  const p = product.product;
  const currency = p.currency ?? mission.currency ?? "USD";
  const active = approvals.find((a) => a.status === "ACTIVE" && new Date(a.expiresAt) > new Date());
  const live = payments.find((pay) => LIVE_PAYMENT.includes(pay.status)) ?? null;
  const ready = mission.status === "READY_FOR_CHECKOUT" && !!active;
  const holdFlow = live ? live.intent === "AUTHORIZE" : product.amountBasis === "CAP";
  const simulated = live ? live.provider === "simulated" : !paypalConfig?.paypalConnected;
  const decision = product.policyDecision;
  const isBlocked = decision === "BLOCK" || decision === "BLOCKED";

  // Detailed statuses
  const capturedPayment = payments.find((pay) => pay.status === "CAPTURED") ?? null;
  const isPendingCheckout = live?.status === "ORDER_CREATED" || live?.status === "CHECKOUT_PENDING";
  const isAuthorizedHold = live?.status === "AUTHORIZED";
  const isCapturing =
    live !== null &&
    ["CAPTURE_PENDING", "CAPTURE_PROVIDER_PENDING", "AUTHORIZE_PENDING", "SETTLE_PENDING"].includes(live.status);
  const failedPayment =
    !capturedPayment && !live ? payments.find((pay) => ["FAILED", "DENIED"].includes(pay.status)) ?? null : null;

  const scriptOptions = useMemo(
    () => ({
      clientId: paypalConfig?.publicClientId ?? "",
      currency,
      intent: (holdFlow ? "authorize" : "capture") as "authorize" | "capture",
    }),
    [paypalConfig?.publicClientId, currency, holdFlow],
  );

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      const r = await fn();
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Request failed", null, null));
      return null;
    } finally {
      setBusy(null);
      onChange();
    }
  };

  const createOrder = () =>
    run("order", () =>
      apiFetch<OrderResult>("/api/paypal/orders", { method: "POST", body: { missionId: mission.id } }),
    );

  const capture = async (paymentId: string) => {
    const r = await run("capture", () =>
      apiFetch<CaptureResult>("/api/paypal/capture", { method: "POST", body: { paymentId } }),
    );
    if (r) setMessage(r.message);
  };

  const settle = async (paymentId: string) => {
    const fallback = live ? (live.itemTotalMinor / 100).toFixed(2) : "";
    const raw = (finalAmount.trim() || fallback).replace(/[$,\s]/g, "");
    if (!raw) return;
    const r = await run("settle", () =>
      apiFetch<CaptureResult>("/api/paypal/settle", { method: "POST", body: { paymentId, finalAmount: raw } }),
    );
    if (r) setMessage(r.message);
  };

  const release = async (paymentId: string) => {
    const r = await run("release", () =>
      apiFetch<{ status: string }>("/api/paypal/release", {
        method: "POST",
        body: { paymentId, reason: releaseReason || "Released by owner" },
      }),
    );
    if (r) setMessage(`Hold released (${r.status.toLowerCase()}). No money was captured.`);
  };

  const handleCancel = async (paymentId: string) => {
    const r = await run("cancel", () =>
      apiFetch<{ paymentId: string; status: string }>("/api/paypal/cancel", {
        method: "POST",
        body: { paymentId },
      }),
    );
    if (r) {
      setMessage("Checkout was cancelled. You may authorize again when ready.");
      setHoldDone(false);
      paymentRef.current = null;
    }
  };

  const handleHoldConfirm = async () => {
    setHoldDone(true);
    if (simulated) {
      // Simulated flow: create order → simulate approval → capture
      const order = await createOrder();
      if (!order) return;
      await run("sim", () =>
        apiFetch("/api/paypal/simulate-approval", { method: "POST", body: { paymentId: order.paymentId } }),
      );
      await capture(order.paymentId);
    }
    // For real PayPal, hold confirms the human authorization and displays the PayPal buttons.
  };

  return (
    <div className="space-y-5">
      {/* Heading */}
      <div>
        <h2 className="text-base font-semibold text-fg">Authorize Your AI Purchase</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Review the verified purchase details and authorize your agent to proceed with secure payment.
        </p>
      </div>

      {/* Policy & Governance clearance */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-line bg-elevated/40 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted">Policy Decision:</span>
          <span
            className={cn(
              "font-mono font-medium uppercase tracking-[0.08em]",
              decision === "ALLOW_CHECKOUT"
                ? "text-success"
                : decision === "REQUIRE_APPROVAL"
                ? "text-warning"
                : "text-critical",
            )}
          >
            {decision?.replace(/_/g, " ") ?? "Pending"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted">Environment:</span>
          <span
            className={cn(
              "font-mono uppercase tracking-[0.08em]",
              simulated ? "text-purple" : mission.mode === "LIVE" ? "text-critical" : "text-blue",
            )}
          >
            {simulated ? "Demo · Simulated" : mission.mode === "LIVE" ? "Live" : "Sandbox"}
          </span>
        </div>
        {active && (
          <div className="flex items-center gap-1.5 text-success font-mono text-[11px]">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            <span>Approved by {active.approvedBy.displayName}</span>
          </div>
        )}
      </div>

      {/* State-based authorization area */}
      <AnimatePresence mode="wait">
        {/* BLOCKED */}
        {isBlocked && (
          <motion.div
            key="blocked"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 rounded-[6px] border border-critical/30 bg-critical/[0.06] px-4 py-3"
          >
            <Ban className="h-5 w-5 shrink-0 text-critical mt-px" aria-hidden />
            <div>
              <p className="text-sm font-medium text-critical">Purchase Blocked by Policy</p>
              <p className="mt-1 text-xs text-muted">
                This transaction cannot proceed. Review the policy checks above to understand the reason.
              </p>
            </div>
          </motion.div>
        )}

        {/* AWAITING APPROVAL / NOT READY FOR CHECKOUT */}
        {!ready && !live && !capturedPayment && !isBlocked && (
          <motion.div
            key="needs-approval"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-3 rounded-[6px] border border-warning/30 bg-warning/[0.06] px-4 py-3.5"
          >
            <Clock className="h-5 w-5 shrink-0 text-warning mt-px animate-aegis-pulse" aria-hidden />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning">Awaiting Human Approval</p>
              <p className="mt-1 text-xs text-muted leading-relaxed">
                This purchase must be approved before payment authorization can proceed. Payment authorization is
                locked until an authorized reviewer signs off on the transaction.
              </p>
              <div className="mt-3">
                <Link
                  href={`/missions/${mission.id}`}
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-warning/40 bg-warning/10 px-3 py-1.5 font-mono text-xs font-medium text-warning hover:bg-warning/20 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Open Mission Approval Panel
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {/* CAPTURED / PAYMENT SUCCESS */}
        {capturedPayment && (
          <motion.div
            key="captured"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-start gap-3 rounded-[6px] border border-success/30 bg-success/[0.06] px-4 py-4"
          >
            <ShieldCheck className="h-6 w-6 shrink-0 text-success mt-px" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-success">Payment Successful</p>
              <p className="mt-0.5 text-xs text-muted">Your purchase has been securely processed and verified.</p>
              <div className="mt-2 space-y-0.5">
                <p className="font-mono text-[10px] text-faint">Payment ID: {capturedPayment.id.slice(0, 16)}…</p>
                {capturedPayment.providerCaptureId && (
                  <p className="font-mono text-[10px] text-faint">
                    Capture ID: {capturedPayment.providerCaptureId.slice(0, 16)}…
                  </p>
                )}
                <p className="font-mono text-[10px] text-faint">
                  Amount: {formatMoney(capturedPayment.amountMinor, capturedPayment.currency)}
                </p>
              </div>
              <div className="mt-3">
                <Link
                  href={`/missions/${mission.id}`}
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-success/40 bg-success/15 px-3 py-1.5 font-mono text-xs font-medium text-success hover:bg-success/25 transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Return to Mission Details
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {/* FAILED */}
        {failedPayment && (
          <motion.div
            key="failed"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 rounded-[6px] border border-critical/30 bg-critical/[0.06] px-4 py-3"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 text-critical mt-px" aria-hidden />
            <div>
              <p className="text-sm font-medium text-critical">Payment Could Not Be Completed</p>
              <p className="mt-0.5 text-xs text-muted">
                {failedPayment.statusReason ?? "The payment was not processed. Please contact support or try again."}
              </p>
            </div>
          </motion.div>
        )}

        {/* IN-FLIGHT SERVER CAPTURE OR SETTLEMENT */}
        {isCapturing && (
          <motion.div
            key="in-flight-capture"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-3 rounded-[6px] border border-blue/25 bg-blue/[0.05] px-4 py-3"
          >
            <Loader2 className="h-4 w-4 animate-spin text-blue" aria-hidden />
            <div>
              <p className="text-sm text-blue capitalize">{live?.status.replace(/_/g, " ").toLowerCase()}</p>
              <p className="text-xs text-faint font-mono">Reconciling with payment provider…</p>
            </div>
          </motion.div>
        )}

        {/* AUTHORIZATION HOLD (CAP-based purchase) */}
        {isAuthorizedHold && live && (
          <motion.div
            key="authorized-hold"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 rounded-md border border-cyan/30 bg-cyan/5 p-4 text-xs"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-cyan">
              <Lock className="h-4 w-4" aria-hidden />{" "}
              {live.provider === "simulated" ? "Simulated hold" : "PayPal authorization hold"}: at most{" "}
              {formatMoney(live.amountMinor, live.currency)}
            </p>
            <p className="text-muted leading-relaxed">
              The seller did not disclose shipping/tax, so the approver signed off on a cap. Enter the seller&apos;s
              final invoice total; VANTA captures exactly that (never above the cap) and releases the rest.
              {live.authorizationExpiresAt &&
                ` Hold valid until ${new Date(live.authorizationExpiresAt).toLocaleDateString()}.`}
            </p>
            {/* Quick amount presets */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] text-faint uppercase font-mono tracking-wider">Quick Presets:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFinalAmount((live.itemTotalMinor / 100).toFixed(2))}
                  className="rounded-[4px] border border-line bg-elevated/80 px-2.5 py-1 font-mono text-[11px] text-fg hover:border-cyan/50 hover:bg-elevated transition-colors"
                >
                  Item Total: {formatMoney(live.itemTotalMinor, live.currency)}
                </button>
                <button
                  type="button"
                  onClick={() => setFinalAmount((live.amountMinor / 100).toFixed(2))}
                  className="rounded-[4px] border border-cyan/40 bg-cyan/[0.08] px-2.5 py-1 font-mono text-[11px] text-cyan hover:bg-cyan/15 transition-colors"
                >
                  Full Cap: {formatMoney(live.amountMinor, live.currency)}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-2 pt-1">
              <label className="flex flex-col gap-1">
                <span className="text-faint">Final invoice total ({live.currency})</span>
                <input
                  className="w-36 rounded border border-line bg-elevated px-2.5 py-1.5 font-mono text-xs focus:border-cyan focus:outline-none"
                  inputMode="decimal"
                  placeholder={(live.itemTotalMinor / 100).toFixed(2)}
                  value={finalAmount}
                  onChange={(e) => setFinalAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  aria-label="Final invoice total"
                />
              </label>
              <Button
                size="sm"
                variant="primary"
                onClick={() => settle(live.id)}
                loading={busy === "settle"}
                disabled={busy !== null}
              >
                Settle (capture ≤ cap)
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-line/60 pt-2.5">
              <input
                className="min-w-0 flex-1 rounded border border-line bg-elevated px-2.5 py-1.5 text-xs"
                placeholder="Reason (e.g. seller cancelled)"
                value={releaseReason}
                onChange={(e) => setReleaseReason(e.target.value)}
                aria-label="Release reason"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => release(live.id)}
                loading={busy === "release"}
                disabled={busy !== null}
              >
                Release hold
              </Button>
            </div>
          </motion.div>
        )}

        {/* READY STATE: Fresh checkout requiring deliberate HoldToConfirm */}
        {ready && !live && !capturedPayment && !isBlocked && !holdDone && (
          <motion.div
            key="ready-gate"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {simulated && (
              <div className="flex items-center gap-2 rounded-[4px] border border-purple/25 bg-purple/[0.06] px-3 py-2 text-xs text-purple">
                <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
                <span>Demo mode — simulated payment. No real money is transferred.</span>
              </div>
            )}
            <HoldToConfirm
              label="Hold to Authorize Purchase"
              confirmedLabel={simulated ? "Authorization Submitted" : "Authorized — Launching PayPal"}
              duration={1400}
              tone="accent"
              onConfirm={handleHoldConfirm}
              disabled={busy !== null}
            />
          </motion.div>
        )}

        {/* POST-HOLD: Simulated mode progress */}
        {ready && simulated && holdDone && !capturedPayment && !isBlocked && (
          <motion.div
            key="simulated-progress"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center justify-center gap-2 py-4 rounded-[6px] border border-purple/30 bg-purple/[0.06]"
          >
            <Loader2 className="h-4 w-4 animate-spin text-purple" aria-hidden />
            <span className="text-sm text-purple font-mono">Processing simulated payment…</span>
          </motion.div>
        )}

        {/* PAYPAL CHECKOUT INTERACTION: Real PayPal / Sandbox flow */}
        {ready &&
          !simulated &&
          paypalConfig?.publicClientId &&
          !capturedPayment &&
          !isBlocked &&
          !isCapturing &&
          !isAuthorizedHold &&
          (holdDone || isPendingCheckout) && (
            <motion.div
              key="paypal-active-area"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-3.5"
            >
              {/* If an order is already active, present in-flight status and quick-complete or cancel actions */}
              {isPendingCheckout && live && (
                <div className="rounded-[6px] border border-blue/30 bg-blue/[0.06] p-3 text-xs space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-medium text-blue">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                      <span>PayPal Sandbox Checkout in Progress</span>
                    </span>
                    <span className="font-mono text-[10px] text-faint">
                      Order: {live.providerOrderId?.slice(0, 12)}…
                    </span>
                  </div>
                  <p className="text-muted leading-relaxed">
                    Complete authorization in the PayPal window, or use the buttons below if you already approved in
                    PayPal.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line/50">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => capture(live.id)}
                      loading={busy === "capture"}
                      disabled={busy !== null}
                      className="gap-1.5"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      <span>
                        {holdFlow
                          ? "I Approved in PayPal — Place Hold Now"
                          : "I Approved in PayPal — Complete Purchase Now"}
                      </span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCancel(live.id)}
                      loading={busy === "cancel"}
                      disabled={busy !== null}
                      className="text-muted hover:text-critical"
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" aria-hidden />
                      Cancel Checkout
                    </Button>
                  </div>
                </div>
              )}

              {/* PayPal script & button area */}
              <div className="space-y-3">
                {!isPendingCheckout && (
                  <div className="flex items-center gap-2 rounded-[4px] border border-success/30 bg-success/[0.06] px-3 py-2 text-xs text-success font-mono">
                    <ShieldCheck className="h-4 w-4" aria-hidden />
                    <span>Purchase Authorized — Complete with PayPal</span>
                  </div>
                )}

                {paypalConfig.clientIdMismatch && (
                  <p className="text-xs text-critical">
                    Configuration warning: browser and server PayPal client IDs differ.
                  </p>
                )}

                <PayPalScriptProvider options={scriptOptions}>
                  <PayPalButtons
                    style={{ layout: "vertical", color: "blue", shape: "rect", label: "paypal" }}
                    disabled={busy !== null}
                    createOrder={async () => {
                      const r = await apiFetch<OrderResult>("/api/paypal/orders", {
                        method: "POST",
                        body: { missionId: mission.id },
                      });
                      paymentRef.current = r.paymentId;
                      // DO NOT call onChange() here to prevent premature component unmounting
                      return r.providerOrderId;
                    }}
                    onApprove={async () => {
                      const targetId = paymentRef.current || live?.id;
                      if (targetId) await capture(targetId);
                    }}
                    onCancel={async () => {
                      const targetId = paymentRef.current || live?.id;
                      if (targetId) await handleCancel(targetId);
                    }}
                    onError={(err) => {
                      setError(
                        new ApiError(
                          0,
                          "PROVIDER_ERROR",
                          err instanceof Error ? err.message : "PayPal checkout error",
                          null,
                          null,
                        ),
                      );
                    }}
                  />
                </PayPalScriptProvider>
              </div>
            </motion.div>
          )}

        {/* PayPal connected but no public client ID */}
        {ready && !simulated && paypalConfig && !paypalConfig.publicClientId && !isBlocked && (
          <p className="text-xs text-warning">
            PayPal is connected on the server but NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set.
          </p>
        )}
      </AnimatePresence>

      {message && (
        <p className="rounded-[4px] bg-elevated/60 border border-line px-3 py-2 text-xs text-muted">{message}</p>
      )}
      <ErrorState error={error} />

      {/* Consequences disclosure */}
      {!isBlocked && !capturedPayment && (
        <p className="text-[11px] leading-relaxed text-faint border-t border-line pt-3">
          By authorizing, you instruct VANTA to initiate a payment of the amount stated above through the configured
          payment provider. The backend independently verifies eligibility, policy compliance, and approval before
          processing. Authorization does not guarantee capture until confirmed by the payment provider.
        </p>
      )}
    </div>
  );
}
