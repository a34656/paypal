# Security

## Non-negotiable invariants (each covered by tests)

| # | Invariant | Enforcement | Tests |
|---|---|---|---|
| 1 | Only human-authenticated routes create orders or capture | Payment functions only called from `/api/paypal/*` (session + CSRF); orchestrator has no payment import | `security-audit.test.ts`, `mission-workflow.test.ts` ("workflow never creates orders") |
| 2 | Two gates before capture | Approval check + PayPal `GET order` status APPROVED, both server-side | `payments.test.ts` (capture before buyer approval, expired / mismatched approval) |
| 3 | Server-side truth | Strict `{missionId}` / `{paymentId}` bodies; amounts recomputed; order verified field by field | `payments.test.ts` ("client amounts are rejected", tampered order) |
| 4 | Fail closed | Floor checks; unknown total / missing risk → BLOCK; coverage gate; parse failures → fallback/validation errors | `policy.test.ts`, `risk.test.ts` |
| 5 | Most restrictive wins | `evaluate` aggregates max severity | `policy.test.ts` |
| 6 | Sandbox by default | Zod boot validation; process exits on violation | `security-utils.test.ts`; manual check (exit code 1 with live host) |
| 7 | No self-approval by agents/LLM | Approval & policy routes are human-only; role gate for REQUIRE_APPROVAL | `payments.test.ts` (APPROVER role) |
| 8 | Audit-or-abort | `appendAudit(tx, …)` inside the same transaction as every state change | `security-audit.test.ts` (chain, append-only) |
| 9 | Untrusted data stays data | Structured-only risk inputs; plain-text rendering; delimited LLM prompts | `risk.test.ts`, `components/ui.test.tsx` |
| 10 | No fabricated success | `CAPTURED` only from provider capture status; simulated payments labelled | `payments.test.ts` (pending/timeout), E2E |
| 11 | Replay is read-only | Client-side reducer over GET data | E2E (zero non-GET requests) |

## Identity

Demo identity only: the proxy issues a signed (HMAC-SHA256), httpOnly, SameSite=Lax session cookie, mapped to a per-session `User`. A visitor holds REQUESTER and (toggleable) APPROVER. Approvals record who approved. **Not production authentication.**

## Controls

- Unguessable ids (cuid/UUID); ownership checks return 404 for foreign ids.
- CSRF: Origin allowlist + `x-aegis-csrf` header that must equal an HMAC of the session id (double-submit cookie). No financial action over GET.
- DB-backed fixed-window rate limits on mission creation / LLM, execute, approve, order, capture, policy writes, webhooks.
- Untrusted rendering: React text only (no `dangerouslySetInnerHTML`); only local `/demo-products/` image paths survive normalisation; no server-side fetches of user URLs.
- CSV export escapes cells starting with `= + - @ \t \r`.
- Secrets server-only; audit metadata passes an **allowlist** redactor that also scrubs credential patterns and literal secret values; client-bundle scan found no secret values.
- Errors: typed envelope with a correlation id; no stacks.
- Security headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`.

## Threat notes

- **Prompt injection** via listings or mission text: cannot reach policy/scores/decisions; worst case is misleading display text, which is labelled as LLM output.
- **Client tampering** with amounts/order ids: rejected by strict schemas and server recomputation.
- **Replay / double submit**: CAS + unique indexes + PayPal-Request-Id.
- **Stale approvals**: snapshot hash binds product, seller, quantity, prices, currency, policy version and expiry.
- **Webhook spoofing**: signature verification via PayPal API; body is only a trigger (order re-fetched).
- **Audit tampering**: DB triggers block UPDATE/DELETE; hash chain detects bypasses (tested by disabling the trigger).
- **Residual**: demo identity is bearer-cookie only; advisory-lock serialisation of audit appends; no WAF/bot protection.
