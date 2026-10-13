"use client";
import { useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { CURRENCIES } from "@/domain/types";
import { parseMajorInput, toProviderDecimal } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/states";

interface Proposal {
  title: string;
  objective: string;
  productQuery: string;
  category: string;
  quantity: number;
  budgetMinor: number;
  currency: string;
  deadlineDays: number | null;
  requiredAttributes: Record<string, string>;
  uncertain?: string[];
}

/** Structured confirmation form. Only what the user confirms here becomes the mission. */
export function ConfirmForm({ missionId, proposal, parserSource, onDone }: { missionId: string; proposal: Proposal; parserSource: string | null; onDone: () => void }) {
  const uncertain = new Set(proposal.uncertain ?? []);
  const [title, setTitle] = useState(proposal.title);
  const [objective, setObjective] = useState(proposal.objective);
  const [productQuery, setProductQuery] = useState(proposal.productQuery);
  const [category, setCategory] = useState(proposal.category);
  const [quantity, setQuantity] = useState(String(proposal.quantity));
  const [currency, setCurrency] = useState(proposal.currency);
  const [budget, setBudget] = useState(toProviderDecimal(proposal.budgetMinor, proposal.currency));
  const [deadline, setDeadline] = useState(proposal.deadlineDays == null ? "" : String(proposal.deadlineDays));
  const [attrs, setAttrs] = useState<[string, string][]>(Object.entries(proposal.requiredAttributes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async () => {
    setError(null);
    let budgetMinor: number;
    try {
      budgetMinor = parseMajorInput(budget, currency);
    } catch {
      setError(new ApiError(400, "VALIDATION", `Budget must be a ${currency} amount with at most the currency's decimal places.`, null, null));
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/missions/${missionId}/confirm`, {
        method: "POST",
        body: {
          constraints: {
            title,
            objective,
            productQuery,
            category: category.toLowerCase(),
            quantity: Number(quantity),
            budgetMinor,
            currency,
            deadlineDays: deadline === "" ? null : Number(deadline),
            requiredAttributes: Object.fromEntries(attrs.filter(([k, v]) => k.trim() && v.trim())),
          },
        },
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Confirmation failed", null, null));
    } finally {
      setBusy(false);
    }
  };

  const warn = (k: string) => (uncertain.has(k) ? "Not found in your text — please set this explicitly." : undefined);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
      aria-label="Confirm parsed mission constraints"
    >
      <p className="rounded-md border border-blue/30 bg-blue/5 px-3 py-2 text-xs text-blue">
        Parsed by <strong>{parserSource === "llm" ? "the LLM" : "the deterministic demo parser"}</strong>. This is a proposal: review and edit every field. Raw text never reaches the policy engine.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" htmlFor="c-title">
          <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="Search query" htmlFor="c-query" warning={warn("productQuery")}>
          <Input id="c-query" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} maxLength={120} required />
        </Field>
        <Field label="Category" htmlFor="c-cat" warning={warn("category")}>
          <Input id="c-cat" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} required />
        </Field>
        <Field label="Quantity" htmlFor="c-qty" warning={warn("quantity")}>
          <Input id="c-qty" type="number" min={1} max={10000} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </Field>
        <Field label={`Total budget (${currency})`} htmlFor="c-budget" warning={warn("budgetMinor")} hint="All-in: price × quantity + shipping + tax must fit.">
          <Input id="c-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} required />
        </Field>
        <Field label="Currency" htmlFor="c-cur" hint="Single currency per mission. No conversion.">
          <Select id="c-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Delivery deadline (days, optional)" htmlFor="c-deadline">
          <Input id="c-deadline" type="number" min={1} max={365} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
      </div>
      <Field label="Objective" htmlFor="c-obj">
        <Textarea id="c-obj" value={objective} onChange={(e) => setObjective(e.target.value)} maxLength={600} className="min-h-16" />
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted">Required attributes</legend>
        {attrs.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <Input aria-label={`Attribute ${i + 1} name`} value={k} onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [e.target.value, a[1]] : a)))} placeholder="name (e.g. ram)" />
            <Input aria-label={`Attribute ${i + 1} value`} value={v} onChange={(e) => setAttrs(attrs.map((a, j) => (j === i ? [a[0], e.target.value] : a)))} placeholder="value (e.g. 8GB)" />
            <Button type="button" variant="ghost" size="icon" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))} aria-label={`Remove attribute ${i + 1}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {attrs.length < 10 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAttrs([...attrs, ["", ""]])}>
            <Plus className="h-3.5 w-3.5" /> Add attribute
          </Button>
        )}
      </fieldset>
      <ErrorState error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          <CheckCircle2 className="h-4 w-4" aria-hidden /> Confirm constraints
        </Button>
      </div>
    </form>
  );
}
