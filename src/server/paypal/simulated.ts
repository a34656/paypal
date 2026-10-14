import "server-only";
/**
 * DEMO-mode stand-in for PayPal, used only when no PayPal credentials are configured.
 * State lives in the SimulatedOrder table. Every payment it touches is mode DEMO and the UI
 * labels it "SIMULATED — no money moved". It is never presented as a real PayPal payment.
 * It mirrors PayPal semantics that AEGIS relies on: PayPal-Request-Id idempotency, buyer
 * approval before capture/authorize, capture ≤ authorized amount, refund ≤ captured amount.
 */
import { randomBytes } from "node:crypto";
import {
  AUTHORIZATION_VALIDITY_MS,
  ProviderError,
  type CreateOrderInput,
  type OrderIntent,
  type PaymentGateway,
  type ProviderAuthorization,
  type ProviderCapture,
  type ProviderOrder,
  type ProviderOrderStatus,
  type ProviderRefund,
} from "@/domain/payments/gateway";
import type { Db } from "../db";

interface SimCapture {
  id: string;
  amountMinor: number;
  requestId: string;
}
interface SimRefund {
  id: string;
  captureId: string;
  amountMinor: number;
  requestId: string;
}

interface SimPayload {
  amount: CreateOrderInput["amount"];
  intent?: OrderIntent;
  customId: string;
  invoiceId: string;
  captureRequestId?: string;
  authorization?: { id: string; amountMinor: number; status: ProviderAuthorization["status"]; expirationTime: string; requestId: string; voidRequestId?: string };
  captures?: SimCapture[];
  refunds?: SimRefund[];
}

const simId = (prefix: string) => `${prefix}${randomBytes(8).toString("hex").toUpperCase()}`;
const sim = (message: string, issue: string, status = 422) => new ProviderError(message, status, issue, "SIMULATED", false);

export class SimulatedGateway implements PaymentGateway {
  readonly provider = "simulated" as const;
  constructor(private readonly db: Db) {}

  private captureList(row: { captureId: string | null }, p: SimPayload): SimCapture[] {
    if (p.captures) return p.captures;
    // Legacy rows (CAPTURE intent) keep the single capture in the captureId column.
    return row.captureId ? [{ id: row.captureId, amountMinor: p.amount.totalMinor, requestId: p.captureRequestId ?? "" }] : [];
  }

  private toOrder(row: { id: string; status: string; payload: unknown; captureId: string | null }): ProviderOrder {
    const p = row.payload as unknown as SimPayload;
    const refunds = p.refunds ?? [];
    const captures: ProviderCapture[] = this.captureList(row, p).map((c) => {
      const refunded = refunds.filter((r) => r.captureId === c.id).reduce((s, r) => s + r.amountMinor, 0);
      return {
        id: c.id,
        status: refunded === 0 ? "COMPLETED" : refunded >= c.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
        currency: p.amount.currency,
        amountMinor: c.amountMinor,
        statusReason: null,
      };
    });
    const intent = p.intent ?? "CAPTURE";
    return {
      id: row.id,
      status: row.status as ProviderOrderStatus,
      intent,
      currency: p.amount.currency,
      totalMinor: p.amount.totalMinor,
      itemTotalMinor: intent === "AUTHORIZE" ? null : p.amount.itemTotalMinor,
      shippingMinor: intent === "AUTHORIZE" ? null : p.amount.shippingMinor,
      taxMinor: intent === "AUTHORIZE" ? null : p.amount.taxMinor,
      customId: p.customId,
      invoiceId: p.invoiceId,
      payeeMerchantId: null,
      captures,
      authorizations: p.authorization
        ? [{ id: p.authorization.id, status: p.authorization.status, currency: p.amount.currency, amountMinor: p.authorization.amountMinor, expirationTime: p.authorization.expirationTime }]
        : [],
      refunds: refunds.map((r) => ({ id: r.id, status: "COMPLETED" as const, currency: p.amount.currency, amountMinor: r.amountMinor, captureId: r.captureId })),
      debugId: "SIMULATED",
    };
  }

