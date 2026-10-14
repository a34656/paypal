"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { CURRENCIES, RISK_TOLERANCE } from "@/domain/types";
import { parseMajorInput } from "@/lib/money";
import { apiFetch, ApiError } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/states";
import { MissionLauncher } from "./mission-launcher";

interface Errors {
  what?: string;
  quantity?: string;
  budget?: string;
  days?: string;
}

function validate(v: { what: string; quantity: string; budget: string; currency: string; days: string }): Errors {
  const e: Errors = {};
  if (v.what.trim().length < 3) e.what = "Describe the item (at least 3 characters).";
  else if (v.what.length > 120) e.what = "Keep it under 120 characters.";
  const q = Number(v.quantity);
  if (!Number.isInteger(q) || q < 1 || q > 10_000) e.quantity = "Whole number from 1 to 10,000.";
  try {
    if (parseMajorInput(v.budget, v.currency) <= 0) e.budget = "Budget must be greater than zero.";
  } catch {
    e.budget = `Enter a ${v.currency} amount, e.g. 700 or 700.00.`;
  }
  if (v.days.trim() !== "") {
    const d = Number(v.days);
    if (!Number.isInteger(d) || d < 1 || d > 365) e.days = "Days from 1 to 365, or leave empty.";
  }
  return e;
}

/**
 * Structured mission creation. Produces mission text for the existing parser route and passes
 * the typed values on to the confirmation form, where the user still reviews every field.
 */
export function MissionComposer({ initialScenario, compact = false }: { initialScenario?: string; compact?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [tab, setTab] = useState<"structured" | "describe">(initialScenario ? "describe" : "structured");
  const [what, setWhat] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [days, setDays] = useState("");
  const [tolerance, setTolerance] = useState("policy");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const values = { what, quantity, budget, currency, days };
  const errors = validate(values);
  const show = (k: keyof Errors) => (submitted ? errors[k] : undefined);

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    const money = currency === "USD" ? `$${budget.trim()}` : `${currency} ${budget.trim()}`;
    const text = `Purchase ${Number(quantity)} ${what.trim()}. Budget ${money}${days.trim() ? `, delivery within ${Number(days)} days` : ""}.`;
    try {
      const m = await apiFetch<{ id: string }>("/api/missions", { method: "POST", body: { text } });
      const qs = new URLSearchParams({ qty: String(Number(quantity)), budget: budget.trim(), cur: currency, tol: tolerance });
      if (days.trim()) qs.set("days", String(Number(days)));
      router.push(`/missions/${m.id}?${qs.toString()}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Could not create mission", null, null));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-4 border-b border-line" role="tablist" aria-label="Mission input">
        {(
          [
            ["structured", "Structured"],
            ["describe", "Describe in words"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            id={`${id}-${k}`}
            aria-selected={tab === k}
            aria-controls={`${id}-${k}-panel`}
            onClick={() => setTab(k)}
            className={cn("-mb-px border-b px-0.5 pb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] transition-colors", tab === k ? "border-cyan text-fg" : "border-transparent text-faint hover:text-muted")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "describe" ? (
        <div role="tabpanel" id={`${id}-describe-panel`} aria-labelledby={`${id}-describe`}>
          <MissionLauncher initialScenario={initialScenario} compact={compact} />
        </div>
      ) : (
        <form
          role="tabpanel"
          id={`${id}-structured-panel`}
          aria-labelledby={`${id}-structured`}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
          aria-label="Create a purchasing mission"
        >
          <Field label="What to purchase" htmlFor={`${id}-what`} warning={show("what")}>
            <Input id={`${id}-what`} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Raspberry Pi 5 starter kits (8GB)" maxLength={140} aria-invalid={!!show("what")} />
          </Field>
          <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
            <Field label="Quantity" htmlFor={`${id}-qty`} warning={show("quantity")}>
              <Input id={`${id}-qty`} type="number" min={1} max={10000} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!show("quantity")} />
            </Field>
            <Field label="Max budget" htmlFor={`${id}-budget`} warning={show("budget")}>
              <Input id={`${id}-budget`} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="700.00" className="font-mono" aria-invalid={!!show("budget")} />
            </Field>
            <Field label="Currency" htmlFor={`${id}-cur`}>
              <Select id={`${id}-cur`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Deliver within (days)" htmlFor={`${id}-days`} warning={show("days")}>
              <Input id={`${id}-days`} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} placeholder="optional" aria-invalid={!!show("days")} />
            </Field>
          </div>
          <Field label="Risk tolerance" htmlFor={`${id}-tol`} hint={`${RISK_TOLERANCE.find((t) => t.id === tolerance)?.hint} It can only tighten your policy, never loosen it.`}>
            <Select id={`${id}-tol`} value={tolerance} onChange={(e) => setTolerance(e.target.value)}>
              {RISK_TOLERANCE.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorState error={error} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="max-w-sm text-[11px] leading-relaxed text-faint">Next you confirm the parsed constraints. No agent runs and nothing is bought until you do.</p>
            <Button type="submit" variant="primary" loading={busy}>
              Create mission <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
