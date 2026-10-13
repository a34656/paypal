/**
 * Approval snapshot. An approval binds to exactly this object; at capture the server
 * recomputes it from stored data and compares hashes. Any change to product, price,
 * quantity, shipping, tax, currency, policy version or expiry invalidates the approval.
 */
import { hashCanonical } from "@/lib/canonical";

export interface ApprovalSnapshot {
  missionId: string;
  productId: string;
  providerProductId: string;
  sellerId: string | null;
  quantity: number;
  unitPriceMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
  policyVersion: number;
  /** ISO-8601 UTC timestamp. */
  expiresAt: string;
}

export function snapshotHash(s: ApprovalSnapshot): string {
  // Explicit field list: extra properties on the input can never leak into the hash.
  return hashCanonical({
    missionId: s.missionId,
    productId: s.productId,
    providerProductId: s.providerProductId,
    sellerId: s.sellerId,
    quantity: s.quantity,
    unitPriceMinor: s.unitPriceMinor,
    shippingMinor: s.shippingMinor,
    taxMinor: s.taxMinor,
    totalMinor: s.totalMinor,
    currency: s.currency,
    policyVersion: s.policyVersion,
    expiresAt: s.expiresAt,
  });
}

export type ApprovalCheck =
  | { ok: true }
  | { ok: false; code: "NOT_ACTIVE" | "EXPIRED" | "HASH_MISMATCH" | "AMOUNT_MISMATCH"; reason: string };

/** Pure validation of a stored approval against a freshly recomputed snapshot. */
export function checkApproval(
  approval: { status: string; expiresAt: Date; snapshotHash: string; approvedAmountMinor: number; currency: string },
  fresh: ApprovalSnapshot,
  now: Date,
): ApprovalCheck {
  if (approval.status !== "ACTIVE") return { ok: false, code: "NOT_ACTIVE", reason: `Approval is ${approval.status}.` };
  if (approval.expiresAt.getTime() <= now.getTime()) return { ok: false, code: "EXPIRED", reason: "Approval has expired." };
  if (approval.approvedAmountMinor !== fresh.totalMinor || approval.currency !== fresh.currency) {
    return { ok: false, code: "AMOUNT_MISMATCH", reason: "Approved amount no longer matches the purchase." };
  }
  if (approval.snapshotHash !== snapshotHash(fresh)) {
    return { ok: false, code: "HASH_MISMATCH", reason: "Purchase details changed since approval (snapshot hash mismatch)." };
  }
  return { ok: true };
}
