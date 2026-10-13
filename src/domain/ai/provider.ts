/**
 * AI provider interface. The LLM is advisory only:
 *  - interpretMission → a PROPOSAL the user must confirm (never reaches the policy engine raw)
 *  - explainRecommendation → display-only text, rendered as plain text
 * It has no tools and cannot touch scores, decisions, policy, approvals or payments.
 * Untrusted text (mission text, product/seller text) is passed as delimited data.
 */
import { z } from "zod";
import { missionConstraintsSchema } from "@/domain/types";
import { parseMajorInput } from "@/lib/money";
import { demoParseMission, type ParseProposal } from "./demo-parser";

export interface ExplainInput {
  missionTitle: string;
  recommended: { title: string; sellerName: string | null; totalFormatted: string; riskScore: number; evidenceCoverage: number } | null;
  decision: string;
  deterministicExplanation: string;
  reasons: string[];
}

export interface AiProvider {
  readonly name: string;
  readonly isLlm: boolean;
  interpretMission(text: string): Promise<ParseProposal>;
  explainRecommendation(input: ExplainInput): Promise<{ text: string; source: "llm" | "deterministic" }>;
}

export const MAX_MISSION_TEXT = 2000;

export function deterministicExplanation(input: ExplainInput): string {
  if (!input.recommended) return `No offer can proceed. ${input.reasons.slice(0, 3).join(" ")}`;
  const r = input.recommended;
  return `${input.deterministicExplanation} Recommended "${r.title}" from ${r.sellerName ?? "an unidentified seller"} at ${r.totalFormatted} all-in (trust ${100 - r.riskScore}/100, evidence coverage ${r.evidenceCoverage}%). Policy decision: ${input.decision.replace(/_/g, " ").toLowerCase()}.`;
}

export class DeterministicAi implements AiProvider {
  readonly name = "deterministic";
  readonly isLlm = false;
  async interpretMission(text: string) {
    return demoParseMission(text.slice(0, MAX_MISSION_TEXT));
  }
  async explainRecommendation(input: ExplainInput) {
    return { text: deterministicExplanation(input), source: "deterministic" as const };
  }
}

/** Shape requested from the LLM. Loose on purpose; the strict schema validates afterwards. */
export const llmMissionSchema = z.object({
  title: z.string(),
  objective: z.string(),
  productQuery: z.string(),
  category: z.string(),
  quantity: z.number().nullable(),
  /** Major units as a decimal string, e.g. "2500.00" — avoids float money. */
  budget: z.string().nullable(),
  currency: z.string(),
  deadlineDays: z.number().nullable(),
  requiredAttributes: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type LlmMission = z.infer<typeof llmMissionSchema>;

/** Converts and strictly validates LLM output; any failure → null (caller falls back). */
export function llmToProposal(out: LlmMission): ParseProposal | null {
  const uncertain: string[] = [];
  const currency = out.currency.trim().toUpperCase();
  let budgetMinor: number | null = null;
  try {
    budgetMinor = out.budget ? parseMajorInput(out.budget, currency) : null;
  } catch {
    budgetMinor = null;
  }
  if (budgetMinor == null) uncertain.push("budgetMinor");
  if (out.quantity == null) uncertain.push("quantity");
  const candidate = {
    title: out.title.slice(0, 120),
    objective: out.objective.slice(0, 600),
    productQuery: out.productQuery.slice(0, 120),
    category: out.category.toLowerCase().slice(0, 60),
    quantity: out.quantity ?? 1,
    budgetMinor: budgetMinor ?? 100_000,
    currency,
    deadlineDays: out.deadlineDays,
    requiredAttributes: Object.fromEntries(out.requiredAttributes.slice(0, 10).map((a) => [a.key.slice(0, 40), a.value.slice(0, 80)])),
  };
  const parsed = missionConstraintsSchema.safeParse(candidate);
  if (!parsed.success) return null;
  return { constraints: parsed.data, uncertain, source: "llm" };
}
