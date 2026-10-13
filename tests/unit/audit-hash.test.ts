import { describe, expect, it } from "vitest";
import { computeEventHash, GENESIS_HASH, type ChainFields } from "@/server/audit";

const ev = (seq: number): ChainFields => ({ seq, missionId: "m", ownerId: "u", actor: "system", eventType: "x", resource: "r", outcome: "SUCCESS", correlationId: "c", metadata: { a: 1 }, schemaVersion: 1, mode: "DEMO", createdAt: "2026-10-13T00:00:00.000Z" });

describe("audit hash chain (pure)", () => {
  it("links each event to its predecessor", () => {
    const h1 = computeEventHash(GENESIS_HASH, ev(1));
    const h2 = computeEventHash(h1, ev(2));
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(computeEventHash(h1, ev(2))).toBe(h2);
    expect(computeEventHash(GENESIS_HASH, ev(2))).not.toBe(h2);
    expect(computeEventHash(h1, { ...ev(2), outcome: "FAILURE" })).not.toBe(h2);
  });
});
