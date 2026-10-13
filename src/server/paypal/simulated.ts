import "server-only";
/**
 * DEMO-mode stand-in for PayPal, used only when no PayPal credentials are configured.
 * State lives in the SimulatedOrder table. Every payment it touches is mode DEMO and the UI
 * labels it "SIMULATED — no money moved". It is never presented as a real PayPal payment.
 */
import { randomBytes } from "node:crypto";
import {
  ProviderError,
  type CreateOrderInput,
  type PaymentGateway,
  type ProviderOrder,
  type ProviderOrderStatus,
} from "@/domain/payments/gateway";
import type { Db } from "../db";

interface SimPayload {
  amount: CreateOrderInput["amount"];
  customId: string;
  invoiceId: string;
  captureRequestId?: string;
}

const simId = (prefix: string) => `${prefix}${randomBytes(8).toString("hex").toUpperCase()}`;

export class SimulatedGateway implements PaymentGateway {
  readonly provider = "simulated" as const;
  constructor(private readonly db: Db) {}

  private toOrder(row: { id: string; status: string; payload: unknown; captureId: string | null }): ProviderOrder {
    const p = row.payload as unknown as SimPayload;
    return {
      id: row.id,
      status: row.status as ProviderOrderStatus,
      intent: "CAPTURE",
      currency: p.amount.currency,
      totalMinor: p.amount.totalMinor,
      itemTotalMinor: p.amount.itemTotalMinor,
      shippingMinor: p.amount.shippingMinor,
      taxMinor: p.amount.taxMinor,
      customId: p.customId,
      invoiceId: p.invoiceId,
      payeeMerchantId: null,
      captures: row.captureId
        ? [{ id: row.captureId, status: "COMPLETED", currency: p.amount.currency, amountMinor: p.amount.totalMinor, statusReason: null }]
        : [],
      debugId: "SIMULATED",
    };
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
        payload: { amount: input.amount, customId: input.customId, invoiceId: input.invoiceId } satisfies SimPayload as object,
      },
    });
    return this.toOrder(row);
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    const row = await this.db.simulatedOrder.findUnique({ where: { id: orderId } });
    if (!row) throw new ProviderError("Simulated order not found", 404, "RESOURCE_NOT_FOUND", "SIMULATED", false);
    return this.toOrder(row);
  }

  /** Simulated buyer approval (the stand-in for the PayPal popup). */
  async simulateBuyerApproval(orderId: string): Promise<ProviderOrder> {
    const res = await this.db.simulatedOrder.updateMany({ where: { id: orderId, status: "CREATED" }, data: { status: "APPROVED" } });
    if (res.count === 0) {
      const row = await this.db.simulatedOrder.findUnique({ where: { id: orderId } });
      if (!row) throw new ProviderError("Simulated order not found", 404, "RESOURCE_NOT_FOUND", "SIMULATED", false);
    }
    return this.getOrder(orderId);
  }

  async captureOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    const row = await this.db.simulatedOrder.findUnique({ where: { id: orderId } });
    if (!row) throw new ProviderError("Simulated order not found", 404, "RESOURCE_NOT_FOUND", "SIMULATED", false);
    const p = row.payload as unknown as SimPayload;
    if (row.status === "COMPLETED") {
      if (p.captureRequestId === requestId) return this.toOrder(row); // idempotent replay
      throw new ProviderError("Order already captured", 422, "ORDER_ALREADY_CAPTURED", "SIMULATED", false);
    }
    if (row.status !== "APPROVED") throw new ProviderError("Order not approved by buyer", 422, "ORDER_NOT_APPROVED", "SIMULATED", false);
    const updated = await this.db.simulatedOrder.update({
      where: { id: orderId },
      data: { status: "COMPLETED", captureId: simId("SIMCAP"), payload: { ...p, captureRequestId: requestId } as object },
    });
    return this.toOrder(updated);
  }
}
