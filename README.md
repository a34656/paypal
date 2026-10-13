# AEGIS — Autonomous Commerce Trust Platform

> **AI CAN ACT. AEGIS MAKES SURE IT ACTS RESPONSIBLY.**

AEGIS is a trust, governance and financial-execution layer between an AI commerce agent and PayPal.

**The AI proposes. The deterministic policy engine enforces. A human authorizes. PayPal processes. The audit log remembers.**

A user describes a purchasing mission → it is parsed into a structured *proposal* the user confirms → Scout finds candidates → Risk scores them → Optimizer ranks the eligible ones → Policy Guard decides (BLOCK / REQUIRE_APPROVAL / ALLOW_CHECKOUT) → a human approves the exact purchase → the server creates a PayPal order → the buyer approves in PayPal → the server verifies and captures → every step is audited (hash-chained) and replayable.

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

- **Mission parsing as a proposal** — LLM (Anthropic, optional) or deterministic parser; the user confirms/edits a structured form. Raw text never reaches the policy engine.
- **Bounded agent workflow** — Scout → Risk → Optimizer → Policy Guard as orchestrated functions with narrow interfaces; resumable steps with leases, idempotency, bounded retries.
- **Deterministic risk model** — 0–100 risk (trust = 100 − risk, derived only), separate evidence coverage; missing evidence is scored as worst case.
- **Pure policy engine** — hard-coded floor + configurable, immutable, versioned policies; precedence BLOCK › REQUIRE_APPROVAL › ALLOW.
- **Human approval** bound to the exact purchase by SHA-256 snapshot hash, policy version and expiry.
- **PayPal Orders v2** — server-computed amounts, PayPal-Request-Id idempotency, verified capture (two gates), crash reconciliation, signature-verified webhooks.
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

See [`.env.example`](.env.example). Summary: `DATABASE_URL`, `SESSION_SECRET`, `AEGIS_APP_ORIGIN`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_BASE_URL`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MERCHANT_ID`, `AEGIS_ALLOW_LIVE`, `AEGIS_ENVIRONMENT`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `CHANNEL3_API_KEY`.

## PayPal Sandbox setup

1. developer.paypal.com → Apps & Credentials → **Sandbox** → create a REST app.
2. Put its client id in **both** `PAYPAL_CLIENT_ID` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, and the secret in `PAYPAL_CLIENT_SECRET`. Keep `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`.
3. Optional: `PAYPAL_MERCHANT_ID` (Sandbox business account payer id) to enable the payee check.
4. Restart. Checkout with a Sandbox **personal** account.
5. Webhooks (optional): register `https://<public-host>/api/paypal/webhook` for `PAYMENT.CAPTURE.*` and `CUSTOMER.DISPUTE.CREATED`; set `PAYPAL_WEBHOOK_ID`. Local testing needs a public tunnel.

Details: [docs/paypal-flow.md](docs/paypal-flow.md).

## AI setup (optional)

Set `ANTHROPIC_API_KEY` and `AI_MODEL`. The LLM only proposes parsed missions and writes display-only explanations; output is Zod-validated, untrusted text is passed as delimited data, and every failure falls back to the deterministic path. Capped at 3 LLM calls per mission and rate-limited.

## Channel3 (optional)

Not implemented: no verified API access was available, and AEGIS never fabricates or scrapes provider results. The demo catalogue (fictional sellers, seeded reference prices) is always labelled DEMO.

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
- Live PayPal Sandbox calls are implemented and unit-tested against mocked HTTP, but **unverified end-to-end** in this repository (no credentials were available).
- Policy limits are single-currency (no FX). One mission = one purchase.
- Webhook processing re-fetches the order; dispute handling only marks CAPTURED → DISPUTED.
- Audit chain appends are serialised with a Postgres advisory lock (a throughput ceiling, fine for this scale).
