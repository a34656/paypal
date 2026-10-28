/**
 * Allowlist redactor for audit metadata and logs. Only known-safe keys survive; any other
 * key is dropped and counted. Strings are truncated and scrubbed of anything that looks
 * like a credential, and of the literal values of configured secrets.
 */
const ALLOWED_KEYS = new Set([
  "from", "to", "reason", "reasons", "decision", "amountMinor", "totalMinor", "currency",
  "policyVersion", "previousVersion", "productId", "providerProductId", "paymentId", "approvalId",
  "riskScore", "evidenceCoverage", "riskLevel", "step", "attempt", "providerOrderId",
  "providerCaptureId", "status", "providerStatus", "debugId", "changes", "field", "before", "after",
  "loosens", "kind", "role", "roles", "error", "errorCode", "count", "candidates", "rank",
  "snapshotHash", "expiresAt", "durationMs", "title", "quantity", "budgetMinor", "category",
  "checks", "id", "label", "result", "detail", "source", "eventType", "webhookEventId",
  "agent", "eligible", "ranked", "recommendedProductId", "decisions", "parserSource",
  "outcome", "code", "simulated", "mode", "sellerName", "seller", "deadlineDays",
  "requiredAttributes", "productQuery", "objective", "maxAttempts", "requestId", "approver",
  "approvedBy", "fingerprint", "duplicate", "unitPriceMinor", "shippingMinor", "taxMinor",
  "itemTotalMinor", "explanation", "explanationSource", "provider", "demo", "rejected", "assessed",
  "providerProductIds", "problems", "displayName", "orderStatus", "captureStatus", "intent", "reconciled", "lagSeconds",
  "capped", "fallbackReason", "allowanceMinor", "amountBasis", "providerAuthorizationId", "authorizationStatus",
  "authorizationExpiresAt", "settledMinor", "releasedMinor", "refundId", "providerRefundId", "refundedMinor",
  "remainingMinor", "capMinor",
  // Recovery guidance: mission revisions, override requests, advisor and alternative search.
  "revisionId", "revisionNumber", "revisedFrom", "missionVersion", "evaluatedPolicyVersion", "currentPolicyVersion",
  "relaxesMandatory", "acknowledgedRelaxations", "refreshQuotes", "note", "checkId", "checkIds", "policyField",
  "policyFields", "affectedOffers", "currentBudgetMinor", "proposedBudgetMinor", "justification", "effect", "refused",
  "attemptedDecision", "reviewer", "nextAction", "validationProblems", "queries", "results", "viable",
]);

const MAX_STRING = 500;
const MAX_DEPTH = 6;
const MAX_ARRAY = 50;

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/]+=*/gi,
  /AIza[A-Za-z0-9\-_]+/g,
  /(access_token|client_secret|password|api[_-]?key)["'=:\s]+[^\s"',}]+/gi,
];

function secretValues(): string[] {
  return [process.env.PAYPAL_CLIENT_SECRET, process.env.GEMINI_API_KEY, process.env.SESSION_SECRET, process.env.CHANNEL3_API_KEY]
    .filter((v): v is string => typeof v === "string" && v.length >= 8);
}

export function scrubString(input: string): string {
  let s = input;
  for (const secret of secretValues()) s = s.split(secret).join("[REDACTED]");
  for (const p of SECRET_PATTERNS) s = s.replace(p, "[REDACTED]");
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
}

export type Redacted = null | boolean | number | string | Redacted[] | { [k: string]: Redacted };

function redactValue(value: unknown, depth: number): Redacted {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") return redactObject(value as Record<string, unknown>, depth + 1);
  return null;
}

function redactObject(obj: Record<string, unknown>, depth: number): { [k: string]: Redacted } {
  const out: { [k: string]: Redacted } = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (!ALLOWED_KEYS.has(k)) {
      dropped += 1;
      continue;
    }
    out[k] = redactValue(v, depth);
  }
  if (dropped > 0) out._redactedKeys = dropped;
  return out;
}

export function redact(metadata: Record<string, unknown> | undefined | null): { [k: string]: Redacted } {
  if (!metadata) return {};
  return redactObject(metadata, 0);
}
