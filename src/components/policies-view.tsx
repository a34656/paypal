"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, Save, ShieldHalf } from "lucide-react";
import { diffPolicies, policyConfigSchema, type PolicyConfig, type PolicyChange } from "@/domain/policy/schema";
import { CURRENCIES } from "@/domain/types";
import { formatMoney, parseMajorInput, toProviderDecimal } from "@/lib/money";
import { apiFetch, ApiError, useApi } from "@/lib/client/api";
import { formatTime } from "@/lib/client/format";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/states";

interface Version {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string;
  configuration: PolicyConfig;
  changes: PolicyChange[];
}

const MONEY_FIELDS = [
  ["maxMissionBudgetMinor", "Max mission budget"],
  ["maxPurchaseMinor", "Max individual purchase"],
  ["maxAutoPurchaseMinor", "Max automatic purchase"],
  ["approvalThresholdMinor", "Require approval above"],
] as const;
const FLAGS = [
  ["requireApprovalForEveryPayment", "Require approval for every payment"],
  ["blockOverBudget", "Block over-budget purchases (otherwise require approval)"],
  ["requireSufficientInfo", "Block when evidence coverage is below the minimum"],
  ["blockUnverifiedSellers", "Block unknown/unverified sellers (otherwise require approval)"],
  ["autoOrderCreation", "Allow checkout without approver sign-off when every check passes"],
] as const;