  private async load(orderId: string) {
    const row = await this.db.simulatedOrder.findUnique({ where: { id: orderId } });
    if (!row) throw sim("Simulated order not found", "RESOURCE_NOT_FOUND", 404);
    return { row, p: row.payload as unknown as SimPayload };
  }

  private async findBy(pred: (p: SimPayload) => boolean) {
    // DEMO volumes are tiny; a scan keeps the table schema unchanged.
    const rows = await this.db.simulatedOrder.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    const row = rows.find((r) => pred(r.payload as unknown as SimPayload));
    if (!row) throw sim("Simulated resource not found", "RESOURCE_NOT_FOUND", 404);
    return { row, p: row.payload as unknown as SimPayload };
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    // Idempotent on the payment (custom_id), mirroring PayPal-Request-Id semantics.
    const existing = await this.db.simulatedOrder.findUnique({ where: { paymentId: input.customId } });
    if (existing) return this.toOrder(existing);
    const row = await this.db.simulatedOrder.create({
      data: {
        id: simId("SIM"),
        paymentId: input.customId,
        status: "CREATED",
        payload: { amount: input.amount, intent: input.intent ?? "CAPTURE", customId: input.customId, invoiceId: input.invoiceId } satisfies SimPayload as object,
      },
    });
    return this.toOrder(row);
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    return this.toOrder((await this.load(orderId)).row);
  }

  /** Simulated buyer approval (the stand-in for the PayPal popup). */
  async simulateBuyerApproval(orderId: string): Promise<ProviderOrder> {
    const res = await this.db.simulatedOrder.updateMany({ where: { id: orderId, status: "CREATED" }, data: { status: "APPROVED" } });
    if (res.count === 0) await this.load(orderId);
    return this.getOrder(orderId);
  }

