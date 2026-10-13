import { z } from "zod";
import { apiRoute } from "@/server/api";
import { getProductProvider, normalizeCandidate } from "@/domain/providers/product-provider";

const q = z.object({ q: z.string().trim().min(2).max(120), category: z.string().max(60).default(""), quantity: z.coerce.number().int().min(1).max(10_000).default(1), currency: z.string().length(3).default("USD") });

export const GET = apiRoute(async ({ req }) => {
  const p = q.parse(Object.fromEntries(req.nextUrl.searchParams));
  const provider = getProductProvider();
  const results = (await provider.search({ query: p.q, category: p.category, quantity: p.quantity, currency: p.currency })).map(normalizeCandidate).filter(Boolean);
  return { provider: provider.name, demo: provider.isDemo, results };
});
