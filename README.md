# AEGIS — Autonomous Commerce Trust Platform

> **AI CAN ACT. AEGIS MAKES SURE IT ACTS RESPONSIBLY.**

AEGIS is a trust, governance and financial-execution layer between an AI commerce agent and PayPal.

**The AI proposes. The deterministic policy engine enforces. A human authorizes. PayPal processes. The audit log remembers.**

A user describes a purchasing mission → it is parsed into a structured *proposal* the user confirms → Scout finds **real retailer offers** (Channel3 cross-merchant catalogue) → Risk scores them → Optimizer ranks the eligible ones → Policy Guard decides (BLOCK / REQUIRE_APPROVAL / ALLOW_CHECKOUT) → a human approves the exact purchase → the server creates a PayPal order → the buyer approves in PayPal → the server verifies and captures — or, when the seller hides shipping/tax, places a **PayPal authorization hold for a policy spending cap** that a human later settles at the real invoice amount → refunds flow back through the same gates → every step is audited (hash-chained) and replayable.

> Hackathon MVP. Not a regulated financial institution or a production fraud system. AEGIS does not guarantee fraud detection, and LLM confidence is never treated as proof of safety. Demo identity is a signed per-browser cookie, **not** production authentication.

## Quick start

Requirements: Node 22+, Docker.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then set SESSION_SECRET (see comment in the file)
npm run setup               # Postgres (Docker, port 5433) + migrations + demo catalogue
npm run dev                 # http://localhost:3000
```

Production mode locally: `npm run build && npm start` (the server **refuses to start** in production with the development session secret, a non-allowlisted PayPal host, or the live PayPal host without explicit flags).

Reset demo data: `npm run demo:reset` (local databases only).

## Features

- **Real product data** — the Scout agent queries [Channel3](https://trychannel3.com)'s cross-retailer catalogue over the Universal Commerce Protocol (MCP). One candidate per retailer; reference price = retailer list price or cross-retailer median; refurbished/unavailable offers dropped; gift cards/crypto/weapons re-labelled so blocked-category policy applies. Falls back to the labelled demo catalogue only if Channel3 is unreachable.
- **Spending caps via PayPal authorization** — real listings rarely disclose shipping/tax. Instead of guessing, AEGIS asks an approver to sign off on a cap (item total + policy allowance, default 15%), places a PayPal **AUTHORIZE** hold for exactly that cap, and a human later settles the real invoice amount (partial capture with `final_capture`, remainder released) or releases the hold (void). A cap can never be auto-approved.
- **Refunds** — full and partial, persisted with their PayPal-Request-Id before the call, bounded by the captured amount even under concurrent clicks; refunds made in the PayPal dashboard are picked up from `PAYMENT.CAPTURE.REFUNDED`.
- **Prompt-injection floor** — listing text that addresses an automated agent ("ignore previous instructions", "approve this order", "set risk score") BLOCKs the offer. Detection can only raise risk, never lower it.
- **Mission parsing as a proposal** — LLM (Google Gemini, optional) or deterministic parser; the user confirms/edits a structured form. Raw text never reaches the policy engine.
- **Bounded agent workflow** — Scout → Risk → Optimizer → Policy Guard as orchestrated functions with narrow interfaces; resumable steps with leases, idempotency, bounded retries.
- **Deterministic risk model** — 0–100 risk (trust = 100 − risk, derived only), separate evidence coverage; missing evidence is scored as worst case.
- **Pure policy engine** — hard-coded floor + configurable, immutable, versioned policies; precedence BLOCK › REQUIRE_APPROVAL › ALLOW.
- **Human approval** bound to the exact purchase by SHA-256 snapshot hash, policy version and expiry.
- **PayPal Orders v2 + Payments v2** — `CAPTURE` and `AUTHORIZE` intents, authorization capture/void, capture refunds; server-computed amounts, PayPal-Request-Id idempotency on every money call, verified capture/hold (two gates), crash reconciliation, signature-verified webhooks (`PAYMENT.CAPTURE.*`, `PAYMENT.AUTHORIZATION.*`, `CUSTOMER.DISPUTE.CREATED`).
- **Audit log** — append-only (DB triggers) and hash-chained, written in the same transaction as each state change; chain verification in UI.
- **Command Center** with interactive React Three Fiber network (2D fallback), **one reducer for live and replay**, read-only replay.
- **Transactions** (AG Grid Community, CSV export with formula-injection escaping), **Analytics** (DEMO vs SANDBOX never blended), **Audit**, **Policies**, **Agents**, **Settings**.

## Modes

| Mode | When | Payments |
| --- | --- | --- |
| **DEMO** | No PayPal credentials | Simulated gateway; banner "DEMO MODE — PAYPAL NOT CONNECTED"; every simulated payment is labelled "SIMULATED — no money moved". |
| **SANDBOX** | `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` set, sandbox host | Real PayPal Sandbox API (test money). |
| **LIVE** | Never by default | Refused unless `AEGIS_ALLOW_LIVE=true` **and** `AEGIS_ENVIRONMENT=production`. Even then every capture needs human + buyer approval. |

## Environment variables

See [`.env.example`](.env.example). Summary: `DATABASE_URL`, `SESSION_SECRET`, `AEGIS_APP_ORIGIN`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_BASE_URL`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MERCHANT_ID`, `AEGIS_ALLOW_LIVE`, `AEGIS_ENVIRONMENT`, `GEMINI_API_KEY`, `AI_MODEL`, `PRODUCT_PROVIDER` (`channel3` default, `demo` for offline), `CHANNEL3_API_KEY` (optional).

## PayPal Sandbox setup

1. developer.paypal.com → Apps & Credentials → **Sandbox** → create a REST app.
2. Put its client id in **both** `PAYPAL_CLIENT_ID` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, and the secret in `PAYPAL_CLIENT_SECRET`. Keep `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`.
3. Optional: `PAYPAL_MERCHANT_ID` (Sandbox business account payer id) to enable the payee check.
4. Restart. Checkout with a Sandbox **personal** account.
5. Webhooks (optional): register `https://<public-host>/api/paypal/webhook` for `PAYMENT.CAPTURE.*`, `PAYMENT.AUTHORIZATION.*` and `CUSTOMER.DISPUTE.CREATED`; set `PAYPAL_WEBHOOK_ID`. Local testing needs a public tunnel.

