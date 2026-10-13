# State machines

Single source of truth: `src/domain/state/machines.ts`. Every update is a compare-and-set with the audit event in the same transaction. Terminal states have no outgoing edges.

## Workflow (Mission.status)

```
CREATED → PARSED → CONFIRMED → SCOUTING → SCOUTED → RISK_ANALYSIS → OPTIMIZING → POLICY_EVALUATION
POLICY_EVALUATION → AWAITING_APPROVAL | BLOCKED | READY_FOR_CHECKOUT
AWAITING_APPROVAL → READY_FOR_CHECKOUT | DENIED | EXPIRED | BLOCKED
READY_FOR_CHECKOUT → COMPLETED | AWAITING_APPROVAL (re-approval) | BLOCKED | DENIED | EXPIRED
any running state → FAILED
terminal: BLOCKED, FAILED, EXPIRED, DENIED, COMPLETED
```

## Payment (Payment.status)

```
NOT_STARTED → PENDING_APPROVAL → APPROVED   (virtual: a row is created at APPROVED)
APPROVED → ORDER_CREATED → CHECKOUT_PENDING → CAPTURE_PENDING → CAPTURED | CAPTURE_PROVIDER_PENDING | FAILED
CAPTURE_PROVIDER_PENDING → CAPTURED | FAILED
CAPTURED → REFUNDED | DISPUTED ;  DISPUTED → REFUNDED
pre-capture states → CANCELLED | EXPIRED | BLOCKED | FAILED
terminal: FAILED, CANCELLED, BLOCKED, EXPIRED, REFUNDED
```

## Approval

`ACTIVE → CONSUMED | EXPIRED | REVOKED | INVALIDATED` (one ACTIVE per mission, partial unique index).

## Derived display status

`deriveDisplayStatus(workflow, latestPayment)` — e.g. READY_FOR_CHECKOUT + CHECKOUT_PENDING → `CHECKOUT_IN_PROGRESS`; CAPTURED → `COMPLETED`. Never stored.

All legal and illegal pairs are enumerated in `tests/unit/state-machines.test.ts`.
