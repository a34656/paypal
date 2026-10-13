import "server-only";
/**
 * Compare-and-set state updates. `UPDATE … WHERE id = ? AND status = ? AND version = ?`.
 * Zero rows updated = someone else won the race → ConflictError. No row locks are used.
 */
import type { ApprovalStatus, PaymentStatus, WorkflowStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { assertPaymentTransition, assertWorkflowTransition } from "@/domain/state/machines";
import { conflict } from "./errors";
import type { Tx } from "./db";

export async function casMission(
  tx: Tx,
  args: { id: string; from: WorkflowStatus; to: WorkflowStatus; version: number; data?: Prisma.MissionUncheckedUpdateManyInput },
) {
  assertWorkflowTransition(args.from, args.to);
  const res = await tx.mission.updateMany({
    where: { id: args.id, status: args.from, version: args.version },
    data: { ...args.data, status: args.to, version: { increment: 1 } },
  });
  if (res.count !== 1) throw conflict(`Mission state changed concurrently (expected ${args.from})`);
  return { version: args.version + 1 };
}

export async function casPayment(
  tx: Tx,
  args: { id: string; from: PaymentStatus; to: PaymentStatus; version: number; data?: Prisma.PaymentUncheckedUpdateManyInput },
) {
  assertPaymentTransition(args.from, args.to);
  const res = await tx.payment.updateMany({
    where: { id: args.id, status: args.from, version: args.version },
    data: { ...args.data, status: args.to, version: { increment: 1 } },
  });
  if (res.count !== 1) throw conflict(`Payment state changed concurrently (expected ${args.from})`);
  return { version: args.version + 1 };
}

const APPROVAL_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  ACTIVE: ["CONSUMED", "EXPIRED", "REVOKED", "INVALIDATED"],
  CONSUMED: [],
  EXPIRED: [],
  REVOKED: [],
  INVALIDATED: [],
};

export async function casApproval(
  tx: Tx,
  args: { id: string; from: ApprovalStatus; to: ApprovalStatus; version: number; reason?: string },
) {
  if (!APPROVAL_TRANSITIONS[args.from].includes(args.to)) throw conflict(`Illegal approval transition ${args.from} → ${args.to}`);
  const res = await tx.approval.updateMany({
    where: { id: args.id, status: args.from, version: args.version },
    data: { status: args.to, statusReason: args.reason, version: { increment: 1 } },
  });
  if (res.count !== 1) throw conflict(`Approval state changed concurrently (expected ${args.from})`);
  return { version: args.version + 1 };
}
