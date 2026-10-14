/**
 * Channel3 product provider — real, cross-retailer catalogue data via Channel3's Universal
 * Commerce Protocol (UCP) catalog service (MCP over Streamable HTTP, JSON responses).
 *
 *   https://ucp.trychannel3.com/mcp   tools: search_catalog, lookup_catalog, get_product
 *
 * The anonymous tier needs no key; CHANNEL3_API_KEY (if set) is sent as x-api-key for higher
 * rate limits. Every field below comes from the provider response. Nothing is invented:
 *  - shipping / tax are NOT disclosed by the catalogue → null (policy decides how to bound them)
 *  - stock quantity is not disclosed; only availability is → inStock
 *  - reference price = the retailer's own list price, else the median price of the same
 *    canonical product across other retailers, else null
 *  - category is the mission's search scope, except titles that match a restricted class
 *    (gift cards, weapons, crypto) are re-labelled so blocked-category policy still applies.
 * Provider text is treated as untrusted data: it is clipped by normalizeCandidate and only
 * structured fields are ever scored.
 */
import type { ProductCandidate } from "@/domain/types";
import type { ProductQuery, ProductSearch } from "./product-provider";

export const CHANNEL3_PROVIDER = "channel3";
export const CHANNEL3_UCP_ENDPOINT = "https://ucp.trychannel3.com/mcp";
/** Only images on Channel3's CDN are kept (rendered by the browser, never fetched server-side). */
export const CHANNEL3_IMAGE_PREFIX = "https://cdn.trychannel3.com/";

export interface Channel3Config {
  apiKey?: string | null;
  endpoint?: string;
  timeoutMs?: number;
  /** Max candidates returned to the Scout. */
  limit?: number;
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** Title patterns for restricted classes. Matching re-labels the category (fail closed). */
const RESTRICTED_CLASSES: Array<{ category: string; pattern: RegExp }> = [
  { category: "gift-cards", pattern: /\b(gift\s*cards?|e-?gift|gift\s*certificates?|prepaid\s+(visa|mastercard|card))\b/i },
  { category: "crypto", pattern: /\b(bitcoin|crypto(currency)?|ethereum|usdt|nft)\b/i },
  { category: "weapons", pattern: /\b(firearms?|handguns?|rifles?|shotguns?|ammunition|ammo)\b/i },
];

export function restrictedCategory(title: string): string | null {
  return RESTRICTED_CLASSES.find((c) => c.pattern.test(title))?.category ?? null;
}

/** "Memory: 8GB LPDDR4X" → ["memory", "8GB LPDDR4X"]. Free-form feature text without a key is skipped. */
function parseFeature(f: unknown): [string, string] | null {
  const s = str(f);
  if (!s) return null;
  const i = s.indexOf(":");
  if (i <= 0 || i > 40) return null;
  const key = s.slice(0, i).trim().toLowerCase();
  const value = s.slice(i + 1).trim();
  return key && value ? [key, value] : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const isNew = (v: Json) => {
  const cond = arr(v.condition).map((c) => String(c).toLowerCase());
  return cond.length === 0 || cond.includes("new");
};

/** Maps one UCP search_catalog product into 0..n candidates (one per retailer offer). Pure. */
export function mapUcpProduct(raw: unknown, q: ProductQuery): ProductCandidate[] {
  const p = obj(raw);
  const productId = str(p.id)?.replace(/^canonical_product_id:/, "");
  const title = str(p.title);
  if (!productId || !title) return [];
  const features = arr(obj(p.metadata).top_features);
  const attributes: Record<string, string> = {};
  const unkeyed: string[] = [];
  for (const f of features) {
    const kv = parseFeature(f);
    if (kv && !(kv[0] in attributes)) attributes[kv[0]] = kv[1];
    else if (!kv && str(f)) unkeyed.push(str(f) as string);
  }
  // Feature bullets without a "Key: value" shape are free text: kept with the description.
  const plain = str(obj(p.description).plain);
  const description = [unkeyed.length ? `Features: ${unkeyed.join(" · ")}.` : null, plain].filter(Boolean).join(" ") || null;
  const productImage = str(obj(arr(p.media)[0]).url);

  const offers = arr(p.variants)
    .map(obj)
    .filter((v) => obj(v.availability).available === true && isNew(v))
    .map((v) => {
      const price = obj(v.price);
      const seller = obj(v.seller);
      return {
        variantId: str(v.id),
        priceMinor: int(price.amount),
        listMinor: int(obj(v.list_price).amount),
        currency: str(price.currency),
        domain: str(seller.domain)?.toLowerCase() ?? null,
        sellerName: str(seller.name),
        url: str(v.url),
        image: str(obj(arr(v.media)[0]).url) ?? productImage,
      };
    })
    .filter((o) => o.variantId && o.priceMinor && o.priceMinor > 0 && o.currency === q.currency && o.domain);

  // One offer per retailer (the cheapest), so the same seller cannot crowd the comparison.
  const bySeller = new Map<string, (typeof offers)[number]>();
  for (const o of offers) {
    const cur = bySeller.get(o.domain as string);
    if (!cur || (o.priceMinor as number) < (cur.priceMinor as number)) bySeller.set(o.domain as string, o);
  }
  const perSeller = [...bySeller.values()];
  const category = restrictedCategory(title) ?? q.category;

  return perSeller.map((o) => {
    const others = perSeller.filter((x) => x !== o).map((x) => x.priceMinor as number);
    const baseline = o.listMinor && o.listMinor > 0 ? o.listMinor : others.length > 0 ? median(others) : null;
    return {
      provider: CHANNEL3_PROVIDER,
      providerProductId: `${productId}:${o.domain}`,
      title,
      description,
      category,
      unitPriceMinor: o.priceMinor as number,
      shippingMinor: null,
      taxMinor: null,
      currency: o.currency as string,
      imageUrl: o.image && o.image.startsWith(CHANNEL3_IMAGE_PREFIX) ? o.image : null,
      sellerId: o.domain,
      sellerName: o.sellerName ?? o.domain,
      // Channel3 does not verify sellers. The owner's policy may trust specific retailer domains.
      sellerVerificationStatus: "UNKNOWN",
      shippingEstimateDays: null,
      stockQuantity: null,
      inStock: true,
      attributes,
      isDemoData: false,
      baselineUnitPriceMinor: baseline,
      baselineSource: o.listMinor ? "retailer-list-price" : baseline != null ? "cross-retailer-median" : null,
      offerUrl: o.url && o.url.startsWith("https://") ? o.url : null,
    } satisfies ProductCandidate;
  });
}

export class Channel3ProviderError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = "Channel3ProviderError";
  }
}

