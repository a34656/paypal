/**
 * Deterministic mission parser used when no LLM is configured (and as the fallback when
 * the LLM fails). Output is a PROPOSAL the user must confirm or edit.
 */
import { parseMajorInput, type Currency } from "@/lib/money";
import type { MissionConstraints } from "@/domain/types";

const CURRENCY_SYMBOLS: Array<[RegExp, Currency]> = [
  [/€|\beur\b|euros?/i, "EUR"],
  [/£|\bgbp\b|pounds?/i, "GBP"],
  [/¥|\bjpy\b|\byen\b/i, "JPY"],
  [/\bcad\b/i, "CAD"],
  [/\baud\b/i, "AUD"],
  [/\bchf\b/i, "CHF"],
];

function detectCurrency(text: string): Currency {
  for (const [re, c] of CURRENCY_SYMBOLS) if (re.test(text)) return c;
  return "USD";
}

function detectBudget(text: string, currency: Currency): number | null {
  const patterns = [
    /budget(?:\s+of|\s+is|:)?\s*[$€£¥]?\s*([\d][\d,]*(?:\.\d+)?)\s*(k)?/i,
    /[$€£¥]\s*([\d][\d,]*(?:\.\d+)?)\s*(k)?/i,
    /([\d][\d,]*(?:\.\d+)?)\s*(k)?\s*(?:usd|eur|gbp|dollars|euros)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      try {
        const base = parseMajorInput(m[1], currency);
        return m[2] ? base * 1000 : base;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function detectQuantity(text: string): number | null {
  // Verb form first ("buy 20 …"), then "<n> [up to 3 words] <unit noun>" so "Pi 5 boards" is not read as 5.
  const m =
    /\b(?:buy|purchase|procure|order|get|need)\s+(\d{1,5})\b/i.exec(text) ??
    /\b(\d{1,5})\s+(?:[a-z0-9-]+\s+){0,3}?(?:units?|pcs|pieces|boards?|cables?|servers?|items?|laptops?|kits?|chairs?|monitors?)\b/i.exec(text) ??
    /\b(\d{1,5})\s*x\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

function detectDeadline(text: string): number | null {
  const m = /within\s+(\d{1,3})\s*(day|week)s?/i.exec(text) ?? /in\s+(\d{1,3})\s*(day|week)s?/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]) * (m[2].toLowerCase() === "week" ? 7 : 1);
  return n >= 1 && n <= 365 ? n : null;
}

export interface ParseProposal {
  constraints: MissionConstraints;
  /** Fields the parser could not determine; the confirm form highlights them. */
  uncertain: string[];
  source: "demo-parser" | "llm";
}

export function demoParseMission(text: string): ParseProposal {
  const t = text.trim();
  const lower = t.toLowerCase();
  const currency = detectCurrency(t);
  const uncertain: string[] = [];

  const budgetMinor = detectBudget(t, currency);
  if (budgetMinor == null) uncertain.push("budgetMinor");
  const quantity = detectQuantity(t);
  if (quantity == null) uncertain.push("quantity");
  const deadlineDays = detectDeadline(t);

  let productQuery = t.slice(0, 80);
  let category = "general";
  const requiredAttributes: Record<string, string> = {};

  if (/raspberry\s*pi/.test(lower)) {
    productQuery = "raspberry pi board";
    category = "electronics";
    const gen = /pi\s*(\d)/.exec(lower);
    requiredAttributes.model = `Raspberry Pi ${gen ? gen[1] : "5"}`;
    const ram = /(\d{1,2})\s*gb/.exec(lower);
    if (ram) requiredAttributes.ram = `${ram[1]}GB`;
  } else if (/usb[\s-]?c/.test(lower) && /cable/.test(lower)) {
    productQuery = "usb-c cable";
    category = "cables";
    const len = /(\d(?:\.\d)?)\s*m\b/.exec(lower);
    if (len) requiredAttributes.length = `${len[1]}m`;
    const w = /(\d{2,3})\s*w\b/.exec(lower);
    if (w) requiredAttributes.power = `${w[1]}W`;
  } else if (/gpu|server/.test(lower)) {
    productQuery = "gpu server";
    category = "servers";
  } else {
    uncertain.push("productQuery", "category");
  }

  const firstSentence = t.split(/[.\n]/)[0].trim();
  const title = (firstSentence.length >= 3 ? firstSentence : t).slice(0, 120);

  return {
    constraints: {
      title,
      objective: t.slice(0, 600),
      productQuery,
      category,
      quantity: quantity ?? 1,
      budgetMinor: budgetMinor ?? 100_000,
      currency,
      deadlineDays,
      requiredAttributes,
    },
    uncertain,
    source: "demo-parser",
  };
}
