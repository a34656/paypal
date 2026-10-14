/**
 * Deterministic risk model.
 *
 * riskScore: 0 = lowest risk, 100 = highest. trustScore = 100 − riskScore is derived
 * in presentation only and never stored.
 *
 * Fail-closed rule: a missing mandatory signal is scored at that factor's MAXIMUM
 * contribution ("assume the worst"). Therefore a product with sparse data can never
 * score as safer than a well-documented one. Missing signals also lower evidenceCoverage,
 * which the policy engine treats as its own gate.
 *
 * Only structured fields are scored. Free text (title, description, seller text) is never
 * interpreted as evidence, so instructions embedded in product text cannot LOWER a score.
 * It is screened in one direction only: text that addresses an automated agent (prompt
 * injection) is flagged, and the policy floor BLOCKs the offer.
 */
import type { MissionConstraints, ProductCandidate } from "@/domain/types";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskFactor {
  id: string;
  label: string;
  /** Points added to riskScore. */
  contribution: number;
  max: number;
  status: "OK" | "CONCERN" | "MISSING";
  evidence: string;
}

export interface RiskAssessment {
  riskScore: number;
  level: RiskLevel;
  evidenceCoverage: number;
  factors: RiskFactor[];
  reasons: string[];
  missingInformation: string[];
  /** true = explicit mismatch, false = all required attributes match, null = could not establish. */
  requirementMismatch: boolean | null;
  recommendedAction: string;
  /** Always shown with demo data. */
  basis: string;
  /** Agent-directed instructions found in untrusted listing text (prompt injection). Never lowers risk. */
  injectionSignals?: string[];
  /** Per-requirement evidence counts, used by the optimizer for ranking only (never for gates). */
  attributeEvidence?: { required: number; matched: number; titleOnly: number; absent: number; mismatched: number };
}

/** Phrases that only make sense when addressed to an automated buyer. Deliberately narrow. */
const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ["override instruction", /\b(ignore|disregard|forget)\b[^.]{0,40}\b(previous|prior|all|above|earlier)\b[^.]{0,20}\b(instructions?|rules?|polic(y|ies)|prompts?)\b/i],
  ["agent-addressed notice", /\b(system|admin(istrator)?)\s*(notice|message|prompt|override)\b|\b(to|for)\s+the\s+(ai|llm|agent|assistant|bot)\b/i],
  ["approval directive", /\b(auto-?)?approve\s+(this|the)\s+(order|purchase|payment|transaction)\b|\bignore\s+(the\s+)?polic(y|ies)\b/i],
  ["score manipulation", /\b(set|change|make)\b[^.]{0,30}\b(risk|trust)\s*score\b|\btrust\s*score\s*(=|:|of)?\s*100\b/i],
  ["verification claim", /\bmark\b[^.]{0,30}\bas\s+verified\b/i],
];

export function detectInjection(texts: Array<string | null | undefined>): string[] {
  const hits = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const [label, re] of INJECTION_PATTERNS) if (re.test(t)) hits.add(label);
  }
  return [...hits];
}

/** Factor maxima. They sum to 100 so the worst case is exactly 100. */
export const RISK_WEIGHTS = {
  price: 15,
  sellerIdentity: 10,
  sellerVerification: 15,
  shippingCost: 10,
  tax: 5,
  delivery: 12,
  attributes: 18,
  stock: 8,
  consistency: 7,
} as const;