export class Channel3ProductProvider implements ProductSearch {
  readonly name = CHANNEL3_PROVIDER;
  readonly isDemo = false;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly limit: number;
  private readonly fetchImpl: typeof fetch;
  private rpcId = 0;

  constructor(private readonly cfg: Channel3Config = {}) {
    this.endpoint = cfg.endpoint ?? CHANNEL3_UCP_ENDPOINT;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
    this.limit = cfg.limit ?? 12;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async rpc(method: string, params: Json, session: string | null, notify = false): Promise<{ body: Json; session: string | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(this.cfg.apiKey ? { "x-api-key": this.cfg.apiKey } : {}),
          ...(session ? { "mcp-session-id": session } : {}),
        },
        body: JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++this.rpcId, method, params }),
        signal: controller.signal,
      });
      const next = res.headers.get("mcp-session-id") ?? session;
      const text = await res.text();
      if (notify) return { body: {}, session: next };
      if (res.status !== 200) throw new Channel3ProviderError(`Channel3 ${method} failed (HTTP ${res.status})`, res.status);
      return { body: parseRpcBody(text), session: next };
    } catch (err) {
      if (err instanceof Channel3ProviderError) throw err;
      const cause = (err as { cause?: { code?: string } })?.cause?.code ?? (err as Error)?.name ?? "error";
      throw new Channel3ProviderError(`Channel3 ${method} failed (network or timeout: ${cause})`, null);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Up to 3 attempts with a fresh MCP session each: the catalogue endpoint is occasionally slow to answer. */
  async search(q: ProductQuery): Promise<ProductCandidate[]> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.searchOnce(q);
      } catch (err) {
        last = err;
        if (err instanceof Channel3ProviderError && err.status !== null && err.status < 500 && err.status !== 429) throw err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw last;
  }

  private async searchOnce(q: ProductQuery): Promise<ProductCandidate[]> {
    const init = await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "aegis", version: "0.1" } }, null);
    await this.rpc("notifications/initialized", {}, init.session, true);
    const { body } = await this.rpc(
      "tools/call",
      {
        name: "search_catalog",
        arguments: {
          meta: { "ucp-agent": { profile: "https://github.com/aegis-procurement/agent" } },
          catalog: { query: q.query.slice(0, 120), pagination: { limit: this.limit } },
        },
      },
      init.session,
    );
    const result = obj(body.result);
    if (body.error || result.isError === true) {
      const msg = str(obj(arr(result.content)[0]).text) ?? str(obj(body.error).message) ?? "tool error";
      throw new Channel3ProviderError(`Channel3 search_catalog error: ${msg.slice(0, 200)}`, null);
    }
    const products = arr(obj(result.structuredContent).products);
    return products.flatMap((p) => mapUcpProduct(p, q)).slice(0, this.limit);
  }
}

/** Accepts a plain JSON-RPC body or an SSE stream whose `data:` lines carry it. */
export function parseRpcBody(text: string): Json {
  const t = text.trim();
  if (t.startsWith("{")) return obj(JSON.parse(t));
  const data = t
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean)
    .pop();
  if (!data) throw new Channel3ProviderError("Channel3 returned an empty response", 200);
  return obj(JSON.parse(data));
}
