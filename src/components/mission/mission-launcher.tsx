"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Rocket } from "lucide-react";
import { DEMO_SCENARIOS } from "@/domain/providers/demo-catalog";
import { apiFetch, ApiError } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { ErrorState } from "@/components/ui/states";

export function MissionLauncher({ initialScenario, compact = false }: { initialScenario?: string; compact?: boolean }) {
  const router = useRouter();
  const initial = DEMO_SCENARIOS.find((s) => s.id === initialScenario)?.text ?? "";
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await apiFetch<{ id: string }>("/api/missions", { method: "POST", body: { text } });
      router.push(`/missions/${m.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "INTERNAL", "Could not create mission", null, null));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-3"
      aria-label="Launch a purchasing mission"
    >
      <label htmlFor="mission-text" className="block text-xs font-medium text-muted">
        Describe the purchasing mission
      </label>
      <Textarea
        id="mission-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        placeholder="e.g. Purchase 20 Raspberry Pi 5 boards (8GB) for the robotics lab. Budget $2,500, delivery within 14 days."
        className={compact ? "min-h-20" : "min-h-28"}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-muted">Demo scenarios:</span>
        {DEMO_SCENARIOS.map((s) => (
          <button key={s.id} type="button" onClick={() => setText(s.text)} className="rounded border border-line-strong px-2 py-0.5 text-xs text-muted hover:border-cyan/50 hover:text-fg" title={s.expected}>
            {s.label}
          </button>
        ))}
      </div>
      <ErrorState error={error} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted">The parser only proposes. You confirm every constraint before any agent runs.</p>
        <Button type="submit" variant="primary" loading={busy} disabled={text.trim().length < 5}>
          <Rocket className="h-4 w-4" aria-hidden />
          Parse mission
        </Button>
      </div>
    </form>
  );
}
