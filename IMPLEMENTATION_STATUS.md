# AEGIS — Implementation Status

_Last updated: 2026-10-14_

## 2026-10-14 additions

- **Channel3 real product data** (UCP/MCP adapter, per-retailer offers, list-price / cross-retailer reference prices, restricted-class re-labelling, retry + labelled demo fallback). ✅ verified live against `ucp.trychannel3.com`.
- **Spending caps with PayPal AUTHORIZE** (policy `costAllowancePct`, floor check `floor.spend_cap` = always REQUIRE_APPROVAL, approval snapshot binds amount basis + allowance). Payment states `AUTHORIZE_PENDING → AUTHORIZED → SETTLE_PENDING → CAPTURED`, release (void), expiry. ✅ integration-tested; ✅ Sandbox accepts the AUTHORIZE order body and refuses authorization before buyer approval; ⚠️ buyer-approved hold/settle not yet run live (needs a browser Sandbox buyer login).
- **Refunds** (full/partial, `Refund` table, concurrency-safe, webhook reconciliation). ✅ integration-tested.
- **Logic**: prompt-injection floor (`floor.untrusted_content`), accessory guard ("cooler *for* Raspberry Pi 5" ≠ Raspberry Pi 5), measurement contradictions ("1m" vs required "2m"), attribute key aliases and token matching, availability-only stock evidence, exact totals ranked ahead of caps, proportional cost scoring, optimizer mirrors policy evidence/verification gates, block explanations quote the blocking check.
- **Ops**: Node happy-eyeballs timeout raised at boot (outbound PayPal/Channel3 calls timed out with ETIMEDOUT on this network).
- Forward migration `20261014120000_authorize_settle_refund` (no reset).

## Quality gate (all run in this environment)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ pass |
| `npm run lint` | ✅ pass |
| Unit + component tests | ✅ 103 / 103 |
| Integration tests (real Postgres, mocked PayPal/LLM) | ✅ 49 / 49 |
| Production build (`next build`) | ✅ pass |
| E2E (Playwright, isolated DB, forced DEMO mode) | ✅ 4 passed, 1 skipped (live Sandbox — no credentials) |
| Client-bundle secret scan | ✅ no secret values (only the variable name in Settings help text) |
| Boot refusal of live PayPal host | ✅ verified: process exits with code 1 |
| No-credentials demo run in a real browser | ✅ full flow incl. replay; zero page errors |
| Responsive check (390px) | ✅ no horizontal overflow; 3D falls back to 2D |

## Phases

1. **Vertical slice** ✅ — Postgres + Prisma 7, minor-unit money, pure policy & risk engines, state machines, CAS, orchestrator, demo provider, approval snapshot hash, hash-chained append-only audit, payments (mock + simulated), minimal UI.
2. **PayPal Sandbox** ✅ implemented / ⚠️ **unverified live** — OAuth, order create, JS SDK checkout, verified capture, reconciliation, idempotency, webhooks. Tested against mocked HTTP and an in-memory mock gateway only.
3. **Visual layer** ✅ — design tokens, landing, shell, R3F scene with 2D fallback, single view-model reducer.
4. **Operations** ✅ — AG Grid transactions (CSV with injection escaping), audit view with chain indicator, mission detail, read-only replay.
5. **Analytics & settings** ✅ — DEMO and SANDBOX volumes separated; every chart labels its source; validated colour palette.
6. **Integrations** — Gemini adapter ✅ verified live (mission parsing + explanations). Channel3 ✅ verified live.

## Real vs simulated vs unverified

- **Real & verified:** policy/risk engines, state machines, approvals, audit chain + triggers, orchestrator resume/idempotency, CSRF/ownership/rate limits, simulated end-to-end checkout path, replay read-only.
- **Simulated (clearly labelled):** DEMO payments (SimulatedGateway), demo catalogue (fictional sellers, seeded reference prices).
- **Unverified:** live PayPal Sandbox calls and buttons, webhook signature verification against PayPal, Anthropic structured output.

## Remaining work (prioritised)

1. Run the Sandbox path in a browser with a Sandbox buyer (create → approve → capture / hold → settle → refund → webhook) and record results.
2. Exercise the Anthropic adapter with a key; tune the prompt; add a recorded-response test.
3. Demo product images (paths exist in the catalogue; the UI currently renders no images).
4. Webhook: refund/dispute coverage beyond CAPTURED→DISPUTED/REFUNDED; scheduled reconciliation job (today: on read + on webhook).
5. Real authentication (replace demo identity) and separate requester/approver users.
6. Cursor pagination for the transactions/analytics endpoints at larger volumes.
