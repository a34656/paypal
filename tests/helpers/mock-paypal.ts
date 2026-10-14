/** In-memory PayPal stand-in with failure injection. Tests never reach real PayPal. */
import {
  ProviderError,
  type CreateOrderInput,
  type PaymentGateway,
  type ProviderCapture,
  type ProviderCaptureStatus,
  type ProviderOrder,
  type ProviderRefund,
} from "@/domain/payments/gateway";

interface MockOrder {
  order: ProviderOrder;
  captureRequestId: string | null;
}

export class MockPayPal implements PaymentGateway {
  readonly provider = "paypal" as const;
  orders = new Map<string, MockOrder>();
  createCalls = 0;
  captureCalls = 0;
  authorizeCalls = 0;
  refundCalls = 0;
  /** Behaviour of the NEXT refund call. */
  refundBehavior: "complete" | "network" | "decline" = "complete";
  private refundByRequestId = new Map<string, ProviderRefund>();
  private captureByRequestId = new Map<string, ProviderCapture>();
  /** Behaviour of the NEXT capture call. */
  captureBehavior: "complete" | "pending" | "decline" | "network-after-capture" | "network" = "complete";
  tamper: Partial<ProviderOrder> | null = null;
  private seq = 0;
  private byRequestId = new Map<string, string>();

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    this.createCalls += 1;
    const existing = this.byRequestId.get(input.requestId);
    if (existing) return structuredClone(this.orders.get(existing)!.order);
    const id = `MOCK${String(++this.seq).padStart(10, "0")}`;
    const order: ProviderOrder = {
      id,
      status: "CREATED",
      intent: input.intent ?? "CAPTURE",
      currency: input.amount.currency,
      totalMinor: input.amount.totalMinor,
      itemTotalMinor: input.intent === "AUTHORIZE" ? null : input.amount.itemTotalMinor,
      shippingMinor: input.intent === "AUTHORIZE" ? null : input.amount.shippingMinor,
      taxMinor: input.intent === "AUTHORIZE" ? null : input.amount.taxMinor,
      customId: input.customId,
      invoiceId: input.invoiceId,
      payeeMerchantId: null,
      captures: [],
      authorizations: [],
      refunds: [],
      debugId: "MOCKDEBUG",
    };
    this.orders.set(id, { order, captureRequestId: null });
    this.byRequestId.set(input.requestId, id);
    return structuredClone(order);
  }

  buyerApproves(orderId: string) {
    this.orders.get(orderId)!.order.status = "APPROVED";
  }

  /** Simulates a capture that happened at PayPal (e.g. by an earlier request whose response was lost). */
  completeOutOfBand(orderId: string, status: ProviderCaptureStatus = "COMPLETED") {
    const o = this.orders.get(orderId)!;
    o.order.status = "COMPLETED";
    o.order.captures = [{ id: `CAP-${orderId}`, status, currency: o.order.currency, amountMinor: o.order.totalMinor, statusReason: null }];
    o.captureRequestId = "out-of-band";
  }

  setCaptureStatus(orderId: string, status: ProviderCaptureStatus) {
    const o = this.orders.get(orderId)!;
    o.order.captures = o.order.captures.map((c) => ({ ...c, status }));
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    const o = this.orders.get(orderId);
    if (!o) throw new ProviderError("not found", 404, "RESOURCE_NOT_FOUND", null, false);
    return { ...structuredClone(o.order), ...(this.tamper ?? {}) };
  }

  async captureOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    this.captureCalls += 1;
    const o = this.orders.get(orderId);
    if (!o) throw new ProviderError("not found", 404, "RESOURCE_NOT_FOUND", null, false);
    if (o.order.status === "COMPLETED") {
      if (o.captureRequestId === requestId) return structuredClone(o.order); // PayPal-Request-Id idempotency
      throw new ProviderError("already captured", 422, "ORDER_ALREADY_CAPTURED", "D", false);
    }
    if (o.order.status !== "APPROVED") throw new ProviderError("not approved", 422, "ORDER_NOT_APPROVED", "D", false);
    const behavior = this.captureBehavior;
    this.captureBehavior = "complete";
    if (behavior === "network") throw new ProviderError("timeout", null, null, null, true);
    if (behavior === "decline") throw new ProviderError("declined", 422, "INSTRUMENT_DECLINED", "D", false);
    const status: ProviderCaptureStatus = behavior === "pending" ? "PENDING" : "COMPLETED";
    o.order.status = "COMPLETED";
    o.order.captures = [{ id: `CAP-${orderId}`, status, currency: o.order.currency, amountMinor: o.order.totalMinor, statusReason: behavior === "pending" ? "PENDING_REVIEW" : null }];
    o.captureRequestId = requestId;
    if (behavior === "network-after-capture") throw new ProviderError("timeout after capture", null, null, null, true);
    return structuredClone(o.order);
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    this.authorizeCalls += 1;
    const o = this.orders.get(orderId);
    if (!o) throw new ProviderError("not found", 404, "RESOURCE_NOT_FOUND", null, false);
    if (o.order.intent !== "AUTHORIZE") throw new ProviderError("intent", 422, "ACTION_DOES_NOT_MATCH_INTENT", "D", false);
    if (o.order.authorizations.length > 0) {
      if (o.captureRequestId === requestId) return structuredClone(o.order);
      throw new ProviderError("already authorized", 422, "ORDER_ALREADY_AUTHORIZED", "D", false);
    }
    if (o.order.status !== "APPROVED") throw new ProviderError("not approved", 422, "ORDER_NOT_APPROVED", "D", false);
    o.order.status = "COMPLETED";
    o.order.authorizations = [{ id: `AUTH${orderId}`, status: "CREATED", currency: o.order.currency, amountMinor: o.order.totalMinor, expirationTime: new Date(Date.now() + 29 * 86_400_000).toISOString() }];
    o.captureRequestId = requestId;
    return structuredClone(o.order);
  }

  private orderForAuth(authorizationId: string) {
    const o = [...this.orders.values()].find((x) => x.order.authorizations.some((a) => a.id === authorizationId));
    if (!o) throw new ProviderError("not found", 404, "RESOURCE_NOT_FOUND", null, false);
    return o;
  }

  async captureAuthorization(authorizationId: string, input: { amountMinor: number; currency: string; requestId: string; finalCapture: boolean }): Promise<ProviderCapture> {
    this.captureCalls += 1;
    const replay = this.captureByRequestId.get(input.requestId);
    if (replay) return structuredClone(replay);
    const o = this.orderForAuth(authorizationId);
    const auth = o.order.authorizations[0];
    if (auth.status !== "CREATED") throw new ProviderError("auth not capturable", 422, `AUTHORIZATION_${auth.status}`, "D", false);
    if (input.amountMinor > (auth.amountMinor ?? 0)) throw new ProviderError("too much", 422, "MAX_CAPTURE_AMOUNT_EXCEEDED", "D", false);
    const behavior = this.captureBehavior;
    this.captureBehavior = "complete";
    if (behavior === "network") throw new ProviderError("timeout", null, null, null, true);
    if (behavior === "decline") throw new ProviderError("declined", 422, "INSTRUMENT_DECLINED", "D", false);
    const cap: ProviderCapture = { id: `CAP${authorizationId}`, status: behavior === "pending" ? "PENDING" : "COMPLETED", currency: input.currency, amountMinor: input.amountMinor, statusReason: null };
    o.order.captures = [cap];
    auth.status = "CAPTURED";
    this.captureByRequestId.set(input.requestId, cap);
    if (behavior === "network-after-capture") throw new ProviderError("timeout after capture", null, null, null, true);
    return structuredClone(cap);
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    const o = this.orderForAuth(authorizationId);
    const auth = o.order.authorizations[0];
    if (auth.status === "CAPTURED") throw new ProviderError("captured", 422, "AUTHORIZATION_ALREADY_CAPTURED", "D", false);
    auth.status = "VOIDED";
  }

  /** Test hook: the hold lapsed at PayPal. */
  expireAuthorization(orderId: string) {
    this.orders.get(orderId)!.order.authorizations[0].status = "EXPIRED";
  }

  async refundCapture(captureId: string, input: { amountMinor: number; currency: string; requestId: string; note: string }): Promise<ProviderRefund> {
    this.refundCalls += 1;
    const replay = this.refundByRequestId.get(input.requestId);
    if (replay) return structuredClone(replay);
    const o = [...this.orders.values()].find((x) => x.order.captures.some((c) => c.id === captureId));
    if (!o) throw new ProviderError("not found", 404, "RESOURCE_NOT_FOUND", null, false);
    const behavior = this.refundBehavior;
    this.refundBehavior = "complete";
    if (behavior === "network") throw new ProviderError("timeout", null, null, null, true);
    if (behavior === "decline") throw new ProviderError("refund declined", 422, "REFUND_NOT_ALLOWED", "D", false);
    const cap = o.order.captures.find((c) => c.id === captureId)!;
    const already = o.order.refunds.reduce((s, r) => s + (r.amountMinor ?? 0), 0);
    if (already + input.amountMinor > (cap.amountMinor ?? 0)) throw new ProviderError("too much", 422, "REFUND_AMOUNT_EXCEEDED", "D", false);
    const refund: ProviderRefund = { id: `REF${this.refundCalls}${captureId}`.slice(0, 30), status: "COMPLETED", currency: input.currency, amountMinor: input.amountMinor, captureId };
    o.order.refunds.push(refund);
    cap.status = already + input.amountMinor === cap.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
    this.refundByRequestId.set(input.requestId, refund);
    return structuredClone(refund);
  }
}
