import "server-only";
/**
 * The only module that talks to PayPal's REST API.
 * OAuth token cache, Orders v2 create/get/capture/authorize, Payments v2 authorization
 * capture/void and capture refunds, webhook signature verification.
 * Timeouts and bounded retries; retries reuse the same PayPal-Request-Id so they are idempotent.
 */
import { fromProviderDecimal, toProviderDecimal } from "@/lib/money";
import {
  ProviderError,
  type CreateOrderInput,
  type PaymentGateway,
  type ProviderAuthorization,
  type ProviderAuthorizationStatus,
  type ProviderCapture,
  type ProviderRefund,
  type ProviderCaptureStatus,
  type ProviderOrder,
  type ProviderOrderStatus,
} from "@/domain/payments/gateway";

export interface PayPalConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

type Json = Record<string, unknown>;

const asObj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);

function parseMoney(v: unknown, currency: string | null): number | null {
  const o = asObj(v);
  const value = asStr(o.value);
  const cur = asStr(o.currency_code) ?? currency;
  if (!value || !cur) return null;
  try {
    return fromProviderDecimal(value, cur);
  } catch {
    return null;
  }
}

export function parsePayPalCapture(c: unknown): ProviderCapture {
  const co = asObj(c);
  const camount = asObj(co.amount);
  const ccur = asStr(camount.currency_code);
  return {
    id: asStr(co.id) ?? "",
    status: (asStr(co.status) ?? "FAILED") as ProviderCaptureStatus,
    currency: ccur,
    amountMinor: parseMoney(camount, ccur),
    statusReason: asStr(asObj(co.status_details).reason),
  };
}

export function parsePayPalRefund(r: unknown): ProviderRefund {
  const ro = asObj(r);
  const amount = asObj(ro.amount);
  const cur = asStr(amount.currency_code);
  const up = Array.isArray(ro.links) ? ro.links.map(asObj).find((l) => asStr(l.rel) === "up") : undefined;
  const captureId = up ? (asStr(up.href)?.match(/\/captures\/([A-Z0-9]+)/)?.[1] ?? null) : null;
  return {
    id: asStr(ro.id) ?? "",
    status: (asStr(ro.status) ?? "FAILED") as ProviderRefund["status"],
    currency: cur,
    amountMinor: parseMoney(amount, cur),
    captureId,
  };
}

/** Parses a PayPal Orders v2 order representation into the gateway's typed shape. */
export function parsePayPalOrder(body: unknown, debugId: string | null): ProviderOrder {
  const o = asObj(body);
  const pu = asObj(Array.isArray(o.purchase_units) ? o.purchase_units[0] : undefined);
  const amount = asObj(pu.amount);
  const currency = asStr(amount.currency_code);
  const breakdown = asObj(amount.breakdown);
  const payments = asObj(pu.payments);
  const captures: ProviderCapture[] = (Array.isArray(payments.captures) ? payments.captures : []).map(parsePayPalCapture);
  const authorizations: ProviderAuthorization[] = (Array.isArray(payments.authorizations) ? payments.authorizations : []).map((a) => {
    const ao = asObj(a);
    const aamount = asObj(ao.amount);
    const acur = asStr(aamount.currency_code);
    return {
      id: asStr(ao.id) ?? "",
      status: (asStr(ao.status) ?? "DENIED") as ProviderAuthorizationStatus,
      currency: acur,
      amountMinor: parseMoney(aamount, acur),
      expirationTime: asStr(ao.expiration_time),
    };
  });
  const refunds: ProviderRefund[] = (Array.isArray(payments.refunds) ? payments.refunds : []).map(parsePayPalRefund);
  return {
    id: asStr(o.id) ?? "",
    status: (asStr(o.status) ?? "CREATED") as ProviderOrderStatus,
    intent: asStr(o.intent),
    currency,
    totalMinor: parseMoney(amount, currency),
    itemTotalMinor: parseMoney(breakdown.item_total, currency),
    shippingMinor: parseMoney(breakdown.shipping, currency),
    taxMinor: parseMoney(breakdown.tax_total, currency),
    customId: asStr(pu.custom_id),
    invoiceId: asStr(pu.invoice_id),
    payeeMerchantId: asStr(asObj(pu.payee).merchant_id),
    captures,
    authorizations,
    refunds,
    debugId,
  };
}

