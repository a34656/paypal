import { describe, expect, it } from "vitest";
import { checkApproval, snapshotHash, type ApprovalSnapshot } from "@/domain/approval/snapshot";
import { canonicalize } from "@/lib/canonical";

const snap: ApprovalSnapshot = {
  missionId: "m1",
  productId: "p1",
  providerProductId: "demo-rpi-002",
  sellerId: "s1",
  quantity: 20,
  unitPriceMinor: 8_000,
  shippingMinor: 3_500,
  taxMinor: 13_200,
  totalMinor: 176_700,
  amountBasis: "EXACT",
  allowanceMinor: 0,
  currency: "USD",
  policyVersion: 1,
  expiresAt: "2026-10-13T12:30:00.000Z",
};
const approval = { status: "ACTIVE", expiresAt: new Date(snap.expiresAt), snapshotHash: snapshotHash(snap), approvedAmountMinor: 176_700, currency: "USD" };
const before = new Date("2026-10-13T12:00:00.000Z");

describe("canonical serialisation", () => {
  it("is key-order independent and rejects lossy values", () => {
    expect(canonicalize({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalize({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: new Date() })).toThrow();
  });
});

describe("approval snapshot", () => {
  it("valid approval passes", () => {
    expect(checkApproval(approval, snap, before)).toEqual({ ok: true });
  });

  it("every bound field changes the hash", () => {
    const changes: Partial<ApprovalSnapshot>[] = [
      { productId: "p2" }, { providerProductId: "x" }, { sellerId: "s2" }, { quantity: 21 }, { unitPriceMinor: 8_001 },
      { shippingMinor: 0 }, { taxMinor: 0 }, { totalMinor: 176_701 }, { currency: "EUR" }, { policyVersion: 2 },
      { expiresAt: "2026-10-13T12:31:00.000Z" }, { missionId: "m2" }, { sellerId: null },
    ];
    for (const c of changes) expect(snapshotHash({ ...snap, ...c })).not.toBe(snapshotHash(snap));
  });

  it("extra properties cannot influence the hash", () => {
    expect(snapshotHash({ ...snap, injected: "x" } as ApprovalSnapshot)).toBe(snapshotHash(snap));
  });

  it("rejects expired, inactive, amount mismatch and hash mismatch", () => {
    expect(checkApproval(approval, snap, new Date(snap.expiresAt))).toMatchObject({ ok: false, code: "EXPIRED" });
    expect(checkApproval({ ...approval, status: "CONSUMED" }, snap, before)).toMatchObject({ ok: false, code: "NOT_ACTIVE" });
    expect(checkApproval(approval, { ...snap, totalMinor: 176_800 }, before)).toMatchObject({ ok: false, code: "AMOUNT_MISMATCH" });
    expect(checkApproval(approval, { ...snap, taxMinor: 13_100, shippingMinor: 3_600 }, before)).toMatchObject({ ok: false, code: "HASH_MISMATCH" });
    expect(checkApproval(approval, { ...snap, policyVersion: 2 }, before)).toMatchObject({ ok: false, code: "HASH_MISMATCH" });
  });
});