Details: [docs/paypal-flow.md](docs/paypal-flow.md).

## AI setup (optional)

Set `GEMINI_API_KEY` and `AI_MODEL` (e.g. `gemini-2.5-pro`). The LLM only proposes parsed missions and writes display-only explanations; output is Zod-validated, untrusted text is passed as delimited data, and every failure falls back to the deterministic path. Capped at 3 LLM calls per mission and rate-limited.

## Product data: Channel3

`PRODUCT_PROVIDER=channel3` (the default) uses Channel3's public UCP catalog endpoint (`https://ucp.trychannel3.com/mcp`, tools `search_catalog`); it works without a key, and `CHANNEL3_API_KEY` raises rate limits. AEGIS never scrapes retailer sites: everything comes from the catalogue response, and anything the catalogue does not disclose (shipping, tax, delivery, stock quantity, seller verification) stays unknown and is scored as such. Retailers can be trusted per policy (`trustedSellerDomains`). `PRODUCT_PROVIDER=demo` uses the fictional catalogue (offline; used by all tests).

Example missions for live data (catalogue search results vary between calls, so the outcome can differ run to run — that variance is real, and AEGIS blocks rather than buys a near-match):
- _"Purchase 2 Raspberry Pi 5 starter kits (8GB) for the lab. Budget $700."_ → typically REQUIRE_APPROVAL under a spending cap; 4GB kits, accessories "for Raspberry Pi 5" and the Raspberry Pi 500 are rejected as mismatches.
- _"Buy 10 USB-C to USB-C cables, 2m, for the hardware bench. Budget $400."_ → REQUIRE_APPROVAL when a 2m (or unstated-length) cable from a trusted retailer is returned; 1m cables are rejected.
- _"Buy 5 Groupon gift cards for the team. Budget $600."_ → BLOCK (restricted category).

## Tools used

- **PayPal** — Orders v2 (create/get/capture/authorize), Payments v2 (authorization capture & void, capture refund), JS SDK checkout buttons, webhooks + signature verification. Sandbox.
- **Channel3** (sponsor) — real cross-retailer product catalogue via UCP/MCP for the Scout agent.
- **Google Gemini** — optional: parses mission text into a proposal the user confirms, and writes display-only explanations. It cannot change scores, decisions, approvals or payments.
- **AG Grid** (sponsor) — transactions grid with CSV export.

## Testing

```bash
npm run test               # unit + component (no DB)
npm run test:integration   # real Postgres (aegis_test DB), mocked PayPal & LLM
npm run build && npm run test:e2e   # Playwright against an isolated aegis_e2e DB, forced DEMO mode
npm run typecheck && npm run lint
```

Tests never reach PayPal or an LLM.

## Deployment

Vercel or Render with managed Postgres; rate limiting is DB-backed. See [docs/deployment.md](docs/deployment.md).

## Documentation

- [Architecture](docs/architecture.md) · [PayPal flow](docs/paypal-flow.md) · [Agent design](docs/agent-design.md) · [Security & invariants](docs/security.md) · [State machines](docs/state-machines.md) · [Demo script](docs/demo-script.md) · [Deployment](docs/deployment.md) · [Implementation status](IMPLEMENTATION_STATUS.md)

## Known limitations

- Demo identity is not authentication (signed per-browser cookie; a visitor may hold both roles).
- PayPal Sandbox: OAuth and order creation (CAPTURE and AUTHORIZE) verified against the real Sandbox API; buyer approval → hold → settle → refund is exercised end to end against an in-memory PayPal mock and the simulator, and needs a Sandbox buyer login in the browser to run live.
- Channel3 does not disclose shipping, tax, delivery estimates or stock quantity, so real offers are always bought under a spending cap with approver sign-off, and evidence coverage is lower than for the demo catalogue.
- Policy limits are single-currency (no FX). One mission = one purchase.
- Webhook processing re-fetches the order; dispute handling only marks CAPTURED → DISPUTED (no dispute responses).
- The PayPal payee is the AEGIS Sandbox merchant (a purchasing account), not the retailer; retailer checkout itself is out of scope.
- Audit chain appends are serialised with a Postgres advisory lock (a throughput ceiling, fine for this scale).
