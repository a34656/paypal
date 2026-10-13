/**
 * Narrow interface the Scout agent receives. Implementations: DemoProductProvider
 * (deterministic, always labelled demo). A Channel3 adapter is NOT implemented: no verified
 * API access was available, and AEGIS never fabricates or scrapes provider results.
 */
import type { ProductCandidate } from "@/domain/types";
import { DEMO_PRODUCTS, DEMO_PROVIDER } from "./demo-catalog";

export interface ProductQuery {
  query: string;
  category: string;
  quantity: number;
  currency: string;
}

export interface ProductSearch {
  readonly name: string;
  readonly isDemo: boolean;
  search(q: ProductQuery): Promise<ProductCandidate[]>;
}

const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length >= 2);

export class DemoProductProvider implements ProductSearch {
  readonly name = DEMO_PROVIDER;
  readonly isDemo = true;

  async search(q: ProductQuery): Promise<ProductCandidate[]> {
    const qt = new Set(tokens(`${q.query} ${q.category}`));
    const scored = DEMO_PRODUCTS.map((p) => ({ p, hits: p.keywords.filter((k) => qt.has(k)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.p.providerProductId.localeCompare(b.p.providerProductId));
    return scored.slice(0, 8).map(({ p }) => {
      const { keywords: _keywords, ...rest } = p;
      void _keywords;
      return { ...rest, attributes: { ...rest.attributes }, provider: DEMO_PROVIDER, isDemoData: true };
    });
  }
}

/** Validates and normalises provider output before it reaches any other agent. */
export function normalizeCandidate(c: ProductCandidate): ProductCandidate | null {
  const intOk = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);
  if (!Number.isSafeInteger(c.unitPriceMinor) || c.unitPriceMinor <= 0) return null;
  if (!intOk(c.shippingMinor) || !intOk(c.taxMinor) || !intOk(c.stockQuantity) || !intOk(c.shippingEstimateDays)) return null;
  if (!/^[A-Z]{3}$/.test(c.currency)) return null;
  const clip = (s: string | null, n: number) => (s == null ? null : s.slice(0, n));
  return {
    ...c,
    title: c.title.slice(0, 200),
    description: clip(c.description, 1000),
    sellerName: clip(c.sellerName, 120),
    category: c.category.slice(0, 60),
    // Only local demo images are rendered; any other URL is dropped (no remote fetch, no SSRF).
    imageUrl: c.imageUrl && c.imageUrl.startsWith("/demo-products/") ? c.imageUrl : null,
    attributes: Object.fromEntries(Object.entries(c.attributes).slice(0, 20).map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 80)])),
  };
}

export function getProductProvider(): ProductSearch {
  return new DemoProductProvider();
}
