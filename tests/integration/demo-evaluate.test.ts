import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as evaluateRoute from "@/app/api/demo/evaluate/route";
import { call, newSession } from "../helpers/api";

const counts = async () => ({
  missions: await prisma.mission.count(),
  approvals: await prisma.approval.count(),
  payments: await prisma.payment.count(),
  audit: await prisma.auditEvent.count({ where: { NOT: { eventType: { startsWith: "identity." } } } }),
});

describe("GET /api/demo/evaluate", () => {
  it("runs the real engines on the fictional scenario and persists nothing financial", async () => {
    const session = await newSession();
    const before = await counts();
    const res = await call(evaluateRoute.GET, { path: "/api/demo/evaluate", session });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ fictional: true, persisted: false, decision: "REQUIRE_APPROVAL", recommendedKey: "ridgeline-halcyon" });

    const byKey = Object.fromEntries((res.data.offers as { key: string; policy: { decision: string }; risk: { injectionSignals: string[] } }[]).map((o) => [o.key, o]));
    expect(byKey["summit-halcyon-pro"]!.policy.decision).toBe("BLOCK");
    expect(byKey["brightbuy-halcyon"]!.policy.decision).toBe("BLOCK");
    expect(byKey["brightbuy-halcyon"]!.risk.injectionSignals.length).toBeGreaterThan(0);

    expect(await counts()).toEqual(before);
  });

  it("rejects requests without a session", async () => {
    const res = await call(evaluateRoute.GET, { path: "/api/demo/evaluate", session: null });
    expect(res.status).toBe(401);
  });

  it("only exposes GET", () => {
    expect(Object.keys(evaluateRoute).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
});
