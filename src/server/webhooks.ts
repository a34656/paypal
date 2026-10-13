import "server-only";
/**
 * PayPal webhooks. The body is only a TRIGGER: after signature verification and dedupe on the
 * provider event id, AEGIS re-fetches the order from PayPal and applies that state through the
 * monotonic state machine. Late, duplicate and out-of-order events cannot regress a payment.
 */
import { randomUUID } from "node:crypto";
import type { PaymentGateway } from "@/domain/payments/gateway";
import { appendAudit } from "./audit";
import { casPayment } from "./cas";
import type { Db } from "./db";
import { findPaymentForProviderRef, finalizeFromOrder } from "./payments";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export interface WebhookResult {
  status: "processed" | "duplicate" | "ignored";
  detail: string;
}

export async function processWebhookEvent(db: Db, event: unknown, gateway: PaymentGateway): Promise<WebhookResult> {
  const e = obj(event);
  const eventId = str(e.id);
  const type = str(e.event_type) ?? "UNKNOWN";
  if (!eventId) return { status: "ignored", detail: "missing event id" };

  try {
    await db.webhookEvent.create({ data: { providerEventId: eventId, type } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { status: "duplicate", detail: `event ${eventId} already received` };
    throw err;
  }

  const correlationId = randomUUID();
  const resource = obj(e.resource);
  let result: WebhookResult;
  try {
    if (type.startsWith("PAYMENT.CAPTURE.")) {
      const related = obj(obj(resource.supplementary_data).related_ids);
      const payment = await findPaymentForProviderRef(db, { customId: str(resource.custom_id), orderId: str(related.order_id), captureId: str(resource.id) });
      if (!payment || !payment.providerOrderId) {
        result = { status: "ignored", detail: "no matching payment" };
      } else {
        const order = await gateway.getOrder(payment.providerOrderId);
        const s = await finalizeFromOrder(db, payment.id, order, { actor: "webhook:paypal", correlationId });
        result = { status: "processed", detail: `payment ${payment.id} now ${s}` };
      }
    } else if (type === "CUSTOMER.DISPUTE.CREATED") {
      const txs = Array.isArray(resource.disputed_transactions) ? resource.disputed_transactions : [];
      const captureId = str(obj(txs[0]).seller_transaction_id);
      const payment = captureId ? await findPaymentForProviderRef(db, { captureId }) : null;
      if (!payment || payment.status !== "CAPTURED") {
        result = { status: "ignored", detail: "no captured payment for dispute" };
      } else {
        await db.$transaction(async (tx) => {
          await casPayment(tx, { id: payment.id, from: "CAPTURED", to: "DISPUTED", version: payment.version });
          await appendAudit(tx, { missionId: payment.missionId, actor: "webhook:paypal", eventType: "payment.disputed", resource: `payment:${payment.id}`, outcome: "INFO", correlationId, metadata: { paymentId: payment.id, from: "CAPTURED", to: "DISPUTED", webhookEventId: eventId }, mode: payment.mode });
        });
        result = { status: "processed", detail: `payment ${payment.id} DISPUTED` };
      }
    } else {
      result = { status: "ignored", detail: `unhandled event type ${type}` };
    }
  } catch (err) {
    result = { status: "ignored", detail: `processing error: ${err instanceof Error ? err.message.slice(0, 200) : "unknown"}` };
  }
  await db.webhookEvent.update({ where: { providerEventId: eventId }, data: { processedAt: new Date(), result: `${result.status}: ${result.detail}`.slice(0, 500) } });
  await db.$transaction((tx) =>
    appendAudit(tx, { actor: "webhook:paypal", eventType: "webhook.received", resource: `webhook:${eventId}`, outcome: result.status === "processed" ? "SUCCESS" : "INFO", correlationId, metadata: { webhookEventId: eventId, eventType: type, outcome: result.status, detail: result.detail }, mode: "SANDBOX" }),
  );
  return result;
}
