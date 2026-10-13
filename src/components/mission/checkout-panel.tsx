"use client";
import { useRef, useState } from "react";
import { FlaskConical, ShieldCheck, Wallet } from "lucide-react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import type { ApprovalDTO, MissionDTO, PaymentDTO } from "./types";

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

const LIVE_PAYMENT = ["APPROVED", "ORDER_CREATED", "CHECKOUT_PENDING", "CAPTURE_PENDING", "CAPTURE_PROVIDER_PENDING", "CAPTURED", "REFUNDED", "DISPUTED"];

export function CheckoutPanel({ mission, approvals, payments, onChange }: { mission: MissionDTO; approvals: ApprovalDTO[]; payments: PaymentDTO[]; onChange: () => void }) {
  const { data: cfg } = useApi<PayPalConfig>("/api/paypal/config");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const paymentRef = useRef<string | null>(null);

  const active = approvals.find((a) => a.status === "ACTIVE" && new Date(a.expiresAt) > new Date());
  const live = payments.find((p) => LIVE_PAYMENT.includes(p.status)) ?? null;
  const ready = mission.status === "READY_FOR_CHECKOUT" && !!active;

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

  const createOrder = () => run("order", () => apiFetch<OrderResult>("/api/paypal/orders", { method: "POST", body: { missionId: mission.id } }));
  const capture = async (paymentId: string) => {
    const r = await run("capture", () => apiFetch<CaptureResult>("/api/paypal/capture", { method: "POST", body: { paymentId } }));
    if (r) setMessage(r.message);
  };

  const simulated = live ? live.provider === "simulated" : !cfg?.paypalConnected;

  return (
    <div className="space-y-4">
      {live && (
        <div className="rounded-md border border-line p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-cyan" aria-hidden />
              <StatusBadge status={live.status} />
              <ModeBadge mode={live.mode} simulated={live.provider === "simulated"} />
            </span>
            <span className="font-mono text-sm">{formatMoney(live.amountMinor, live.currency)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted">
            <dt>Payment</dt>
            <dd className="font-mono">{live.id}</dd>
            <dt>{live.provider === "simulated" ? "Simulated order" : "PayPal order"}</dt>
            <dd className="font-mono">{live.providerOrderId ?? "—"}</dd>
            {live.providerCaptureId && (
              <>
                <dt>Capture</dt>
                <dd className="font-mono">{live.providerCaptureId}</dd>
              </>
            )}
          </dl>
          {live.status === "CAPTURED" && live.provider === "simulated" && (
            <p className="mt-2 rounded border border-purple/30 bg-purple/10 px-2 py-1 text-purple">SIMULATED — no money moved. This is not a PayPal payment.</p>
          )}
          {live.status === "CAPTURED" && live.provider === "paypal" && <p className="mt-2 text-success">Capture confirmed by PayPal ({live.mode === "SANDBOX" ? "Sandbox test money" : live.mode}).</p>}
          {live.status === "CAPTURE_PROVIDER_PENDING" && <p className="mt-2 text-warning">PayPal reports the capture as PENDING. It is not complete; AEGIS reconciles automatically.</p>}
          {live.status === "CAPTURE_PENDING" && <p className="mt-2 text-warning">Capture in progress or interrupted. Outcome not yet confirmed.</p>}
        </div>
      )}

      {!ready && !live && <p className="text-xs text-muted">{mission.status === "READY_FOR_CHECKOUT" ? "Authorise the purchase first. Checkout requires an active approval." : "Checkout becomes available after policy evaluation and human approval."}</p>}

      {ready && simulated && (
        <div className="space-y-3 rounded-md border border-purple/30 bg-purple/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-purple">
            <FlaskConical className="h-4 w-4" aria-hidden /> Simulated checkout (DEMO MODE — PayPal not connected)
          </p>
          <p className="text-xs text-muted">This walks the exact same server path (order → buyer approval → verified capture) against a simulator. Nothing here is a real payment.</p>
          <ol className="space-y-2 text-xs">
            <li className="flex items-center justify-between gap-2">
              <span>1. Create order (server recomputes the amount)</span>
              <Button size="sm" onClick={async () => void (await createOrder())} loading={busy === "order"} disabled={!!live || busy !== null}>
                Create simulated order
              </Button>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>2. Buyer approval (stand-in for the PayPal popup)</span>
              <Button size="sm" onClick={() => live && run("sim", () => apiFetch("/api/paypal/simulate-approval", { method: "POST", body: { paymentId: live.id } }))} loading={busy === "sim"} disabled={!live || live.status !== "CHECKOUT_PENDING" || busy !== null}>
                Simulate buyer approval
              </Button>
            </li>
            <li className="flex items-center justify-between gap-2">
              <span>3. Verified capture (both gates checked server-side)</span>
              <Button size="sm" variant="primary" onClick={() => live && capture(live.id)} loading={busy === "capture"} disabled={!live || live.status !== "CHECKOUT_PENDING" || busy !== null}>
                Capture (simulated)
              </Button>
            </li>
          </ol>
          {live && live.status === "CHECKOUT_PENDING" && (
            <Button size="sm" variant="ghost" onClick={() => run("cancel", () => apiFetch("/api/paypal/cancel", { method: "POST", body: { paymentId: live.id } }))} disabled={busy !== null}>
              Cancel checkout
            </Button>
          )}
        </div>
      )}

      {ready && !simulated && cfg?.publicClientId && (
        <div className="space-y-2 rounded-md border border-blue/30 bg-blue/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-blue">
            <ShieldCheck className="h-4 w-4" aria-hidden /> PayPal Sandbox checkout
          </p>
          {cfg.clientIdMismatch && <p className="text-xs text-critical">Configuration warning: browser and server PayPal client IDs differ. Checkout will fail until they match.</p>}
          <p className="text-xs text-muted">The server creates the order from stored data. After you approve in PayPal, only the payment id is sent back; the server verifies the order and both approval gates before capturing.</p>
          <PayPalScriptProvider options={{ clientId: cfg.publicClientId, currency: mission.currency ?? "USD", intent: "capture" }}>
            <PayPalButtons
              style={{ layout: "vertical", color: "blue", shape: "rect", label: "paypal" }}
              disabled={busy !== null}
              createOrder={async () => {
                const r = await apiFetch<OrderResult>("/api/paypal/orders", { method: "POST", body: { missionId: mission.id } });
                paymentRef.current = r.paymentId;
                onChange();
                return r.providerOrderId;
              }}
              onApprove={async () => {
                // Never send the order id or amount from the browser.
                if (paymentRef.current) await capture(paymentRef.current);
              }}
              onCancel={async () => {
                if (paymentRef.current) await run("cancel", () => apiFetch("/api/paypal/cancel", { method: "POST", body: { paymentId: paymentRef.current } }));
              }}
              onError={(err) => setError(new ApiError(0, "PROVIDER_ERROR", err instanceof Error ? err.message : "PayPal checkout error", null, null))}
            />
          </PayPalScriptProvider>
        </div>
      )}

      {ready && !simulated && cfg && !cfg.publicClientId && <p className="text-xs text-warning">PayPal is connected on the server but NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set, so the checkout button cannot render.</p>}

      {live?.status === "CHECKOUT_PENDING" && !simulated && (
        <Button size="sm" variant="secondary" onClick={() => capture(live.id)} loading={busy === "capture"}>
          I approved in PayPal — capture now
        </Button>
      )}

      {message && <p className="text-xs text-muted">{message}</p>}
      <ErrorState error={error} />
    </div>
  );
}
