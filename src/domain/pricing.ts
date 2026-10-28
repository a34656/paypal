/**
 * Purchase amounts — the single place that turns product data into an authorisable amount.
 * Pure and integer-only; shared by the orchestrator, the approval gate and recovery guidance.
 */
import { allInTotal, MAX_QUANTITY, spendCap } from "@/lib/money";

export interface PricedProduct {
  unitPriceMinor: number;
  shippingMinor: number | null;
  taxMinor: number | null;
}

export interface PurchaseAmounts {
  basis: "EXACT" | "CAP";
  itemTotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  /** 0 for EXACT. */
  allowanceMinor: number;
  /** Exact all-in total, or the spending cap. */
  totalMinor: number;
}

/**
 * EXACT when shipping and tax are disclosed; otherwise a policy spending CAP (item total +
 * allowance %), or null when the policy disables caps. Throws only on overflow.
 */
export function purchaseAmounts(product: PricedProduct, quantity: number, allowancePct: number): PurchaseAmounts | null {
  const exact = allInTotal({ unitPriceMinor: product.unitPriceMinor, quantity, shippingMinor: product.shippingMinor, taxMinor: product.taxMinor });
  if (exact) return { basis: "EXACT", ...exact, allowanceMinor: 0 };
  const cap = spendCap({ unitPriceMinor: product.unitPriceMinor, quantity, allowancePct });
  if (!cap) return null;
  return { basis: "CAP", itemTotalMinor: cap.itemTotalMinor, shippingMinor: 0, taxMinor: 0, allowanceMinor: cap.allowanceMinor, totalMinor: cap.totalMinor };
}

/** purchaseAmounts that maps overflow to null (unknown → fails closed downstream). */
export function safePurchaseAmounts(product: PricedProduct, quantity: number, allowancePct: number): PurchaseAmounts | null {
  try {
    return purchaseAmounts(product, quantity, allowancePct);
  } catch {
    return null;
  }
}

/**
 * Largest quantity in [1, maxQuantity] whose authorisable amount (as purchaseAmounts computes it)
 * fits the budget, or null when not even one unit fits or the amount cannot be stated.
 * purchaseAmounts is monotonic in quantity, so a binary search is exact.
 */
export function maxFeasibleQuantity(product: PricedProduct, budgetMinor: number, allowancePct: number, maxQuantity: number): { quantity: number; amounts: PurchaseAmounts } | null {
  const upper = Math.min(Math.max(0, Math.floor(maxQuantity)), MAX_QUANTITY);
  if (upper < 1) return null;
  const fits = (q: number) => {
    const a = safePurchaseAmounts(product, q, allowancePct);
    return a !== null && a.totalMinor <= budgetMinor ? a : null;
  };
  if (!fits(1)) return null;
  let lo = 1;
  let hi = upper;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return { quantity: lo, amounts: fits(lo) as PurchaseAmounts };
}
