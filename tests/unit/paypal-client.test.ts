import { describe, expect, it, vi } from "vitest";
import { buildCreateOrderBody, parsePayPalOrder, PayPalHttpGateway } from "@/server/paypal/client";
import { ProviderError, verifyOrderMatches } from "@/domain/payments/gateway";

const amount = { currency: "USD", totalMinor: 176_700, itemTotalMinor: 160_000, shippingMinor: 3_500, taxMinor: 13_200 };
const orderBody = (status = "APPROVED") => ({
  id: "5O190127TN364715T",
  status,
  intent: "CAPTURE",
  purchase_units: [
    {
      custom_id: "pay_1",
      invoice_id: "AEGIS-pay_1",
      payee: { merchant_id: "MERCHANT1" },
      amount: { currency_code: "USD", value: "1767.00", breakdown: { item_total: { currency_code: "USD", value: "1600.00" }, shipping: { currency_code: "USD", value: "35.00" }, tax_total: { currency_code: "USD", value: "132.00" } } },
      payments: status === "COMPLETED" ? { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "1767.00" } }] } : undefined,
    },
  ],
});

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "paypal-debug-id": "dbg" } });
}

describe("PayPal client (mocked fetch — never reaches PayPal)", () => {
  it("builds the order with exact decimal strings and breakdown", () => {
    const b = buildCreateOrderBody({ requestId: "r", amount, customId: "pay_1", invoiceId: "AEGIS-pay_1", description: "x" });
    expect(b.intent).toBe("CAPTURE");
    expect(b.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "1767.00", breakdown: { item_total: { currency_code: "USD", value: "1600.00" }, shipping: { currency_code: "USD", value: "35.00" }, tax_total: { currency_code: "USD", value: "132.00" } } });
    expect(b.purchase_units[0].custom_id).toBe("pay_1");
  });

  it("sends PayPal-Request-Id and caches the OAuth token", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/v1/oauth2/token")) return res(200, { access_token: "TOKEN", expires_in: 3600 });
      if (u.endsWith("/v2/checkout/orders")) {
        expect((init?.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("req-1");
        return res(201, orderBody("CREATED"));
      }
      if (u.endsWith("/capture")) {
        expect((init?.headers as Record<string, string>)["PayPal-Request-Id"]).toBe("cap-1");
        return res(201, orderBody("COMPLETED"));
      }
      return res(200, orderBody());
    });
    const g = new PayPalHttpGateway({ baseUrl: "https://api-m.sandbox.paypal.com", clientId: "id", clientSecret: "secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    await g.createOrder({ requestId: "req-1", amount, customId: "pay_1", invoiceId: "AEGIS-pay_1", description: "x" });
    const o = await g.getOrder("5O190127TN364715T");
    expect(o.totalMinor).toBe(176_700);
    const c = await g.captureOrder("5O190127TN364715T", "cap-1");
    expect(c.captures[0]).toMatchObject({ id: "CAP1", status: "COMPLETED", amountMinor: 176_700 });
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/oauth2/token"))).toHaveLength(1);
  });

  it("maps ORDER_ALREADY_CAPTURED to a typed provider error", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/token") ? res(200, { access_token: "T", expires_in: 3600 }) : res(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }], debug_id: "D1" }),
    );
    const g = new PayPalHttpGateway({ baseUrl: "https://api-m.sandbox.paypal.com", clientId: "id", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(g.captureOrder("5O190127TN364715T", "x")).rejects.toMatchObject({ issue: "ORDER_ALREADY_CAPTURED", debugId: "D1", outcomeUnknown: false });
  });

  it("retries 5xx with the same request id and reports unknown outcome on network failure", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/token")) return res(200, { access_token: "T", expires_in: 3600 });
      calls += 1;
      throw new TypeError("network down");
    });
    const g = new PayPalHttpGateway({ baseUrl: "https://api-m.sandbox.paypal.com", clientId: "id", clientSecret: "s", maxRetries: 2, fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await g.captureOrder("5O190127TN364715T", "x").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.outcomeUnknown).toBe(true);
    expect(calls).toBe(3);
  });

  it("rejects malformed order ids before any request", async () => {
    const fetchImpl = vi.fn();
    const g = new PayPalHttpGateway({ baseUrl: "https://api-m.sandbox.paypal.com", clientId: "id", clientSecret: "s", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(g.getOrder("../../v1/evil")).rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verifies every money-relevant order field", () => {
    const order = parsePayPalOrder(orderBody(), null);
    const expected = { orderId: order.id, amount, customId: "pay_1", invoiceId: "AEGIS-pay_1", merchantId: "MERCHANT1" };
    expect(verifyOrderMatches(order, expected).ok).toBe(true);
    expect(verifyOrderMatches({ ...order, totalMinor: 1 }, expected).ok).toBe(false);
    expect(verifyOrderMatches({ ...order, taxMinor: 0 }, expected).ok).toBe(false);
    expect(verifyOrderMatches({ ...order, customId: "other" }, expected).ok).toBe(false);
    expect(verifyOrderMatches({ ...order, intent: "AUTHORIZE" }, expected).ok).toBe(false);
    expect(verifyOrderMatches({ ...order, payeeMerchantId: "EVIL" }, expected).ok).toBe(false);
    expect(verifyOrderMatches({ ...order, currency: "EUR" }, expected).ok).toBe(false);
  });
});
