import "server-only";
/**
 * Append-only, hash-chained audit log.
 *   hash = SHA256(prevHash ‖ canonical(event))
 * appendAudit MUST be called inside the same transaction as the state change it records
 * (audit-or-abort): if the audit insert fails, the transaction — and the action — fails.
 * A transaction-scoped advisory lock serialises appends so the chain never forks.
 */
import { randomUUID } from "node:crypto";
import { canonicalize, sha256Hex } from "@/lib/canonical";
import { redact, type Redacted } from "@/lib/redact";
import type { Db, Tx } from "./db";

export const AUDIT_SCHEMA_VERSION = 1;
export const GENESIS_HASH = "0".repeat(64);
const AUDIT_LOCK_KEY = 0x0ae615; // arbitrary constant for pg_advisory_xact_lock

export interface AuditInput {
  missionId?: string | null;
  ownerId?: string | null;
  /** "user:<id>", "agent:<name>", "system", "provider:paypal", "webhook:paypal". */
  actor: string;
  eventType: string;
  resource: string;
  outcome: "SUCCESS" | "FAILURE" | "DENIED" | "BLOCKED" | "INFO";
  correlationId?: string;
  metadata?: Record<string, unknown>;
  mode: "DEMO" | "SANDBOX" | "LIVE";
}

export interface ChainFields {
  seq: number;
  missionId: string | null;
  ownerId: string | null;
  actor: string;
  eventType: string;
  resource: string;
  outcome: string;
  correlationId: string;
  metadata: Redacted;
  schemaVersion: number;
  mode: string;
  createdAt: string;
}

export function computeEventHash(prevHash: string, fields: ChainFields): string {
  return sha256Hex(prevHash + canonicalize(fields));
}

export async function appendAudit(tx: Tx, input: AuditInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  const fields: ChainFields = {
    seq: (last?.seq ?? 0) + 1,
    missionId: input.missionId ?? null,
    ownerId: input.ownerId ?? null,
    actor: input.actor,
    eventType: input.eventType,
    resource: input.resource,
    outcome: input.outcome,
    correlationId: input.correlationId ?? randomUUID(),
    metadata: redact(input.metadata),
    schemaVersion: AUDIT_SCHEMA_VERSION,
    mode: input.mode,
    createdAt: new Date().toISOString(),
  };
  const prevHash = last?.hash ?? GENESIS_HASH;
  const hash = computeEventHash(prevHash, fields);
  return tx.auditEvent.create({
    data: {
      ...fields,
      metadata: fields.metadata as object,
      mode: input.mode,
      createdAt: new Date(fields.createdAt),
      prevHash,
      hash,
    },
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  reason: string | null;
  headHash: string | null;
}

export async function verifyAuditChain(db: Db | Tx): Promise<ChainVerification> {
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;
  let cursor = 0;
  const batch = 500;
  for (;;) {
    const rows = await db.auditEvent.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: "asc" }, take: batch });
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.seq !== expectedSeq) return { ok: false, checked, brokenAtSeq: r.seq, reason: `Sequence gap: expected ${expectedSeq}`, headHash: prevHash };
      if (r.prevHash !== prevHash) return { ok: false, checked, brokenAtSeq: r.seq, reason: "prevHash does not link to previous event", headHash: prevHash };
      const fields: ChainFields = {
        seq: r.seq,
        missionId: r.missionId,
        ownerId: r.ownerId,
        actor: r.actor,
        eventType: r.eventType,
        resource: r.resource,
        outcome: r.outcome,
        correlationId: r.correlationId,
        metadata: r.metadata as Redacted,
        schemaVersion: r.schemaVersion,
        mode: r.mode,
        createdAt: r.createdAt.toISOString(),
      };
      if (computeEventHash(prevHash, fields) !== r.hash) {
        return { ok: false, checked, brokenAtSeq: r.seq, reason: "Event content does not match its hash", headHash: prevHash };
      }
      prevHash = r.hash;
      expectedSeq += 1;
      checked += 1;
      cursor = r.seq;
    }
  }
  return { ok: true, checked, brokenAtSeq: null, reason: null, headHash: checked ? prevHash : null };
}
