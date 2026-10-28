"use client";
import { useRef, useState } from "react";
import { FlaskConical, Lock, RotateCcw, ShieldCheck, Wallet } from "lucide-react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { formatMoney } from "@/lib/money";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { ModeBadge, StatusBadge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/states";
import type { ApprovalDTO, MissionDTO, MissionProductDTO, PaymentDTO } from "./types";

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
const REFUNDABLE = ["CAPTURED", "PARTIALLY_REFUNDED"];

export function CheckoutPanel({
  mission,
  products,
  approvals,
  payments,
  onChange,
}: {
  mission: MissionDTO;
  products: MissionProductDTO[];
  approvals: ApprovalDTO[];
  payments: PaymentDTO[];
  onChange: () => void;
}) {
  const { data: cfg } = useApi<PayPalConfig>("/api/paypal/config");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const paymentRef = useRef<string | null>(null);
  const [finalAmount, setFinalAmount] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  const active = approvals.find((a) => a.status === "ACTIVE" && new Date(a.expiresAt) > new Date());
  const live = payments.find((p) => LIVE_PAYMENT.includes(p.status)) ?? null;
  const ready = mission.status === "READY_FOR_CHECKOUT" && !!active;
  const recommended = products.find((p) => p.productId === mission.recommendedProductId) ?? null;
  // AUTHORIZE = spending cap: PayPal holds the cap, a human settles the real amount later.
  const holdFlow = live ? live.intent === "AUTHORIZE" : recommended?.amountBasis === "CAP";
  const currency = live?.currency ?? mission.currency ?? "USD";

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
  const settle = async (paymentId: string) => {
    const r = await run("settle", () => apiFetch<CaptureResult>("/api/paypal/settle", { method: "POST", body: { paymentId, finalAmount } }));
    if (r) setMessage(r.message);
  };
  const release = async (paymentId: string) => {
    const r = await run("release", () => apiFetch<{ status: string }>("/api/paypal/release", { method: "POST", body: { paymentId, reason: releaseReason || "Released by owner" } }));
    if (r) setMessage(`Hold released (${r.status.toLowerCase()}). No money was captured.`);
  };
  const refund = async (paymentId: string) => {
    const r = await run("refund", () =>
      apiFetch<{ amountMinor: number; refundedMinor: number; status: string; simulated: boolean }>("/api/paypal/refund", { method: "POST", body: { paymentId, reason: refundReason, ...(refundAmount ? { amount: refundAmount } : {}) } }),
    );
    if (r) {
      setMessage(`${r.simulated ? "SIMULATED refund" : "Refunded via PayPal"}: ${formatMoney(r.amountMinor, currency)} (total refunded ${formatMoney(r.refundedMinor, currency)}).`);
      setRefundAmount("");
      setRefundReason("");
    }
  };

  const simulated = live ? live.provider === "simulated" : !cfg?.paypalConnected;

  return (
    <div data-demo-target="checkout-panel" className="space-y-4">
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
            {live.providerAuthorizationId && (
              <>
                <dt>Authorization</dt>
                <dd className="font-mono">{live.providerAuthorizationId}</dd>
              </>
            )}
            {live.providerCaptureId && (
              <>
                <dt>Capture</dt>
                <dd className="font-mono">{live.providerCaptureId}</dd>
              </>
            )}
            {live.intent === "AUTHORIZE" && (
              <>
                <dt>Spending cap</dt>
                <dd>
                  {formatMoney(live.amountMinor, live.currency)} <span className="text-faint">(items {formatMoney(live.itemTotalMinor, live.currency)} + allowance {formatMoney(live.allowanceMinor, live.currency)})</span>
                </dd>
              </>
            )}
            {live.settledMinor != null && (
              <>
                <dt>Settled</dt>
                <dd>
                  {formatMoney(live.settledMinor, live.currency)} <span className="text-faint">· released {formatMoney(live.amountMinor - live.settledMinor, live.currency)}</span>
                </dd>
              </>
            )}
            {live.refundedMinor > 0 && (
              <>
                <dt>Refunded</dt>
                <dd>{formatMoney(live.refundedMinor, live.currency)}</dd>
              </>
            )}
          </dl>
          {live.status === "CAPTURED" && live.provider === "simulated" && (
            <p className="mt-2 rounded border border-purple/30 bg-purple/10 px-2 py-1 text-purple">SIMULATED — no money moved. This is not a PayPal payment.</p>
          )}
          {live.status === "CAPTURED" && live.provider === "paypal" && <p className="mt-2 text-success">Capture confirmed by PayPal ({live.mode === "SANDBOX" ? "Sandbox test money" : live.mode}).</p>}
          {live.status === "CAPTURE_PROVIDER_PENDING" && <p className="mt-2 text-warning">PayPal reports the capture as PENDING. It is not complete; VANTA reconciles automatically.</p>}
          {live.status === "CAPTURE_PENDING" && <p className="mt-2 text-warning">Capture in progress or interrupted. Outcome not yet confirmed.</p>}
          {live.status === "AUTHORIZE_PENDING" && <p className="mt-2 text-warning">Placing the authorization hold. Outcome not yet confirmed.</p>}
          {live.status === "SETTLE_PENDING" && <p className="mt-2 text-warning">Settlement of {formatMoney(live.settledMinor, live.currency)} in progress. Retrying settles idempotently.</p>}
        </div>
      )}

      {live?.status === "AUTHORIZED" && (
        <div className="space-y-2 rounded-md border border-cyan/30 bg-cyan/5 p-3 text-xs">
          <p className="flex items-center gap-2 text-sm font-medium text-cyan">
            <Lock className="h-4 w-4" aria-hidden /> {live.provider === "simulated" ? "Simulated hold" : "PayPal authorization hold"}: at most {formatMoney(live.amountMinor, live.currency)}
          </p>
          <p className="text-muted">
            The seller did not disclose shipping/tax, so the approver signed off on a cap. Enter the seller&apos;s final invoice total; VANTA captures exactly that (never above the cap) and PayPal releases the rest.
            {live.authorizationExpiresAt && ` Hold valid until ${new Date(live.authorizationExpiresAt).toLocaleDateString()}.`}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-faint">Final invoice total ({live.currency})</span>
              <input
                className="w-36 rounded border border-line bg-elevated px-2 py-1 font-mono"
                inputMode="decimal"
                placeholder={(live.itemTotalMinor / 100).toFixed(2)}
                value={finalAmount}
                onChange={(e) => setFinalAmount(e.target.value)}
                aria-label="Final invoice total"
              />
            </label>
            <Button size="sm" variant="primary" onClick={() => settle(live.id)} loading={busy === "settle"} disabled={busy !== null || !finalAmount}>
              Settle (capture ≤ cap)
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <input className="min-w-0 flex-1 rounded border border-line bg-elevated px-2 py-1" placeholder="Reason (e.g. seller cancelled)" value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} aria-label="Release reason" />
            <Button size="sm" variant="ghost" onClick={() => release(live.id)} loading={busy === "release"} disabled={busy !== null}>
              Release hold
            </Button>
          </div>
        </div>
      )}

      {live && REFUNDABLE.includes(live.status) && (
        <div className="space-y-2 rounded-md border border-line p-3 text-xs">
          <p className="flex items-center gap-2 text-sm font-medium">
            <RotateCcw className="h-4 w-4" aria-hidden /> Refund {live.provider === "simulated" ? "(simulated)" : "via PayPal"}
          </p>
          <p className="text-muted">Refundable: {formatMoney((live.settledMinor ?? live.amountMinor) - live.refundedMinor, live.currency)}. Leave the amount empty to refund everything that remains.</p>
          <div className="flex flex-wrap items-end gap-2">
            <input className="w-28 rounded border border-line bg-elevated px-2 py-1 font-mono" inputMode="decimal" placeholder="Amount" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} aria-label="Refund amount" />
            <input className="min-w-0 flex-1 rounded border border-line bg-elevated px-2 py-1" placeholder="Reason (required)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} aria-label="Refund reason" />
            <Button size="sm" variant="secondary" onClick={() => refund(live.id)} loading={busy === "refund"} disabled={busy !== null || refundReason.trim().length < 3}>
              Refund
            </Button>
          </div>
        </div>
      )}

      {live?.refunds && live.refunds.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {live.refunds.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span>
                <StatusBadge status={r.status === "COMPLETED" ? "REFUNDED" : r.status} /> {r.reason}
              </span>
              <span className="font-mono">{formatMoney(r.amountMinor, r.currency)}</span>
            </li>
          ))}
        </ul>
      )}

      {!ready && !live && <p className="text-xs text-muted">{mission.status === "READY_FOR_CHECKOUT" ? "Authorise the purchase first. Checkout requires an active approval." : "Checkout becomes available after policy evaluation and human approval."}</p>}

      {ready && simulated && (
        <div className="space-y-3 rounded-md border border-purple/30 bg-purple/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-purple">
            <FlaskConical className="h-4 w-4" aria-hidden /> Simulated checkout (DEMO MODE — PayPal not connected)
          </p>
          <p className="text-xs text-muted">
            This walks the exact same server path (order → buyer approval → {holdFlow ? "verified authorization hold → human settlement" : "verified capture"}) against a simulator. Nothing here is a real payment.
          </p>
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
              <span>{holdFlow ? "3. Verified hold for the spending cap (both gates checked server-side)" : "3. Verified capture (both gates checked server-side)"}</span>
              <Button size="sm" variant="primary" onClick={() => live && capture(live.id)} loading={busy === "capture"} disabled={!live || live.status !== "CHECKOUT_PENDING" || busy !== null}>
                {holdFlow ? "Place hold (simulated)" : "Capture (simulated)"}
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
          <p className="text-xs text-muted">
            The server creates the order from stored data. After you approve in PayPal, only the payment id is sent back; the server verifies the order and both approval gates before{" "}
            {holdFlow ? "placing an authorization hold for the spending cap (settled later at the real amount)." : "capturing."}
          </p>
          <PayPalScriptProvider options={{ clientId: cfg.publicClientId, currency: mission.currency ?? "USD", intent: holdFlow ? "authorize" : "capture" }}>
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
          {holdFlow ? "I approved in PayPal — place the hold now" : "I approved in PayPal — capture now"}
        </Button>
      )}

      {message && <p className="text-xs text-muted">{message}</p>}
      <ErrorState error={error} />
    </div>
  );
}