export function buildCreateOrderBody(input: CreateOrderInput) {
  const c = input.amount.currency;
  const money = (minor: number) => ({ currency_code: c, value: toProviderDecimal(minor, c) });
  if (input.intent === "AUTHORIZE") {
    // Spending cap: only the maximum is stated. Shipping/tax are unknown, so no breakdown is
    // claimed; the real amount is captured later against the authorization.
    return {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.customId,
          custom_id: input.customId,
          invoice_id: input.invoiceId,
          description: input.description.slice(0, 127),
          soft_descriptor: "AEGIS HOLD",
          amount: money(input.amount.totalMinor),
        },
      ],
    };
  }
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.customId,
        custom_id: input.customId,
        invoice_id: input.invoiceId,
        description: input.description.slice(0, 127),
        amount: {
          ...money(input.amount.totalMinor),
          breakdown: {
            item_total: money(input.amount.itemTotalMinor),
            shipping: money(input.amount.shippingMinor),
            tax_total: money(input.amount.taxMinor),
          },
        },
      },
    ],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PayPal resource ids are uppercase alphanumerics; anything else never reaches a URL path. */
function assertId(id: string, kind: string) {
  if (!/^[A-Z0-9]{5,40}$/.test(id)) throw new ProviderError(`Invalid ${kind} id format`, null, null, null, false);
}

