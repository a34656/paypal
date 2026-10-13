/**
 * Payment gateway abstraction. Implementations:
 *  - PayPalHttpGateway   (src/server/paypal/client.ts) — real Orders v2 REST API, Sandbox by default
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

export interface CreateOrderInput {
  /** Sent as PayPal-Request-Id. Persisted before the call; retries reuse it. */
  requestId: string;
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
  expected: { orderId: string; amount: MoneyBreakdown; customId: string; invoiceId: string; merchantId: string | null },
): OrderVerification {
  const problems: string[] = [];
  if (order.id !== expected.orderId) problems.push("order id mismatch");
  if (order.intent !== "CAPTURE") problems.push(`intent is ${order.intent ?? "missing"}, expected CAPTURE`);
  if (order.currency !== expected.amount.currency) problems.push(`currency ${order.currency ?? "missing"} ≠ ${expected.amount.currency}`);
  if (order.totalMinor !== expected.amount.totalMinor) problems.push("total amount mismatch");
  if (order.itemTotalMinor !== expected.amount.itemTotalMinor) problems.push("item total mismatch");
  if (order.shippingMinor !== expected.amount.shippingMinor) problems.push("shipping mismatch");
  if (order.taxMinor !== expected.amount.taxMinor) problems.push("tax mismatch");
  if (order.customId !== expected.customId) problems.push("custom_id mismatch");
  if (order.invoiceId !== expected.invoiceId) problems.push("invoice_id mismatch");
  if (expected.merchantId && order.payeeMerchantId !== expected.merchantId) problems.push("payee merchant mismatch");
  return { ok: problems.length === 0, problems };
}

export function primaryCapture(order: ProviderOrder): ProviderCapture | null {
  return order.captures[0] ?? null;
}