  async captureOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    const { row, p } = await this.load(orderId);
    if ((p.intent ?? "CAPTURE") !== "CAPTURE") throw sim("Order intent is AUTHORIZE", "ACTION_DOES_NOT_MATCH_INTENT");
    if (row.status === "COMPLETED") {
      if (p.captureRequestId === requestId) return this.toOrder(row); // idempotent replay
      throw sim("Order already captured", "ORDER_ALREADY_CAPTURED");
    }
    if (row.status !== "APPROVED") throw sim("Order not approved by buyer", "ORDER_NOT_APPROVED");
    const updated = await this.db.simulatedOrder.update({
      where: { id: orderId },
      data: { status: "COMPLETED", captureId: simId("SIMCAP"), payload: { ...p, captureRequestId: requestId } as object },
    });
    return this.toOrder(updated);
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    const { row, p } = await this.load(orderId);
    if (p.intent !== "AUTHORIZE") throw sim("Order intent is CAPTURE", "ACTION_DOES_NOT_MATCH_INTENT");
    if (p.authorization) {
      if (p.authorization.requestId === requestId) return this.toOrder(row);
      throw sim("Order already authorized", "ORDER_ALREADY_AUTHORIZED");
    }
    if (row.status !== "APPROVED") throw sim("Order not approved by buyer", "ORDER_NOT_APPROVED");
    const authorization = {
      id: simId("SIMAUTH"),
      amountMinor: p.amount.totalMinor,
      status: "CREATED" as const,
      expirationTime: new Date(Date.now() + AUTHORIZATION_VALIDITY_MS).toISOString(),
      requestId,
    };
    const updated = await this.db.simulatedOrder.update({ where: { id: orderId }, data: { status: "COMPLETED", payload: { ...p, authorization } as object } });
    return this.toOrder(updated);
  }

  async captureAuthorization(authorizationId: string, input: { amountMinor: number; currency: string; requestId: string; finalCapture: boolean }): Promise<ProviderCapture> {
    const { row, p } = await this.findBy((x) => x.authorization?.id === authorizationId);
    const auth = p.authorization!;
    const captures = p.captures ?? [];
    const replay = captures.find((c) => c.requestId === input.requestId);
    if (replay) return { id: replay.id, status: "COMPLETED", currency: p.amount.currency, amountMinor: replay.amountMinor, statusReason: null };
    if (auth.status === "VOIDED") throw sim("Authorization voided", "AUTHORIZATION_VOIDED");
    if (auth.status === "CAPTURED") throw sim("Authorization already captured", "AUTHORIZATION_ALREADY_CAPTURED");
    if (Date.parse(auth.expirationTime) <= Date.now()) throw sim("Authorization expired", "AUTHORIZATION_EXPIRED");
    if (input.currency !== p.amount.currency) throw sim("Currency mismatch", "CURRENCY_MISMATCH");
    const already = captures.reduce((s, c) => s + c.amountMinor, 0);
    if (input.amountMinor <= 0 || already + input.amountMinor > auth.amountMinor) throw sim("Capture exceeds the authorized amount", "MAX_CAPTURE_AMOUNT_EXCEEDED");
    const cap: SimCapture = { id: simId("SIMCAP"), amountMinor: input.amountMinor, requestId: input.requestId };
    const next = { ...p, captures: [...captures, cap], authorization: { ...auth, status: input.finalCapture ? ("CAPTURED" as const) : ("PARTIALLY_CAPTURED" as const) } };
    await this.db.simulatedOrder.update({ where: { id: row.id }, data: { payload: next as object } });
    return { id: cap.id, status: "COMPLETED", currency: p.amount.currency, amountMinor: cap.amountMinor, statusReason: null };
  }

  async voidAuthorization(authorizationId: string, requestId: string): Promise<void> {
    const { row, p } = await this.findBy((x) => x.authorization?.id === authorizationId);
    const auth = p.authorization!;
    if (auth.status === "VOIDED") return;
    if (auth.status === "CAPTURED") throw sim("Authorization already captured", "AUTHORIZATION_ALREADY_CAPTURED");
    await this.db.simulatedOrder.update({ where: { id: row.id }, data: { payload: { ...p, authorization: { ...auth, status: "VOIDED", voidRequestId: requestId } } as object } });
  }

  async refundCapture(captureId: string, input: { amountMinor: number; currency: string; requestId: string; note: string }): Promise<ProviderRefund> {
    const { row, p } = await this.findBy((x) => (x.captures ?? []).some((c) => c.id === captureId) || false).catch(async () => {
      const legacy = await this.db.simulatedOrder.findFirst({ where: { captureId } });
      if (!legacy) throw sim("Simulated capture not found", "RESOURCE_NOT_FOUND", 404);
      return { row: legacy, p: legacy.payload as unknown as SimPayload };
    });
    const refunds = p.refunds ?? [];
    const replay = refunds.find((r) => r.requestId === input.requestId);
    if (replay) return { id: replay.id, status: "COMPLETED", currency: p.amount.currency, amountMinor: replay.amountMinor, captureId };
    const capture = this.captureList(row, p).find((c) => c.id === captureId);
    if (!capture) throw sim("Simulated capture not found", "RESOURCE_NOT_FOUND", 404);
    if (input.currency !== p.amount.currency) throw sim("Currency mismatch", "CURRENCY_MISMATCH");
    const refunded = refunds.filter((r) => r.captureId === captureId).reduce((s, r) => s + r.amountMinor, 0);
    if (input.amountMinor <= 0 || refunded + input.amountMinor > capture.amountMinor) throw sim("Refund exceeds the captured amount", "REFUND_AMOUNT_EXCEEDED");
    const refund: SimRefund = { id: simId("SIMREF"), captureId, amountMinor: input.amountMinor, requestId: input.requestId };
    // Legacy rows: move the single capture into the payload list so refunds can reference it.
    const next = { ...p, captures: this.captureList(row, p), refunds: [...refunds, refund] };
    await this.db.simulatedOrder.update({ where: { id: row.id }, data: { payload: next as object } });
    return { id: refund.id, status: "COMPLETED", currency: p.amount.currency, amountMinor: refund.amountMinor, captureId };
  }
}