export class PayPalHttpGateway implements PaymentGateway {
  readonly provider = "paypal" as const;
  private token: TokenCache | null = null;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: PayPalConfig) {
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
    this.maxRetries = cfg.maxRetries ?? 2;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit & { retry?: boolean }): Promise<{ status: number; body: unknown; debugId: string | null }> {
    const attempts = init.retry === false ? 1 : this.maxRetries + 1;
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { ...init, signal: controller.signal });
        const debugId = res.headers.get("paypal-debug-id");
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        if (res.status >= 500 && i < attempts - 1) {
          lastErr = new ProviderError(`PayPal ${res.status}`, res.status, null, debugId, true);
          await sleep(200 * 2 ** i);
          continue;
        }
        return { status: res.status, body, debugId };
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await sleep(200 * 2 ** i);
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastErr instanceof ProviderError) throw lastErr;
    throw new ProviderError("PayPal request failed (network or timeout)", null, null, null, true);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.token;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const { status, body, debugId } = await this.request("/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const o = asObj(body);
    const token = asStr(o.access_token);
    if (status !== 200 || !token) {
      throw new ProviderError(`PayPal authentication failed (HTTP ${status})`, status, asStr(o.error), debugId, false);
    }
    const expiresIn = typeof o.expires_in === "number" ? o.expires_in : 300;
    this.token = { token, expiresAt: Date.now() + expiresIn * 1000 };
    return token;
  }

  private fail(op: string, status: number, body: unknown, debugId: string | null): never {
    const o = asObj(body);
    const details = Array.isArray(o.details) ? asObj(o.details[0]) : {};
    const issue = asStr(details.issue) ?? asStr(o.name);
    throw new ProviderError(`PayPal ${op} failed (HTTP ${status}${issue ? `, ${issue}` : ""})`, status, issue, asStr(o.debug_id) ?? debugId, status >= 500);
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request("/v2/checkout/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": input.requestId,
        Prefer: "return=representation",
      },
      body: JSON.stringify(buildCreateOrderBody(input)),
    });
    if (status !== 200 && status !== 201) this.fail("create order", status, body, debugId);
    return parsePayPalOrder(body, debugId);
  }

  async getOrder(orderId: string): Promise<ProviderOrder> {
    if (!/^[A-Z0-9]{5,40}$/.test(orderId)) throw new ProviderError("Invalid order id format", null, null, null, false);
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request(`/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (status !== 200) this.fail("get order", status, body, debugId);
    return parsePayPalOrder(body, debugId);
  }

  async captureOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    if (!/^[A-Z0-9]{5,40}$/.test(orderId)) throw new ProviderError("Invalid order id format", null, null, null, false);
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request(`/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        Prefer: "return=representation",
      },
    });
    if (status !== 200 && status !== 201) this.fail("capture", status, body, debugId);
    return parsePayPalOrder(body, debugId);
  }

  async authorizeOrder(orderId: string, requestId: string): Promise<ProviderOrder> {
    assertId(orderId, "order");
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request(`/v2/checkout/orders/${orderId}/authorize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId, Prefer: "return=representation" },
    });
    if (status !== 200 && status !== 201) this.fail("authorize", status, body, debugId);
    return parsePayPalOrder(body, debugId);
  }

  async captureAuthorization(authorizationId: string, input: { amountMinor: number; currency: string; requestId: string; finalCapture: boolean }): Promise<ProviderCapture> {
    assertId(authorizationId, "authorization");
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request(`/v2/payments/authorizations/${authorizationId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": input.requestId, Prefer: "return=representation" },
      body: JSON.stringify({
        amount: { currency_code: input.currency, value: toProviderDecimal(input.amountMinor, input.currency) },
        final_capture: input.finalCapture,
      }),
    });
    if (status !== 200 && status !== 201) this.fail("authorization capture", status, body, debugId);
    return parsePayPalCapture(body);
  }

  async voidAuthorization(authorizationId: string, requestId: string): Promise<void> {
    assertId(authorizationId, "authorization");
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request(`/v2/payments/authorizations/${authorizationId}/void`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": requestId },
    });
    if (status === 204 || status === 200) return;
    const issue = Array.isArray(asObj(body).details) ? asStr(asObj((asObj(body).details as unknown[])[0]).issue) : null;
    if (status === 422 && issue === "AUTHORIZATION_ALREADY_VOIDED") return;
    this.fail("void authorization", status, body, debugId);
  }

  async refundCapture(captureId: string, input: { amountMinor: number; currency: string; requestId: string; note: string }): Promise<ProviderRefund> {
    assertId(captureId, "capture");
    const token = await this.accessToken();
    const { status, body, debugId } = await this.request(`/v2/payments/captures/${captureId}/refund`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": input.requestId, Prefer: "return=representation" },
      body: JSON.stringify({
        amount: { currency_code: input.currency, value: toProviderDecimal(input.amountMinor, input.currency) },
        note_to_payer: input.note.slice(0, 255),
      }),
    });
    if (status !== 200 && status !== 201) this.fail("refund", status, body, debugId);
    return { ...parsePayPalRefund(body), captureId };
  }

  /** POST /v1/notifications/verify-webhook-signature. Returns true only on SUCCESS. */
  async verifyWebhookSignature(input: { headers: Headers; webhookId: string; event: unknown }): Promise<boolean> {
    const h = input.headers;
    const needed = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
    if (needed.some((k) => !h.get(k))) return false;
    const token = await this.accessToken();
    const { status, body } = await this.request("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: h.get("paypal-auth-algo"),
        cert_url: h.get("paypal-cert-url"),
        transmission_id: h.get("paypal-transmission-id"),
        transmission_sig: h.get("paypal-transmission-sig"),
        transmission_time: h.get("paypal-transmission-time"),
        webhook_id: input.webhookId,
        webhook_event: input.event,
      }),
    });
    return status === 200 && asStr(asObj(body).verification_status) === "SUCCESS";
  }
}
