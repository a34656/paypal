import { describe, expect, it } from "vitest";
import { optimize } from "@/domain/agents/optimizer";
import { assessRisk } from "@/domain/risk/engine";
import { DEFAULT_POLICY } from "@/domain/policy/schema";
import { DemoProductProvider } from "@/domain/providers/product-provider";
import { demoParseMission } from "@/domain/ai/demo-parser";
import { llmToProposal } from "@/domain/ai/provider";
import { allInTotal } from "@/lib/money";
import { DEMO_SCENARIOS } from "@/domain/providers/demo-catalog";

describe("demo mission parser", () => {
  it("parses the robotics-lab scenario", () => {
    const p = demoParseMission(DEMO_SCENARIOS[0].text);
    expect(p.constraints).toMatchObject({ quantity: 20, budgetMinor: 250_000, currency: "USD", deadlineDays: 14, category: "electronics", requiredAttributes: { model: "Raspberry Pi 5", ram: "8GB" } });
    expect(p.uncertain).toEqual([]);
  });
  it("flags missing fields instead of inventing them", () => {
    const p = demoParseMission("Get some chairs for the office");
    expect(p.uncertain).toEqual(expect.arrayContaining(["budgetMinor", "quantity"]));
  });
  it("handles k-suffix and other currencies", () => {
    expect(demoParseMission("Buy 4 GPU servers, budget €50k").constraints).toMatchObject({ currency: "EUR", budgetMinor: 5_000_000, quantity: 4 });
  });
});

describe("LLM output validation", () => {
  const ok = { title: "Boards", objective: "Buy boards", productQuery: "raspberry pi", category: "Electronics", quantity: 20, budget: "2500.00", currency: "usd", deadlineDays: 14, requiredAttributes: [{ key: "model", value: "Raspberry Pi 5" }] };
  it("converts decimal budgets exactly and validates strictly", () => {
    expect(llmToProposal(ok)?.constraints).toMatchObject({ budgetMinor: 250_000, currency: "USD", category: "electronics" });
  });
  it("rejects invalid output (falls back upstream)", () => {
    expect(llmToProposal({ ...ok, currency: "BTC" })).toBeNull();
    expect(llmToProposal({ ...ok, quantity: -5 })).toBeNull();
    expect(llmToProposal({ ...ok, quantity: 1e9 })).toBeNull();
  });
  it("never invents a budget", () => {
    expect(llmToProposal({ ...ok, budget: null })?.uncertain).toContain("budgetMinor");
    expect(llmToProposal({ ...ok, budget: "1.234" })?.uncertain).toContain("budgetMinor");
  });
});

describe("optimizer", () => {
  it("ranks only eligible candidates and recommends the documented offer", async () => {
    const mission = demoParseMission(DEMO_SCENARIOS[0].text).constraints;
    const products = await new DemoProductProvider().search({ query: mission.productQuery, category: mission.category, quantity: mission.quantity, currency: "USD" });
    const cands = products.map((p) => ({
      key: p.providerProductId,
      title: p.title,
      totalMinor: allInTotal({ unitPriceMinor: p.unitPriceMinor, quantity: mission.quantity, shippingMinor: p.shippingMinor, taxMinor: p.taxMinor })?.totalMinor ?? null,
      currency: p.currency,
      category: p.category,
      sellerVerified: p.sellerVerificationStatus === "VERIFIED",
      risk: assessRisk(p, mission),
    }));
    const res = optimize(cands, mission, DEFAULT_POLICY);
    const top = res.find((r) => r.rank === 1);
    expect(top?.key).toBe("demo-rpi-002");
    expect(res.find((r) => r.key === "demo-rpi-001")?.eligible).toBe(false); // unknown total
    expect(res.find((r) => r.key === "demo-rpi-003")?.eligible).toBe(false); // over budget
    expect(res.find((r) => r.key === "demo-rpi-004")?.eligible).toBe(false); // wrong model
    expect(res.find((r) => r.key === "demo-rpi-005")?.eligible).toBe(false); // injection fixture: tax unknown
    expect(optimize(cands, mission, DEFAULT_POLICY)).toEqual(res); // deterministic
  });
});

describe("optimizer with real-catalogue offers", () => {
  it("prefers a listing that states the requirement in its title over one that is silent, and exact totals over caps", async () => {
    const { optimize } = await import("@/domain/agents/optimizer");
    const { assessRisk } = await import("@/domain/risk/engine");
    const { DEFAULT_POLICY } = await import("@/domain/policy/schema");
    const m = { title: "Cables", objective: "Cables", productQuery: "usb-c cable 2m", category: "cables", quantity: 10, budgetMinor: 40_000, currency: "USD" as const, deadlineDays: null, requiredAttributes: { length: "2m" } };
    const base = { provider: "channel3", description: null, category: "cables", shippingMinor: null, taxMinor: null, currency: "USD", imageUrl: null, sellerId: "x.com", sellerName: "X", sellerVerificationStatus: "VERIFIED" as const, shippingEstimateDays: null, stockQuantity: null, inStock: true, attributes: {}, isDemoData: false, baselineUnitPriceMinor: null };
    const silent = { ...base, providerProductId: "a", title: "Boost Charge USB-C cable", unitPriceMinor: 1_499 };
    const stated = { ...base, providerProductId: "b", title: "Rode SC27 2m USB-C cable", unitPriceMinor: 1_600 };
    const cand = (p: typeof silent, key: string, basis: "CAP" | "EXACT" = "CAP") => ({ key, title: p.title, totalMinor: p.unitPriceMinor * 10 + 2_400, currency: "USD", category: "cables", sellerVerified: true, risk: assessRisk(p, m, { costBounded: true }), amountBasis: basis });
    const r = optimize([cand(silent, "silent"), cand(stated, "stated")], m, { ...DEFAULT_POLICY, minEvidenceCoverage: 0 });
    expect(r.find((x) => x.key === "stated")!.rank).toBe(1);
    const r2 = optimize([cand(stated, "cap"), cand(silent, "exact", "EXACT")], m, { ...DEFAULT_POLICY, minEvidenceCoverage: 0 });
    expect(r2.find((x) => x.key === "exact")!.rank).toBe(1);
    expect(r2.find((x) => x.key === "cap")!.explanation).toMatch(/spending cap/);
  });
});