const fmtVal = (field: string, v: unknown, cur: string) => (typeof v === "number" && field.endsWith("Minor") ? formatMoney(v, cur) : Array.isArray(v) ? v.join(", ") || "(none)" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function PoliciesView() {
  const { data, error, mutate } = useApi<{ current: Version; versions: Version[] }>("/api/policies");
  const [draft, setDraft] = useState<PolicyConfig | null>(null);
  const [money, setMoney] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (data && !draft) {
      const c = data.current.configuration;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialise the editor once data arrives
      setDraft(c);
      setMoney(Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, toProviderDecimal(c[k], c.currency)])));
    }
  }, [data, draft]);

  const parsedDraft = useMemo(() => {
    if (!draft) return null;
    try {
      const withMoney = { ...draft, ...Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, parseMajorInput(money[k] ?? "", draft.currency)])) };
      const r = policyConfigSchema.safeParse(withMoney);
      return r.success ? { ok: true as const, value: r.data } : { ok: false as const, issues: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
    } catch {
      return { ok: false as const, issues: ["Amounts must be valid decimal numbers"] };
    }
  }, [draft, money]);

  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data || !draft) return <Spinner />;
  const changes = parsedDraft?.ok ? diffPolicies(data.current.configuration, parsedDraft.value) : [];
  const loosening = changes.filter((c) => c.loosens);
  const set = <K extends keyof PolicyConfig>(k: K, v: PolicyConfig[K]) => setDraft({ ...draft, [k]: v });

  const publish = async () => {
    if (!parsedDraft?.ok) return;
    setBusy(true);
    setSaveError(null);
    setSaved(null);
    try {
      const r = await apiFetch<{ version: number }>("/api/policies", { method: "PUT", body: { expectedVersion: data.current.version, configuration: parsedDraft.value } });
      setSaved(`Published policy v${r.version}. Existing approvals stay bound to their original version.`);
      setDraft(null);
      await mutate();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Publish failed", null, null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-demo-target="policy-config" className="space-y-4">
      <PageHeader
        eyebrow="Governance"
        title="Policies"
        subtitle="Edits create a new immutable version, enforced server-side. The hard-coded floor (unknown totals, missing risk, currency mismatch, budget cap, human approval before capture) cannot be configured away."
        actions={<Badge tone="cyan">Current v{data.current.version}</Badge>}
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel>
          <PanelHeader title="Edit policy" icon={<ShieldHalf className="h-4 w-4 text-cyan" />} subtitle="Policy changes are made by humans only; no agent or LLM can reach this endpoint." />
          <PanelBody className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Policy currency" htmlFor="p-cur" hint="Limits are denominated in it. Other currencies are blocked (no FX).">
                <Select id="p-cur" value={draft.currency} onChange={(e) => set("currency", e.target.value as PolicyConfig["currency"])}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
              </Field>
              {MONEY_FIELDS.map(([k, label]) => (
                <Field key={k} label={`${label} (${draft.currency})`} htmlFor={`p-${k}`}>
                  <Input id={`p-${k}`} inputMode="decimal" value={money[k] ?? ""} onChange={(e) => setMoney({ ...money, [k]: e.target.value })} />
                </Field>
              ))}
              <Field label="Minimum trust score (0–100)" htmlFor="p-trust" hint={`Risk above ${100 - draft.minTrustScore} is blocked.`}>
                <Input id="p-trust" type="number" min={0} max={100} value={draft.minTrustScore} onChange={(e) => set("minTrustScore", Number(e.target.value))} />
              </Field>
              <Field label="Risk score requiring approval" htmlFor="p-arisk">
                <Input id="p-arisk" type="number" min={0} max={100} value={draft.approvalRiskScore} onChange={(e) => set("approvalRiskScore", Number(e.target.value))} />
              </Field>
              <Field label="Minimum evidence coverage (%)" htmlFor="p-cov">
                <Input id="p-cov" type="number" min={0} max={100} value={draft.minEvidenceCoverage} onChange={(e) => set("minEvidenceCoverage", Number(e.target.value))} />
              </Field>
              <Field label="Approval TTL (minutes)" htmlFor="p-ttl">
                <Input id="p-ttl" type="number" min={1} max={1440} value={draft.approvalTtlMinutes} onChange={(e) => set("approvalTtlMinutes", Number(e.target.value))} />
              </Field>
              <Field label="Duplicate window (hours)" htmlFor="p-dupw">
                <Input id="p-dupw" type="number" min={0} max={2160} value={draft.duplicateWindowHours} onChange={(e) => set("duplicateWindowHours", Number(e.target.value))} />
              </Field>
              <Field label="On duplicate purchase" htmlFor="p-dupa">
                <Select id="p-dupa" value={draft.duplicateAction} onChange={(e) => set("duplicateAction", e.target.value as PolicyConfig["duplicateAction"])}>
                  <option value="REQUIRE_APPROVAL">Require approval</option>
                  <option value="BLOCK">Block</option>
                </Select>
              </Field>
              <Field label="Allowed categories (comma-separated, empty = all)" htmlFor="p-allow">
                <Input id="p-allow" value={draft.allowedCategories.join(", ")} onChange={(e) => set("allowedCategories", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
              </Field>
              <Field label="Blocked categories" htmlFor="p-block">
                <Input id="p-block" value={draft.blockedCategories.join(", ")} onChange={(e) => set("blockedCategories", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
              </Field>
              <Field
                label="Spending-cap allowance (%)"
                htmlFor="p-cap"
                hint="When a seller hides shipping/tax, VANTA may request a PayPal authorization hold of item total + this %. Always needs an approver; 0 = block instead."
              >
                <Input id="p-cap" type="number" min={0} max={50} value={draft.costAllowancePct} onChange={(e) => set("costAllowancePct", Number(e.target.value))} />
              </Field>
              <Field label="Trusted retailer domains (comma-separated)" htmlFor="p-trusted" hint="Offers from these domains count as verified sellers. Real catalogues do not verify sellers themselves.">
                <Input id="p-trusted" value={draft.trustedSellerDomains.join(", ")} onChange={(e) => set("trustedSellerDomains", e.target.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))} />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-muted">Rules</legend>
              {FLAGS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft[k]} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-[#6FE3EE]" />
                  {label}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-muted">Optimizer weights (versioned with the policy; never set by an agent)</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(Object.keys(draft.optimizerWeights) as (keyof PolicyConfig["optimizerWeights"])[]).map((w) => (
                  <Field key={w} label={w} htmlFor={`w-${w}`}>
                    <Input id={`w-${w}`} type="number" min={0} max={100} value={draft.optimizerWeights[w]} onChange={(e) => set("optimizerWeights", { ...draft.optimizerWeights, [w]: Number(e.target.value) })} />
                  </Field>
                ))}
              </div>
            </fieldset>

            {parsedDraft && !parsedDraft.ok && (
              <ErrorState error={{ code: "VALIDATION", message: parsedDraft.issues.join("; ") }} />
            )}
            {loosening.length > 0 && (
              <div role="alert" className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  <p className="font-semibold">This change loosens {loosening.length} control{loosening.length > 1 ? "s" : ""}: {loosening.map((l) => l.field).join(", ")}.</p>
                  <p className="mt-0.5">Loosening never retroactively authorises anything: existing approvals stay bound to their original version, and a looser policy never upgrades a past decision.</p>
                </div>
              </div>
            )}
            {changes.length > 0 && (
              <div className="rounded-md border border-line p-3 text-xs">
                <p className="mb-1 font-medium">Pending changes</p>
                <ul className="space-y-0.5 font-mono">
                  {changes.map((c) => (
                    <li key={c.field}>
                      {c.field}: {fmtVal(c.field, c.before, draft.currency)} → {fmtVal(c.field, c.after, draft.currency)} {c.loosens && <span className="text-warning">(loosens)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ErrorState error={saveError} />
            {saved && <p className="text-xs text-success">{saved}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>
                Discard
              </Button>
              <Button variant="primary" onClick={publish} loading={busy} disabled={!parsedDraft?.ok || changes.length === 0}>
                <Save className="h-4 w-4" aria-hidden /> Publish v{data.current.version + 1}
              </Button>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Version history" icon={<History className="h-4 w-4 text-cyan" />} subtitle="Append-only (database trigger rejects edits)" />
          <ol className="divide-y divide-line">
            {data.versions.map((v) => (
              <li key={v.id} className="px-4 py-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-fg">v{v.version}</span>
                  <span className="text-muted">{formatTime(v.createdAt)}</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-muted">by {v.createdBy}</p>
                {v.changes.length === 0 ? (
                  <p className="mt-1 text-muted">Initial default policy</p>
                ) : (
                  <ul className="mt-1 space-y-0.5">
                    {v.changes.map((c) => (
                      <li key={c.field} className="font-mono">
                        {c.field}: {fmtVal(c.field, c.before, v.configuration.currency)} → {fmtVal(c.field, c.after, v.configuration.currency)}
                        {c.loosens && <span className="ml-1 text-warning">loosened</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
