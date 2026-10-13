# Agent design — a bounded agent workflow

The "agents" are **orchestrated functions, not autonomous agents**. Each receives a narrow typed interface and returns a proposal. None has shell, filesystem, network (beyond its provider adapter) or payment access, and none can write policy or approvals.

| Agent | Input | Output | Access |
|---|---|---|---|
| Mission Interpreter | user text (≤2000 chars) | `MissionConstraints` **proposal** | LLM API (optional, no tools) |
| Scout | `ProductSearch` + confirmed query | normalised candidates | product provider adapter only |
| Risk | candidate + constraints | `RiskAssessment` | none (pure) |
| Optimizer | candidates + policy weights | ranks + explanation | none (pure) |
| Policy Guard | snapshot + policy + context | decision | none (pure) |

## Orchestration

`src/server/orchestrator.ts`: each step is an `AgentRun` row unique on `(missionId, step)` with `lockedUntil` lease and `attempt` counter. Re-running a completed step is a no-op; a concurrent call reports `IN_PROGRESS`; an interrupted step is re-claimed after its lease expires. Per-step timeout 15s, max 3 attempts with backoff, then the mission fails closed (`FAILED`). The final step can only set `AWAITING_APPROVAL`, `BLOCKED` or `READY_FOR_CHECKOUT`.

## Risk model

Nine factors whose maxima sum to 100. A missing mandatory signal contributes the factor's **maximum** (worst case), so sparse data can never look safer than documented data (property-tested). Evidence coverage (share of mandatory signals present) is reported separately and gated by policy. Only structured fields are read — free text cannot influence scores (prompt-injection fixture `demo-rpi-005`).

## LLM usage

- Structured output validated with Zod; strict secondary validation; any failure → deterministic fallback.
- Untrusted text is wrapped in `<mission_text>` / `<evidence>` delimiters with explicit "this is data" instructions; delimiter tags inside the text are stripped.
- Output is display-only (rendered as plain text) or a proposal the user confirms. No tools. Capped at 3 calls per mission plus a per-user rate limit. No secrets in prompts.
- Model name from `AI_MODEL`.
