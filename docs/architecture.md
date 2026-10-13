# Architecture

```
Browser (Next.js App Router, React, R3F)          Server (Route Handlers, Node runtime)               External
────────────────────────────────────────          ────────────────────────────────────────            ────────
Pages → SWR polling → /api/*  ───────────────▶   src/server/api.ts (session, CSRF, rate limit, Zod)
PayPal JS SDK (buttons) ─ createOrder ────────▶   /api/paypal/orders  ─▶ payments.ts ─▶ paypal/client ─▶ PayPal Orders v2
                       ─ onApprove {paymentId} ▶   /api/paypal/capture ─▶ payments.ts (2 gates, CAS)
Replay (client-only reducer over GET events)       /api/missions/[id]/execute ─▶ orchestrator.ts (AgentRun leases)
                                                                  │  Scout → Risk → Optimizer → Policy Guard
                                                   domain/* (pure): policy engine, risk engine, optimizer,
                                                                    state machines, snapshot hash, money
                                                   audit.ts: append-only hash chain (same transaction)
                                                   PostgreSQL (Prisma 7 + adapter-pg)       ◀── /api/paypal/webhook (verified)
```

## Modules

| Path | Responsibility |
|---|---|
| `src/lib/money.ts` | Integer minor units, per-currency exponents, exact provider decimal conversion |
| `src/lib/env.ts` | Boot-time Zod env validation, host allowlist, live refusal |
| `src/domain/policy/*` | Pure policy engine + schema + diff (loosening detection) |
| `src/domain/risk/engine.ts` | Deterministic risk scoring and evidence coverage |
| `src/domain/agents/optimizer.ts` | Pure ranking over eligible offers |
| `src/domain/state/machines.ts` | Workflow + payment transition tables, derived display status |
| `src/domain/approval/snapshot.ts` | Snapshot hash and pure approval checks |
| `src/domain/viewmodel/reducer.ts` | events → MissionViewModel (live, 3D, timeline, replay) |
| `src/server/orchestrator.ts` | Resumable step runner |
| `src/server/approvals.ts` | Human approval gate |
| `src/server/payments.ts` | Orders, verified capture, reconciliation, cancel |
| `src/server/paypal/*` | REST client (only module that talks to PayPal), simulator, gateway selection |
| `src/server/audit.ts` | Hash-chained append + `verifyAuditChain()` |
| `src/server/api.ts` | Route wrapper (session → user, CSRF, rate limit, error mapping) |
| `src/proxy.ts` | Issues signed demo-session + CSRF cookies |

## Data model

See `prisma/schema.prisma`. Constraints Prisma cannot express are in SQL migrations:
partial unique indexes (one ACTIVE approval per mission, one live payment per mission), amount CHECKs, and append-only triggers on `AuditEvent` and `Policy`.

## Concurrency

- State changes use compare-and-set (`WHERE id AND status AND version`), never row locks.
- AgentRun claims use the attempt counter as a fencing token and a lease (`lockedUntil`).
- Duplicate capture is prevented by the `CHECKOUT_PENDING → CAPTURE_PENDING` CAS committed with its audit event before PayPal is called.
- Audit appends are serialised with a transaction-scoped advisory lock so the chain never forks.
