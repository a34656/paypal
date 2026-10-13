# PayPal flow

All PayPal traffic lives in `src/server/paypal/client.ts` (OAuth token cache, Orders v2 create/get/capture, webhook signature verification) with timeouts (10s) and bounded retries (2) on network errors / 5xx. Retries reuse the same `PayPal-Request-Id`.

## Sequence

1. **Policy + approval.** The workflow ends in `AWAITING_APPROVAL` (APPROVER role required) or `READY_FOR_CHECKOUT` (owner authorisation still required). `POST /api/missions/:id/approve` re-evaluates the current policy, computes the snapshot hash, and stores an `Approval` (ACTIVE, expiring).
2. **Order.** `POST /api/paypal/orders {missionId}` (strict body — extra fields rejected). The server recomputes the all-in amount from stored data, verifies the approval (active, unexpired, hash match), inserts the `Payment` with `idempotencyKey`, `captureRequestId` and `invoiceId` **before** calling PayPal, then creates the order: `intent=CAPTURE`, breakdown (item_total, shipping, tax_total), `custom_id = paymentId`, unique `invoice_id`. Status `APPROVED → ORDER_CREATED → CHECKOUT_PENDING`.
3. **Buyer approval** in the PayPal JS SDK. `onApprove` sends only `{paymentId}`.
4. **Capture.** `POST /api/paypal/capture {paymentId}`:
   - session, ownership, rate limit;
   - loads the stored `providerOrderId` (never client-supplied);
   - `GET` order: status `APPROVED`, intent, currency, total + breakdown, `custom_id`, `invoice_id`, payee merchant (if `PAYPAL_MERCHANT_ID`);
   - approval ACTIVE, unexpired, snapshot hash equals a freshly recomputed hash;
   - re-evaluates the **current** policy (stricter → invalidate / re-approve; looser never upgrades);
   - CAS `CHECKOUT_PENDING → CAPTURE_PENDING` + audit in one transaction (duplicate-capture guard);
   - capture with the stored `PayPal-Request-Id`;
   - verify the capture, set `CAPTURED` / `CAPTURE_PROVIDER_PENDING` / `FAILED`, consume the approval, complete the mission.
5. **Crash recovery.** A `CAPTURE_PENDING` older than 30s is reconciled on read (`GET /api/missions/:id`, which only *records* provider truth, never captures) and by webhooks. A new capture request on a stale `CAPTURE_PENDING` re-fetches the order; if not captured it retries with the same request id. `ORDER_ALREADY_CAPTURED` is resolved by re-fetching the order.
6. **Expiry.** Approval expiry (policy TTL) and PayPal order expiry are separate. Per the Orders v2 spec bundled in `@paypal/paypal-js`: by default the payer must be redirected within 3 hours of creation and approve/capture within 3 hours after that. AEGIS expires abandoned checkouts after 3 hours.

## Webhooks (`POST /api/paypal/webhook`)

Raw body via `request.text()` → `verify-webhook-signature` API (with `PAYPAL_WEBHOOK_ID`) → dedupe on the event id (`WebhookEvent.providerEventId` unique) → re-fetch the order and apply it through the monotonic state machine. Handled: `PAYMENT.CAPTURE.*` (completed, pending, denied, refunded…), `CUSTOMER.DISPUTE.CREATED`. Register per environment; local testing needs a public tunnel (e.g. `cloudflared`, `ngrok`).

## Demo mode

Without credentials the `SimulatedGateway` (state in `SimulatedOrder`) follows exactly the same server path. Buyer approval is a labelled stand-in button. Payments are mode `DEMO`, provider `simulated`, and the UI says "SIMULATED — no money moved".

## Verification status

The REST client is unit-tested against mocked HTTP (request ids, decimal strings, error mapping, retries). Integration tests use an in-memory mock gateway. **A live Sandbox run has not been performed in this repository** (no credentials available).
