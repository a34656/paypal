"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, EyeOff, RotateCcw, ScrollText, Undo2 } from "lucide-react";
import { SwipeActions, SwipeActionsRow, type SwipeAction } from "@/components/ui/swipe-actions/swipe-actions";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useApi } from "@/lib/client/api";
import { humanize, relTime } from "@/lib/client/format";
import { cn } from "@/lib/client/cn";
import { Reveal } from "./sections";

interface AuditEventRow {
  id: string;
  seq: number;
  missionId: string | null;
  actor: string;
  eventType: string;
  outcome: string;
  createdAt: string;
}

const OUTCOME_TONE: Record<string, string> = {
  SUCCESS: "text-success",
  FAILURE: "text-critical",
  DENIED: "text-critical",
  BLOCKED: "text-warning",
  INFO: "text-muted",
};

/**
 * Recent audit events for this session. Swipe actions here only change what this list shows (reviewed marks,
 * hiding) or navigate to the full record; nothing touches the audit log, a mission or a payment.
 */
export function ActivitySection() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApi<{ events: AuditEventRow[] }>("/api/audit?take=6");
  const [reviewed, setReviewed] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<string[]>([]);

  const events = (data?.events ?? []).filter((e) => !hidden.includes(e.id));
  const lastHidden = hidden.at(-1);

  const toggleReviewed = (id: string) =>
    setReviewed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section id="activity" aria-labelledby="activity-title" className="relative mx-auto max-w-[1440px] scroll-mt-20 px-5 py-28 md:px-10 md:py-36">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Reveal>
          <p className="tech-label mb-5 flex items-center gap-3 !text-cyan">
            <span className="h-px w-10 bg-cyan/60" aria-hidden /> Audit trail
          </p>
          <h2 id="activity-title" className="editorial max-w-[14ch] text-4xl md:text-6xl">
            Every decision, <span className="text-fg/45">on the record.</span>
          </h2>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
            These are the latest audit events for your session, read from the same hash-chained log the console uses. Swipe a row — or use its menu — to mark it reviewed, hide it from this list, or open the full record.
          </p>
          <p className="mt-4 max-w-md text-[13px] leading-relaxed text-faint">
            Marks and hiding apply only to this view. The audit log itself is append-only, and no gesture here can approve, capture or change a payment.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <ErrorState error={error} retry={() => mutate()} />
          {isLoading && !data ? (
            <div className="space-y-2 rounded-[6px] border border-line p-4" aria-busy="true">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : data && data.events.length === 0 ? (
            <div className="rounded-[6px] border border-dashed border-line-strong px-6 py-12 text-center">
              <p className="text-[15px] font-medium">No activity in this session yet</p>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">Run the demo mission and its parse, scout, risk, policy and approval events will appear here.</p>
              <Link href="/missions/new?scenario=robotics-lab" className="mt-5 inline-block text-sm text-cyan underline-offset-4 hover:underline">
                Start the robotics-lab demo mission
              </Link>
            </div>
          ) : data ? (
            <>
              <SwipeActions label="Recent audit events">
                {events.map((e) => {
                  const isReviewed = reviewed.has(e.id);
                  const title = humanize(e.eventType.replace(/\./g, "_"));
                  const leading: SwipeAction[] = [
                    { label: isReviewed ? "Unmark" : "Reviewed", icon: isReviewed ? <RotateCcw aria-hidden /> : <Check aria-hidden />, tone: "accent", keepRow: true, onSelect: () => toggleReviewed(e.id) },
                  ];
                  const trailing: SwipeAction[] = [
                    { label: "Open", icon: <ScrollText aria-hidden />, keepRow: true, onSelect: () => router.push(e.missionId ? `/audit?missionId=${encodeURIComponent(e.missionId)}` : "/audit") },
                    { label: "Hide", icon: <EyeOff aria-hidden />, onSelect: () => setHidden((h) => [...h, e.id]) },
                  ];
                  return (
                    <SwipeActionsRow key={e.id} label={title} leading={leading} trailing={trailing}>
                      <div className="flex items-center gap-3">
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", isReviewed ? "bg-success" : "bg-line-strong")} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-[14px]", isReviewed ? "text-muted" : "text-fg")}>
                            {title}
                            {isReviewed && <span className="sr-only"> (reviewed)</span>}
                          </p>
                          <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10.5px] tracking-[0.08em] text-faint">
                            <span className={OUTCOME_TONE[e.outcome] ?? "text-muted"}>{e.outcome}</span>
                            <span>{e.actor}</span>
                            <span>#{e.seq}</span>
                            <time dateTime={e.createdAt}>{relTime(e.createdAt)}</time>
                          </p>
                        </div>
                      </div>
                    </SwipeActionsRow>
                  );
                })}
              </SwipeActions>
              <div className="mt-3 flex min-h-9 flex-wrap items-center justify-between gap-3 text-sm">
                <p aria-live="polite" className="text-muted">
                  {lastHidden ? `${hidden.length} hidden from this list.` : events.length === 0 ? "All recent events are hidden." : ""}
                </p>
                <div className="flex items-center gap-4">
                  {lastHidden && (
                    <button type="button" onClick={() => setHidden((h) => h.slice(0, -1))} className="inline-flex items-center gap-1.5 text-cyan hover:underline">
                      <Undo2 className="h-3.5 w-3.5" aria-hidden /> Undo
                    </button>
                  )}
                  <Link href="/audit" className="text-muted underline-offset-4 hover:text-fg hover:underline">
                    Full audit log
                  </Link>
                </div>
              </div>
            </>
          ) : null}
        </Reveal>
      </div>
    </section>
  );
}
