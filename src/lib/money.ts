/**
 * Money model. Every authoritative amount is an integer count of minor units
 * (cents for USD, yen for JPY). Floats never touch authoritative values; the decimal
 * string format is produced only at the PayPal boundary.
 */

/** Minor-unit exponents for currencies AEGIS accepts. PayPal-supported subset only. */
export const CURRENCY_EXPONENTS = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  JPY: 0,
} as const;

export type Currency = keyof typeof CURRENCY_EXPONENTS;

/** Hard ceiling on any single amount: 1,000,000,000 minor units (10M USD). Guards overflow. */
export const MAX_MINOR = 1_000_000_000;
/** Absurd-quantity guard. A single mission never buys more than this many units. */
export const MAX_QUANTITY = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function isSupportedCurrency(code: unknown): code is Currency {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENTS, code);
}

export function exponentOf(currency: string): number {
  if (!isSupportedCurrency(currency)) throw new MoneyError(`Unsupported currency: ${currency}`);
  return CURRENCY_EXPONENTS[currency];
}

export function assertMinor(value: unknown, label = "amount"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units`);
  }
  if (value < 0) throw new MoneyError(`${label} must not be negative`);
  if (value > MAX_MINOR) throw new MoneyError(`${label} exceeds the maximum supported amount`);
}

export function assertQuantity(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new MoneyError("quantity must be a positive integer");
  }
  if (value > MAX_QUANTITY) throw new MoneyError(`quantity exceeds the maximum of ${MAX_QUANTITY}`);
}

/** Checked addition of minor-unit amounts. */
export function addMinor(...values: number[]): number {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
    if (total > MAX_MINOR) throw new MoneyError("total exceeds the maximum supported amount");
  }
  return total;
}

/** Checked multiplication of a unit price by a quantity. */
export function multiplyMinor(unitMinor: number, quantity: number): number {
  assertMinor(unitMinor, "unit price");
  assertQuantity(quantity);
  const product = unitMinor * quantity;
  if (!Number.isSafeInteger(product) || product > MAX_MINOR) {
    throw new MoneyError("line total exceeds the maximum supported amount");
  }
  return product;
}

export interface AllInBreakdown {
  itemTotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * All-in total = unitPrice × qty + shipping + tax.
 * Returns null when shipping or tax is unknown: unknown is missing evidence, never zero.
 */
export function allInTotal(input: {
  unitPriceMinor: number;
  quantity: number;
  shippingMinor: number | null | undefined;
  taxMinor: number | null | undefined;
}): AllInBreakdown | null {
  const itemTotalMinor = multiplyMinor(input.unitPriceMinor, input.quantity);
  if (input.shippingMinor == null || input.taxMinor == null) return null;
  const totalMinor = addMinor(itemTotalMinor, input.shippingMinor, input.taxMinor);
  return { itemTotalMinor, shippingMinor: input.shippingMinor, taxMinor: input.taxMinor, totalMinor };
}

export interface SpendCap {
  itemTotalMinor: number;
  /** Upper-bound allowance for undisclosed shipping + tax, rounded UP to a whole minor unit. */
  allowanceMinor: number;
  /** itemTotal + allowance: the most a PayPal authorization hold will let anyone capture. */
  totalMinor: number;
  allowancePct: number;
}

/**
 * Spending cap for a purchase whose shipping/tax are not disclosed. Integer-only.
 * Returns null when the policy disables caps (pct = 0).
 */
export function spendCap(input: { unitPriceMinor: number; quantity: number; allowancePct: number }): SpendCap | null {
  if (!Number.isSafeInteger(input.allowancePct) || input.allowancePct <= 0 || input.allowancePct > 100) return null;
  const itemTotalMinor = multiplyMinor(input.unitPriceMinor, input.quantity);
  const allowanceMinor = Math.ceil((itemTotalMinor * input.allowancePct) / 100);
  const totalMinor = addMinor(itemTotalMinor, allowanceMinor);
  return { itemTotalMinor, allowanceMinor, totalMinor, allowancePct: input.allowancePct };
}

/** Minor units → PayPal decimal string ("1234.50", JPY "1234"). Exact, integer-only. */
export function toProviderDecimal(minor: number, currency: string): string {
  assertMinor(minor);
  const exp = exponentOf(currency);
  if (exp === 0) return String(minor);
  const base = 10 ** exp;
  const whole = Math.floor(minor / base);
  const frac = String(minor % base).padStart(exp, "0");
  return `${whole}.${frac}`;
}

/**
 * PayPal decimal string → minor units. Strict: rejects more fractional digits than the
 * currency allows instead of rounding, so a provider amount can be compared exactly.
 */
export function fromProviderDecimal(value: string, currency: string): number {
  const exp = exponentOf(currency);
  const pattern = exp === 0 ? /^\d+$/ : new RegExp(`^(\\d+)(?:\\.(\\d{1,${exp}}))?$`);
  const m = pattern.exec(value);
  if (!m) throw new MoneyError(`Invalid ${currency} amount: ${value}`);
  if (exp === 0) {
    const n = Number(value);
    assertMinor(n);
    return n;
  }
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(exp, "0"));
  const minor = whole * 10 ** exp + frac;
  assertMinor(minor);
  return minor;
}

/**
 * Parse a human major-unit input ("2500", "2,500.00", "19.99") into minor units.
 * Explicit rounding rule: more decimals than the currency allows is rejected, not rounded.
 */
export function parseMajorInput(value: string, currency: string): number {
  const cleaned = value.replace(/[,\s]/g, "").replace(/^[$€£¥]/, "");
  return fromProviderDecimal(cleaned, currency);
}

/** Display formatting (presentation only). */
export function formatMoney(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null || !currency) return "—";
  const exp = isSupportedCurrency(currency) ? CURRENCY_EXPONENTS[currency] : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(minor / 10 ** exp);
  } catch {
    return `${toProviderDecimal(minor, "USD")} ${currency}`;
  }
}
