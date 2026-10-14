import { z } from "zod";
import { CURRENCY_EXPONENTS, MAX_MINOR, MAX_QUANTITY, type Currency } from "@/lib/money";

export const CURRENCIES = Object.keys(CURRENCY_EXPONENTS) as [Currency, ...Currency[]];
export const currencySchema = z.enum(CURRENCIES);

export const minorSchema = z.number().int().min(0).max(MAX_MINOR);
export const positiveMinorSchema = z.number().int().min(1).max(MAX_MINOR);
export const quantitySchema = z.number().int().min(1).max(MAX_QUANTITY);

const shortText = (max: number) => z.string().trim().max(max);

/**
 * The only mission object the engines ever see. Produced by a parser as a *proposal*
 * and becomes authoritative only after the user confirms it (POST /confirm).
 */
export const missionConstraintsSchema = z.object({
  title: shortText(120).min(3),
  objective: shortText(600).min(3),
  productQuery: shortText(120).min(2),
  category: shortText(60).min(2),
  quantity: quantitySchema,
  budgetMinor: positiveMinorSchema,
  currency: currencySchema,
  /** Required delivery window in days, null when no deadline was stated. */
  deadlineDays: z.number().int().min(1).max(365).nullable(),
  /** Attribute key → required value, e.g. { model: "Raspberry Pi 5", ram: "8GB" }. */
  requiredAttributes: z
    .record(shortText(40).min(1), shortText(80).min(1))
    .refine((r) => Object.keys(r).length <= 10, "At most 10 required attributes"),
  /**
   * Mission risk tolerance: a per-mission risk ceiling chosen by the user. It can only TIGHTEN
   * the owner's policy (the policy maximum still applies); null/absent = policy default.
   */
  maxRiskScore: z.number().int().min(0).max(100).nullable().optional(),
});

/** UI presets for maxRiskScore. */
export const RISK_TOLERANCE = [
  { id: "policy", label: "Policy default", maxRiskScore: null, hint: "Only the owner policy applies." },
  { id: "balanced", label: "Balanced", maxRiskScore: 45, hint: "Block offers with risk above 45." },
  { id: "conservative", label: "Conservative", maxRiskScore: 30, hint: "Block offers with risk above 30." },
] as const;
export type MissionConstraints = z.infer<typeof missionConstraintsSchema>;

export const createMissionInputSchema = z.object({
  text: z.string().trim().min(5).max(2000),
});

export type SellerVerification = "VERIFIED" | "UNVERIFIED" | "UNKNOWN";
export type DecisionValue = "ALLOW_CHECKOUT" | "REQUIRE_APPROVAL" | "BLOCK";
export type ModeValue = "DEMO" | "SANDBOX" | "LIVE";

/** Normalised product as returned by any ProductProvider. */
export interface ProductCandidate {
  provider: string;
  providerProductId: string;
  title: string;
  description: string | null;
  category: string;
  unitPriceMinor: number;
  shippingMinor: number | null;
  taxMinor: number | null;
  currency: string;
  imageUrl: string | null;
  sellerId: string | null;
  sellerName: string | null;
  sellerVerificationStatus: SellerVerification;
  shippingEstimateDays: number | null;
  stockQuantity: number | null;
  attributes: Record<string, string>;
  isDemoData: boolean;
  /** Reference unit price: seeded for demo data; retailer list price or cross-retailer median for real data. */
  baselineUnitPriceMinor: number | null;
  /** Where the reference price came from (e.g. "retailer-list-price", "cross-retailer-median"). */
  baselineSource?: string | null;
  /** Availability flag when the provider discloses it but not a stock quantity. */
  inStock?: boolean | null;
  /** Retailer offer link (https only), shown to the human; never fetched server-side. */
  offerUrl?: string | null;
}
