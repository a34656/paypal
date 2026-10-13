/** In-memory PayPal stand-in with failure injection. Tests never reach real PayPal. */
import {
  ProviderError,
  type CreateOrderInput,
  type PaymentGateway,
  type ProviderCaptureStatus,
  type ProviderOrder,
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
      intent: "CAPTURE",
      currency: input.amount.currency,
      totalMinor: input.amount.totalMinor,
      itemTotalMinor: input.amount.itemTotalMinor,
      shippingMinor: input.amount.shippingMinor,
      taxMinor: input.amount.taxMinor,
      customId: input.customId,
      invoiceId: input.invoiceId,
      payeeMerchantId: null,
      captures: [],
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
}
