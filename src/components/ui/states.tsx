import type { ReactNode } from "react";
import { AlertOctagon, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/client/cn";

export function Spinner({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center gap-2 text-sm text-muted", className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-elevated", className)} aria-hidden />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-muted">{icon ?? <Inbox className="h-6 w-6" aria-hidden />}</div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: { message: string; code?: string; correlationId?: string | null } | null | undefined; retry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-critical/30 bg-critical/5 px-4 py-3 text-sm">
      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-critical">{error.code ? `${error.code.replace(/_/g, " ")}: ` : ""}{error.message}</p>
        {error.correlationId && <p className="mt-0.5 font-mono text-xs text-muted">ref {error.correlationId}</p>}
      </div>
      {retry && (
        <button onClick={retry} className="text-xs text-cyan hover:underline">
          Retry
        </button>
      )}
    </div>
  );
}
