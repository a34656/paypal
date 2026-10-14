/**
 * Payment gateway abstraction. Implementations:
 *  - PayPalHttpGateway   (src/server/paypal/client.ts) — real Orders v2 + Payments v2 REST APIs, Sandbox by default
 *  - SimulatedGateway    (src/server/paypal/simulated.ts) — DEMO mode, labelled simulated everywhere
 *  - test mocks          (tests/helpers) — failure injection
 * Gateways are only reachable from human-authenticated payment routes, never from agents.
 */

export interface MoneyBreakdown {
  currency: string;
  totalMinor: number;
  itemTotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
}

/**
 * CAPTURE: the exact all-in amount is captured once the buyer approves.
 * AUTHORIZE: a hold for a spending cap (shipping/tax undisclosed); a human later captures
 * the real amount (≤ cap) against the authorization and PayPal releases the remainder.
 */
export type OrderIntent = "CAPTURE" | "AUTHORIZE";

export interface CreateOrderInput {
  /** Sent as PayPal-Request-Id. Persisted before the call; retries reuse it. */
  requestId: string;
  intent?: OrderIntent;
  amount: MoneyBreakdown;
  customId: string;
  invoiceId: string;
  description: string;
}

export type ProviderCaptureStatus = "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";

export interface ProviderCapture {
  id: string;
  status: ProviderCaptureStatus;
  currency: string | null;
  amountMinor: number | null;
  statusReason: string | null;
}

export type ProviderAuthorizationStatus = "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING" | "EXPIRED";

export interface ProviderAuthorization {
  id: string;
  status: ProviderAuthorizationStatus;
  currency: string | null;
  amountMinor: number | null;
  /** ISO timestamp after which the authorization can no longer be captured. */
  expirationTime: string | null;
}

export interface ProviderRefund {
  id: string;
  status: "COMPLETED" | "PENDING" | "CANCELLED" | "FAILED";
  currency: string | null;
  amountMinor: number | null;
  /** Capture this refund belongs to, when the provider reports it. */
  captureId?: string | null;
}

export type ProviderOrderStatus = "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";

export interface ProviderOrder {
  id: string;
  status: ProviderOrderStatus;
  intent: string | null;
  currency: string | null;
  totalMinor: number | null;
  itemTotalMinor: number | null;
  shippingMinor: number | null;
  taxMinor: number | null;
  customId: string | null;
  invoiceId: string | null;
  payeeMerchantId: string | null;
  captures: ProviderCapture[];
  authorizations: ProviderAuthorization[];
  refunds: ProviderRefund[];
  debugId: string | null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    /** PayPal `details[0].issue`, e.g. ORDER_ALREADY_CAPTURED, INSTRUMENT_DECLINED. */
    public readonly issue: string | null,
    public readonly debugId: string | null,
    /** true = outcome unknown (network/timeout/5xx). The request may or may not have taken effect. */
    public readonly outcomeUnknown: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface PaymentGateway {
  readonly provider: "paypal" | "simulated";
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  getOrder(orderId: string): Promise<ProviderOrder>;
  /** `requestId` is sent as PayPal-Request-Id so retries are idempotent at PayPal. */
  captureOrder(orderId: string, requestId: string): Promise<ProviderOrder>;
  /** AUTHORIZE intent: places the hold. Returns the order with its authorization. */
  authorizeOrder(orderId: string, requestId: string): Promise<ProviderOrder>;
  /** Captures `amount` (≤ authorized) against a hold; final = release the remainder. */
  captureAuthorization(authorizationId: string, input: { amountMinor: number; currency: string; requestId: string; finalCapture: boolean }): Promise<ProviderCapture>;
  /** Releases an uncaptured hold. Idempotent: voiding a voided hold is not an error. */
  voidAuthorization(authorizationId: string, requestId: string): Promise<void>;
  /** Refunds `amount` of a capture to the payer. */
  refundCapture(captureId: string, input: { amountMinor: number; currency: string; requestId: string; note: string }): Promise<ProviderRefund>;
}

/** PayPal: payer must be redirected within 3h of creation and approve/capture within 3h after that
 *  (default account setting; source: PayPal Orders v2 OpenAPI spec bundled in @paypal/paypal-js). */
export const PROVIDER_ORDER_TTL_MS = 3 * 60 * 60 * 1000;

export interface OrderVerification {
  ok: boolean;
  problems: string[];
}

/**
 * Server-side verification of a provider order against what AEGIS stored. Every field that
 * determines who is paid how much must match exactly; anything unknown fails.
 */
export function verifyOrderMatches(
  order: ProviderOrder,
  expected: { orderId: string; amount: MoneyBreakdown; customId: string; invoiceId: string; merchantId: string | null; intent?: OrderIntent },
): OrderVerification {
  const problems: string[] = [];
  const intent = expected.intent ?? "CAPTURE";
  if (order.id !== expected.orderId) problems.push("order id mismatch");
  if (order.intent !== intent) problems.push(`intent is ${order.intent ?? "missing"}, expected ${intent}`);
  if (order.currency !== expected.amount.currency) problems.push(`currency ${order.currency ?? "missing"} ≠ ${expected.amount.currency}`);
  if (order.totalMinor !== expected.amount.totalMinor) problems.push("total amount mismatch");
  // AUTHORIZE orders carry only the cap (no breakdown): shipping/tax are not known yet.
  if (intent === "CAPTURE") {
    if (order.itemTotalMinor !== expected.amount.itemTotalMinor) problems.push("item total mismatch");
    if (order.shippingMinor !== expected.amount.shippingMinor) problems.push("shipping mismatch");
    if (order.taxMinor !== expected.amount.taxMinor) problems.push("tax mismatch");
  }
  if (order.customId !== expected.customId) problems.push("custom_id mismatch");
  if (order.invoiceId !== expected.invoiceId) problems.push("invoice_id mismatch");
  if (expected.merchantId && order.payeeMerchantId !== expected.merchantId) problems.push("payee merchant mismatch");
  return { ok: problems.length === 0, problems };
}

export function primaryCapture(order: ProviderOrder): ProviderCapture | null {
  return order.captures[0] ?? null;
}

export function primaryAuthorization(order: ProviderOrder): ProviderAuthorization | null {
  return order.authorizations[0] ?? null;
}

/** Sum of COMPLETED refunds reported by the provider (minor units). */
export function completedRefundMinor(order: ProviderOrder): number {
  return order.refunds.filter((r) => r.status === "COMPLETED" && r.amountMinor != null).reduce((s, r) => s + (r.amountMinor as number), 0);
}

/** PayPal: an authorization has a 3-day honor period and can be captured for up to 29 days. */
export const AUTHORIZATION_VALIDITY_MS = 29 * 24 * 60 * 60 * 1000;
