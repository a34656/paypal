/**
 * Narrow interface the Scout agent receives. Implementations:
 *  - Channel3ProductProvider: real cross-retailer catalogue (src/domain/providers/channel3.ts)
 *  - DemoProductProvider: deterministic fictional catalogue, always labelled demo
 *  - FallbackProductProvider: real provider first; on provider failure, demo data — the
 *    result carries the failure reason and every demo row stays labelled DEMO DATA.
 * AEGIS never scrapes retailer sites or fabricates provider results.
 */
import type { ProductCandidate } from "@/domain/types";
import { getEnv } from "@/lib/env";
import { Channel3ProductProvider, CHANNEL3_IMAGE_PREFIX } from "./channel3";
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
  /** Set by FallbackProductProvider after a search that fell back to demo data. */
  readonly lastFallbackReason?: string | null;
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
    // Only local demo images and Channel3 CDN images are kept; nothing is fetched server-side.
    imageUrl: c.imageUrl && (c.imageUrl.startsWith("/demo-products/") || c.imageUrl.startsWith(CHANNEL3_IMAGE_PREFIX)) ? c.imageUrl.slice(0, 300) : null,
    offerUrl: c.offerUrl && /^https:\/\/[^\s"'<>]+$/.test(c.offerUrl) ? c.offerUrl.slice(0, 500) : null,
    attributes: Object.fromEntries(Object.entries(c.attributes).slice(0, 20).map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 80)])),
  };
}

export class FallbackProductProvider implements ProductSearch {
  lastFallbackReason: string | null = null;
  private usedFallback = false;
  constructor(
    private readonly primary: ProductSearch,
    private readonly fallback: ProductSearch = new DemoProductProvider(),
  ) {}

  get name() {
    return this.usedFallback ? this.fallback.name : this.primary.name;
  }

  get isDemo() {
    return this.usedFallback ? this.fallback.isDemo : this.primary.isDemo;
  }

  async search(q: ProductQuery): Promise<ProductCandidate[]> {
    this.usedFallback = false;
    this.lastFallbackReason = null;
    try {
      return await this.primary.search(q);
    } catch (err) {
      this.usedFallback = true;
      this.lastFallbackReason = `${this.primary.name} unavailable (${err instanceof Error ? err.message.slice(0, 160) : "unknown error"}); showing labelled demo data.`;
      console.warn(`[aegis] product search fell back to demo data: ${this.lastFallbackReason}`);
      return this.fallback.search(q);
    }
  }
}

export function getProductProvider(): ProductSearch {
  const env = getEnv();
  if (env.productProvider === "demo") return new DemoProductProvider();
  return new FallbackProductProvider(new Channel3ProductProvider({ apiKey: env.channel3.apiKey }));
}