export function riskLevel(score: number): RiskLevel {
  if (score < 25) return "LOW";
  if (score < 50) return "MEDIUM";
  if (score < 75) return "HIGH";
  return "CRITICAL";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** "8 GB" → "8gb", "2 m" → "2m": joins a number with its unit so tokens compare reliably. */
const tokensOf = (s: string) =>
  norm(s)
    .replace(/(\d)\s+(gb|tb|mb|m|cm|mm|ft|in|w|v|hz|ghz|mhz|mah)\b/g, "$1$2")
    .split(/[^a-z0-9.+-]+/)
    .filter(Boolean);

/** Equivalent attribute names used by different catalogues. */
const KEY_ALIASES: Record<string, string[]> = {
  ram: ["memory", "system memory", "ram size"],
  memory: ["ram", "system memory"],
  storage: ["capacity", "storage capacity", "hard drive capacity"],
  length: ["cable length"],
  gpu: ["graphics", "graphics card", "gpu model"],
  cpu: ["processor"],
  power: ["wattage", "power output"],
};

/** Required value matches when every one of its tokens appears in the product value. */
export function valueMatches(required: string, actual: string): boolean {
  if (norm(required) === norm(actual)) return true;
  const have = new Set(tokensOf(actual));
  const need = tokensOf(required);
  return need.length > 0 && need.every((t) => have.has(t));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "Active Cooler for Raspberry Pi 5" is an accessory, not a Raspberry Pi 5. Detects a required
 * value that the title only names as the thing the listing is FOR. Only ever adds a mismatch.
 */
export function accessoryFor(title: string, required: string): boolean {
  const need = tokensOf(required);
  if (need.length === 0) return false;
  const body = need.map(escapeRe).join("[^a-z0-9]+");
  const re = new RegExp(`\\b(for|compatible with|fits|for use with|replacement for|works with)\\s+(the\\s+|an?\\s+|your\\s+)?${body}(?![a-z0-9])`, "i");
  return re.test(tokensOf(title).join(" "));
}

/** "2m" required, title has "1m": same unit, different number. Only measurements are compared. */
function conflictingMeasure(required: string, titleTokens: Set<string>): string | null {
  const m = /^(\d+(?:\.\d+)?)(gb|tb|mb|m|cm|mm|ft|in|w|v|hz|ghz|mhz|mah)$/.exec(tokensOf(required).join(""));
  if (!m) return null;
  if (titleTokens.has(m[1] + m[2])) return null;
  for (const t of titleTokens) {
    const x = /^(\d+(?:\.\d+)?)([a-z]+)$/.exec(t);
    if (x && x[2] === m[2] && x[1] !== m[1]) return t;
  }
  return null;
}

/**
 * "Raspberry Pi 500" when "Raspberry Pi 5" is required: the same model family followed by a
 * different model number. Returns the conflicting name, or null.
 */
export function conflictingModel(required: string, title: string): string | null {
  const need = tokensOf(required);
  const last = need[need.length - 1];
  if (need.length < 2 || !/^\d+[a-z]?$/.test(last ?? "")) return null;
  const prefix = need.slice(0, -1);
  const t = tokensOf(title);
  let conflict: string | null = null;
  for (let i = 0; i + prefix.length < t.length; i++) {
    if (!prefix.every((p, j) => t[i + j] === p)) continue;
    const next = t[i + prefix.length];
    if (next === last) return null; // the required model is named
    if (/^\d+[a-z]?$/.test(next)) conflict ??= [...prefix, next].join(" ");
  }
  return conflict;
}

/** Extra words that name an attribute inside free text ("4GB LPDDR4X SDRAM" names the RAM). */
const KEY_WORDS: Record<string, string[]> = { ram: ["sdram", "lpddr4x", "lpddr5", "ddr4", "ddr5"], memory: ["sdram"], length: ["cable", "cord"] };
/** Words that mean a segment is about something else (a "32GB memory card" is storage, not RAM). */
const NOT_KEY_WORDS: Record<string, string[]> = { ram: ["card", "sd", "microsd", "storage", "ssd", "emmc", "flash", "drive"], memory: ["card", "sd", "microsd", "storage", "ssd", "emmc", "flash", "drive"] };

/**
 * Description contradiction, scoped to the sentence/bullet that names the attribute, so a
 * "32GB memory card" bullet does not contradict "8GB" RAM but "4GB LPDDR4X SDRAM" does.
 */
export function conflictingMeasureInText(key: string, required: string, text: string | null): string | null {
  if (!text) return null;
  const k = norm(key);
  const words = [k, ...(KEY_ALIASES[k] ?? []), ...(KEY_WORDS[k] ?? [])];
  for (const segment of text.split(/[·•;\n]|\.(?=\s|$)/)) {
    const toks = tokensOf(segment);
    const joined = ` ${toks.join(" ")} `;
    if (!words.some((w) => joined.includes(` ${tokensOf(w).join(" ")} `) || toks.some((t) => t === w))) continue;
    if ((NOT_KEY_WORDS[k] ?? []).some((w) => toks.includes(w))) continue;
    const hit = conflictingMeasure(required, new Set(toks));
    if (hit) return hit;
  }
  return null;
}

export interface RiskOptions {
  /**
   * Shipping/tax are undisclosed but bounded by a policy spending cap enforced by a PayPal
   * authorization hold. They then count as bounded evidence (partial risk), not as missing.
   */
  costBounded?: boolean;
}

export function assessRisk(product: ProductCandidate, mission: MissionConstraints, options: RiskOptions = {}): RiskAssessment {
  const factors: RiskFactor[] = [];
  const missing: string[] = [];
  let signalsTotal = 0;
  let signalsPresent = 0;
  const signal = (present: boolean, name: string) => {
    signalsTotal += 1;
    if (present) signalsPresent += 1;
    else missing.push(name);
  };

  // 1. Price deviation from the seeded baseline.
  {
    const max = RISK_WEIGHTS.price;
    const base = product.baselineUnitPriceMinor;
    signal(base != null && base > 0, "price baseline");
    if (base == null || base <= 0) {
      factors.push({ id: "price", label: "Price deviation", contribution: max, max, status: "MISSING", evidence: "No reference price available; deviation cannot be assessed." });
    } else {
      // Integer basis points to keep this exact.
      const bps = Math.round(((product.unitPriceMinor - base) * 10_000) / base);
      let c = 0;
      if (bps > 5_000) c = max;
      else if (bps > 2_500) c = 8;
      else if (bps < -4_000) c = 12; // suspiciously cheap
      else if (bps < -2_000) c = 6;
      const pct = (bps / 100).toFixed(1);
      const ref = product.isDemoData
        ? "the seeded reference price"
        : product.baselineSource === "retailer-list-price"
          ? "the retailer's list price"
          : product.baselineSource === "cross-retailer-median"
            ? "the median price across other retailers"
            : "the provider reference price";
      factors.push({
        id: "price",
        label: "Price deviation",
        contribution: c,
        max,
        status: c > 0 ? "CONCERN" : "OK",
        evidence: `Unit price is ${bps >= 0 ? "+" : ""}${pct}% vs ${ref}.`,
      });
    }
  }

  // 2. Seller identity.
  {
    const max = RISK_WEIGHTS.sellerIdentity;
    const has = !!product.sellerName && product.sellerName.trim().length > 0 && !!product.sellerId;
    signal(has, "seller identity");
    factors.push({ id: "seller_identity", label: "Seller identity", contribution: has ? 0 : max, max, status: has ? "OK" : "MISSING", evidence: has ? "Seller name and identifier disclosed." : "Seller name or identifier missing." });
  }

  // 3. Seller verification.
  {
    const max = RISK_WEIGHTS.sellerVerification;
    const v = product.sellerVerificationStatus;
    signal(v !== "UNKNOWN", "seller verification status");
    const c = v === "VERIFIED" ? 0 : v === "UNVERIFIED" ? 12 : max;
    factors.push({ id: "seller_verification", label: "Seller verification", contribution: c, max, status: v === "VERIFIED" ? "OK" : v === "UNKNOWN" ? "MISSING" : "CONCERN", evidence: `Provider reports seller as ${v.toLowerCase()}.` });
  }

  // 4. Shipping cost.
  {
    const max = RISK_WEIGHTS.shippingCost;
    const has = product.shippingMinor != null;
    const bounded = !has && options.costBounded === true;
    signal(has || bounded, "shipping cost");
    factors.push({
      id: "shipping_cost",
      label: "Shipping cost",
      contribution: has ? 0 : bounded ? 5 : max,
      max,
      status: has ? "OK" : bounded ? "CONCERN" : "MISSING",
      evidence: has ? "Shipping cost disclosed." : bounded ? "Shipping not disclosed; bounded by the spending-cap allowance (PayPal authorization hold)." : "Shipping cost not disclosed; the all-in total is unknown.",
    });
  }

  // 5. Tax.
  {
    const max = RISK_WEIGHTS.tax;
    const has = product.taxMinor != null;
    const bounded = !has && options.costBounded === true;
    signal(has || bounded, "tax");
    factors.push({
      id: "tax",
      label: "Tax",
      contribution: has ? 0 : bounded ? 2 : max,
      max,
      status: has ? "OK" : bounded ? "CONCERN" : "MISSING",
      evidence: has ? "Tax disclosed." : bounded ? "Tax not disclosed; bounded by the spending-cap allowance." : "Tax not disclosed.",
    });
  }

  // 6. Delivery estimate vs deadline.
  {
    const max = RISK_WEIGHTS.delivery;
    const est = product.shippingEstimateDays;
    signal(est != null, "delivery estimate");
    if (est == null) {
      factors.push({ id: "delivery", label: "Delivery evidence", contribution: max, max, status: "MISSING", evidence: "No delivery estimate." });
    } else if (mission.deadlineDays != null && est > mission.deadlineDays) {
      factors.push({ id: "delivery", label: "Delivery evidence", contribution: max, max, status: "CONCERN", evidence: `Estimated ${est} days exceeds the ${mission.deadlineDays}-day deadline.` });
    } else {
      factors.push({ id: "delivery", label: "Delivery evidence", contribution: 0, max, status: "OK", evidence: `Estimated delivery in ${est} days${mission.deadlineDays != null ? ` (deadline ${mission.deadlineDays})` : ""}.` });
    }
  }

  // 7. Required attributes.
  let requirementMismatch: boolean | null = false;
  let attributeEvidence: RiskAssessment["attributeEvidence"] = { required: 0, matched: 0, titleOnly: 0, absent: 0, mismatched: 0 };
  {
    const max = RISK_WEIGHTS.attributes;
    const required = Object.entries(mission.requiredAttributes);
    if (required.length === 0) {
      factors.push({ id: "attributes", label: "Requirement match", contribution: 0, max, status: "OK", evidence: "Mission states no required attributes." });
    } else {
      const productAttrs = new Map(Object.entries(product.attributes).map(([k, v]) => [norm(k), v]));
      const lookup = (k: string): string | undefined => {
        const key = norm(k);
        if (productAttrs.has(key)) return productAttrs.get(key);
        for (const alias of KEY_ALIASES[key] ?? []) if (productAttrs.has(alias)) return productAttrs.get(alias);
        return undefined;
      };
      const titleTokens = new Set(tokensOf(product.title));
      // Listing text (title + description) is weak evidence only; measurements are checked against the title.
      const textTokens = new Set([...titleTokens, ...tokensOf(product.description ?? "")]);
      const mismatched: string[] = [];
      const absent: string[] = [];
      const titleOnly: string[] = [];
      for (const [k, v] of required) {
        if (accessoryFor(product.title, v)) {
          signal(true, `attribute "${k}"`);
          mismatched.push(`listing is an accessory for "${v}", not the item itself`);
          continue;
        }
        const pv = lookup(k);
        if (pv !== undefined) {
          signal(true, `attribute "${k}"`);
          if (!valueMatches(v, pv)) mismatched.push(`${k} is "${pv}" (required "${v}")`);
          continue;
        }
        // Structured attribute missing: the listing title may still state it (weaker evidence),
        // or contradict it ("1m" in the title when "2m" is required).
        const contradiction = conflictingMeasure(v, titleTokens) ?? conflictingModel(v, product.title) ?? conflictingMeasureInText(k, v, product.description);
        if (contradiction) {
          signal(true, `attribute "${k}"`);
          mismatched.push(`${k}: title states "${contradiction}" (required "${v}")`);
          continue;
        }
        const need = tokensOf(v);
        const inTitle = need.length > 0 && need.every((t) => textTokens.has(t));
        // Coverage: a title statement is evidence that exists (weak); the score still takes the full share.
        signal(inTitle, `attribute "${k}"`);
        if (inTitle) titleOnly.push(k);
        else absent.push(k);
      }
      // Each attribute owns an equal share; missing, mismatched and title-only all take the full
      // share (a title is the seller's free-text claim, and sparse data must never score safer
      // than documented data). Title matches only improve the explanation shown to the approver.
      const shares = mismatched.length + absent.length + titleOnly.length;
      const c = shares === 0 ? 0 : Math.min(max, Math.ceil((max * shares) / required.length));
      requirementMismatch = mismatched.length > 0 ? true : absent.length + titleOnly.length > 0 ? null : false;
      attributeEvidence = {
        required: required.length,
        matched: required.length - mismatched.length - absent.length - titleOnly.length,
        titleOnly: titleOnly.length,
        absent: absent.length,
        mismatched: mismatched.length,
      };
      const parts = [
        mismatched.length ? `Mismatch: ${mismatched.join("; ")}.` : "",
        absent.length ? `Not disclosed: ${absent.join(", ")}.` : "",
        titleOnly.length ? `Stated only in the listing text: ${titleOnly.join(", ")}.` : "",
      ].filter(Boolean);
      factors.push({
        id: "attributes",
        label: "Requirement match",
        contribution: c,
        max,
        status: mismatched.length || titleOnly.length ? "CONCERN" : absent.length ? "MISSING" : "OK",
        evidence: parts.length ? parts.join(" ") : "All required attributes match.",
      });
    }
  }

  // 8. Stock.
  {
    const max = RISK_WEIGHTS.stock;
    const s = product.stockQuantity;
    if (s == null && product.inStock === true) {
      // Availability disclosed, quantity not: partial evidence, more doubt for bulk orders.
      signal(true, "stock level");
      const c = mission.quantity > 1 ? 4 : 2;
      factors.push({ id: "stock", label: "Stock availability", contribution: c, max, status: "CONCERN", evidence: `Retailer reports in stock; quantity not disclosed (${mission.quantity} requested).` });
    } else if (s == null && product.inStock === false) {
      signal(true, "stock level");
      factors.push({ id: "stock", label: "Stock availability", contribution: max, max, status: "CONCERN", evidence: "Retailer reports out of stock." });
    } else {
      signal(s != null, "stock level");
      const c = s == null ? max : s < mission.quantity ? max : 0;
      factors.push({ id: "stock", label: "Stock availability", contribution: c, max, status: s == null ? "MISSING" : c > 0 ? "CONCERN" : "OK", evidence: s == null ? "Stock level not disclosed." : s < mission.quantity ? `Only ${s} in stock for ${mission.quantity} requested.` : `${s} in stock for ${mission.quantity} requested.` });
    }
  }

  // 9. Data consistency.
  {
    const max = RISK_WEIGHTS.consistency;
    const issues: string[] = [];
    let c = 0;
    if (product.currency !== mission.currency) {
      c = max;
      issues.push(`currency ${product.currency} differs from mission currency ${mission.currency}`);
    }
    if (norm(product.category) !== norm(mission.category)) {
      c = Math.max(c, 4);
      issues.push(`category "${product.category}" differs from mission category "${mission.category}"`);
    }
    factors.push({ id: "consistency", label: "Data consistency", contribution: c, max, status: c ? "CONCERN" : "OK", evidence: issues.length ? `Inconsistent: ${issues.join("; ")}.` : "Currency and category are consistent with the mission." });
  }

  const raw = factors.reduce((s, f) => s + f.contribution, 0);
  const riskScore = Math.max(0, Math.min(100, raw));
  const evidenceCoverage = signalsTotal === 0 ? 0 : Math.floor((signalsPresent * 100) / signalsTotal);
  const level = riskLevel(riskScore);
  const reasons = factors.filter((f) => f.contribution > 0).map((f) => `${f.label}: ${f.evidence}`);

  let recommendedAction: string;
  if (detectInjection([product.title, product.description, product.sellerName]).length > 0) recommendedAction = "Do not purchase: listing attempts to instruct the agent.";
  else if (level === "CRITICAL") recommendedAction = "Do not purchase.";
  else if (level === "HIGH" || evidenceCoverage < 50) recommendedAction = "Avoid unless an approver reviews the missing evidence.";
  else if (level === "MEDIUM") recommendedAction = "Purchase only with approver review.";
  else recommendedAction = "Acceptable risk; policy still decides.";

  const injectionSignals = detectInjection([product.title, product.description, product.sellerName, ...Object.values(product.attributes)]);
  if (injectionSignals.length > 0) reasons.unshift(`Listing text contains instructions aimed at an automated agent (${injectionSignals.join(", ")}).`);

  return {
    injectionSignals,
    attributeEvidence,
    riskScore,
    level,
    evidenceCoverage,
    factors,
    reasons,
    missingInformation: missing,
    requirementMismatch,
    recommendedAction,
    basis: product.isDemoData
      ? "Estimate from demo evidence. Reference prices are seeded demo values, not market data."
      : "Estimate from provider-supplied evidence (real retailer listing via the product provider).",
  };
}
