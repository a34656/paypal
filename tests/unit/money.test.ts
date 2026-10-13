import { describe, expect, it } from "vitest";
import { addMinor, allInTotal, exponentOf, formatMoney, fromProviderDecimal, MAX_MINOR, MoneyError, multiplyMinor, parseMajorInput, toProviderDecimal } from "@/lib/money";

describe("money (integer minor units)", () => {
  it("knows per-currency exponents including zero-decimal JPY", () => {
    expect(exponentOf("USD")).toBe(2);
    expect(exponentOf("JPY")).toBe(0);
    expect(() => exponentOf("XYZ")).toThrow(MoneyError);
  });

  it("converts to the PayPal decimal string exactly", () => {
    expect(toProviderDecimal(176_700, "USD")).toBe("1767.00");
    expect(toProviderDecimal(5, "USD")).toBe("0.05");
    expect(toProviderDecimal(0, "EUR")).toBe("0.00");
    expect(toProviderDecimal(1234, "JPY")).toBe("1234");
  });

  it("parses provider decimals strictly (no silent rounding)", () => {
    expect(fromProviderDecimal("1767.00", "USD")).toBe(176_700);
    expect(fromProviderDecimal("19.9", "USD")).toBe(1_990);
    expect(fromProviderDecimal("1234", "JPY")).toBe(1234);
    expect(() => fromProviderDecimal("1.234", "USD")).toThrow(MoneyError);
    expect(() => fromProviderDecimal("12.5", "JPY")).toThrow(MoneyError);
    expect(() => fromProviderDecimal("-1.00", "USD")).toThrow(MoneyError);
    expect(() => fromProviderDecimal("1e3", "USD")).toThrow(MoneyError);
  });

  it("round-trips without float error", () => {
    for (const v of [1, 10, 99, 100, 1_999, 123_456_789]) expect(fromProviderDecimal(toProviderDecimal(v, "USD"), "USD")).toBe(v);
    // 0.1 + 0.2 style traps cannot occur
    expect(addMinor(10, 20)).toBe(30);
  });

  it("parses human budget input", () => {
    expect(parseMajorInput("$2,500", "USD")).toBe(250_000);
    expect(parseMajorInput("2500.50", "USD")).toBe(250_050);
    expect(parseMajorInput("¥3,000", "JPY")).toBe(3_000);
  });

  it("computes the all-in total and treats unknown shipping/tax as missing, not zero", () => {
    expect(allInTotal({ unitPriceMinor: 8_000, quantity: 20, shippingMinor: 3_500, taxMinor: 13_200 })).toEqual({ itemTotalMinor: 160_000, shippingMinor: 3_500, taxMinor: 13_200, totalMinor: 176_700 });
    expect(allInTotal({ unitPriceMinor: 8_000, quantity: 20, shippingMinor: null, taxMinor: 0 })).toBeNull();
    expect(allInTotal({ unitPriceMinor: 8_000, quantity: 20, shippingMinor: 0, taxMinor: undefined })).toBeNull();
  });

  it("guards overflow, non-positive and absurd quantities, NaN", () => {
    expect(() => multiplyMinor(MAX_MINOR, 2)).toThrow(MoneyError);
    expect(() => multiplyMinor(100, 0)).toThrow(MoneyError);
    expect(() => multiplyMinor(100, -1)).toThrow(MoneyError);
    expect(() => multiplyMinor(100, 1.5)).toThrow(MoneyError);
    expect(() => multiplyMinor(100, 1_000_000)).toThrow(MoneyError);
    expect(() => multiplyMinor(Number.NaN, 1)).toThrow(MoneyError);
    expect(() => addMinor(MAX_MINOR, 1)).toThrow(MoneyError);
    expect(() => addMinor(1.5)).toThrow(MoneyError);
  });

  it("formats for display only", () => {
    expect(formatMoney(176_700, "USD")).toBe("$1,767.00");
    expect(formatMoney(3000, "JPY")).toBe("¥3,000");
    expect(formatMoney(null, "USD")).toBe("—");
  });
});
