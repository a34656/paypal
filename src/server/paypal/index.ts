import "server-only";
import type { PaymentGateway } from "@/domain/payments/gateway";
import { getEnv } from "@/lib/env";
import { AppError } from "../errors";
import type { Db } from "../db";
import { PayPalHttpGateway } from "./client";
import { SimulatedGateway } from "./simulated";

let paypalSingleton: PayPalHttpGateway | null = null;

export function getPayPalGateway(): PayPalHttpGateway | null {
  const env = getEnv();
  if (!env.paypal.configured || !env.paypal.clientId || !env.paypal.clientSecret) return null;
  if (!paypalSingleton) {
    paypalSingleton = new PayPalHttpGateway({ baseUrl: env.paypal.baseUrl, clientId: env.paypal.clientId, clientSecret: env.paypal.clientSecret });
  }
  return paypalSingleton;
}

/** Optional override used by integration tests to inject a mock gateway. */
let override: PaymentGateway | null = null;
export function setGatewayOverrideForTests(g: PaymentGateway | null) {
  if (process.env.NODE_ENV !== "test") throw new Error("Gateway override is test-only");
  override = g;
}

/** Gateway for a NEW payment: real PayPal when configured, otherwise the labelled simulator. */
export function gatewayForNewPayment(db: Db): PaymentGateway {
  if (override) return override;
  return getPayPalGateway() ?? new SimulatedGateway(db);
}

/** Gateway for an EXISTING payment is chosen by the provider recorded on it, never by current env. */
export function gatewayForPayment(db: Db, provider: string): PaymentGateway {
  if (override) return override;
  if (provider === "simulated") return new SimulatedGateway(db);
  const pp = getPayPalGateway();
  if (!pp) throw new AppError("PROVIDER_UNAVAILABLE", "This payment was made through PayPal, but PayPal credentials are not configured.");
  return pp;
}
