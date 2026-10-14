import type { ReactNode } from "react";
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, Clock, FlaskConical, Info, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { cn } from "@/lib/client/cn";

export type Tone = "neutral" | "cyan" | "blue" | "purple" | "success" | "warning" | "critical";

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong bg-elevated text-muted",
  cyan: "border-cyan/30 bg-cyan/10 text-cyan",
  blue: "border-blue/30 bg-blue/10 text-blue",
  purple: "border-purple/30 bg-purple/10 text-purple",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  critical: "border-critical/30 bg-critical/10 text-critical",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em]", TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Every status carries a text label and an icon, never color alone. */
const STATUS: Record<string, { tone: Tone; label?: string; icon: ReactNode }> = {
  ALLOW_CHECKOUT: { tone: "success", label: "Allow checkout", icon: <ShieldCheck className="h-3 w-3" aria-hidden /> },
  REQUIRE_APPROVAL: { tone: "warning", label: "Requires approval", icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
  BLOCK: { tone: "critical", label: "Block", icon: <Ban className="h-3 w-3" aria-hidden /> },
  BLOCKED: { tone: "critical", icon: <Ban className="h-3 w-3" aria-hidden /> },
  DENIED: { tone: "critical", icon: <XCircle className="h-3 w-3" aria-hidden /> },
  FAILED: { tone: "critical", icon: <XCircle className="h-3 w-3" aria-hidden /> },
  EXPIRED: { tone: "neutral", icon: <Clock className="h-3 w-3" aria-hidden /> },
  CANCELLED: { tone: "neutral", icon: <XCircle className="h-3 w-3" aria-hidden /> },
  INVALIDATED: { tone: "critical", icon: <XCircle className="h-3 w-3" aria-hidden /> },
  REVOKED: { tone: "neutral", icon: <XCircle className="h-3 w-3" aria-hidden /> },
  COMPLETED: { tone: "success", icon: <CheckCircle2 className="h-3 w-3" aria-hidden /> },
  CAPTURED: { tone: "success", icon: <CheckCircle2 className="h-3 w-3" aria-hidden /> },
  CONSUMED: { tone: "success", icon: <CheckCircle2 className="h-3 w-3" aria-hidden /> },
  ACTIVE: { tone: "cyan", icon: <ShieldCheck className="h-3 w-3" aria-hidden /> },
  AWAITING_APPROVAL: { tone: "warning", icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
  AWAITING_CONFIRMATION: { tone: "blue", icon: <Info className="h-3 w-3" aria-hidden /> },
  READY_FOR_CHECKOUT: { tone: "cyan", icon: <ShieldCheck className="h-3 w-3" aria-hidden /> },
  CHECKOUT_IN_PROGRESS: { tone: "blue", icon: <Loader2 className="h-3 w-3" aria-hidden /> },
  CHECKOUT_PENDING: { tone: "blue", icon: <Loader2 className="h-3 w-3" aria-hidden /> },
  CAPTURE_PENDING: { tone: "warning", icon: <Clock className="h-3 w-3" aria-hidden /> },
  CAPTURE_PROVIDER_PENDING: { tone: "warning", icon: <Clock className="h-3 w-3" aria-hidden /> },
  RUNNING: { tone: "blue", icon: <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> },
  QUEUED: { tone: "neutral", icon: <CircleDashed className="h-3 w-3" aria-hidden /> },
  DRAFT: { tone: "neutral", icon: <CircleDashed className="h-3 w-3" aria-hidden /> },
  SUCCESS: { tone: "success", icon: <CheckCircle2 className="h-3 w-3" aria-hidden /> },
  FAILURE: { tone: "critical", icon: <XCircle className="h-3 w-3" aria-hidden /> },
  INFO: { tone: "neutral", icon: <Info className="h-3 w-3" aria-hidden /> },
  LOW: { tone: "success", label: "Low risk", icon: <ShieldCheck className="h-3 w-3" aria-hidden /> },
  MEDIUM: { tone: "warning", label: "Medium risk", icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
  HIGH: { tone: "critical", label: "High risk", icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
  CRITICAL: { tone: "critical", label: "Critical risk", icon: <Ban className="h-3 w-3" aria-hidden /> },
  REFUNDED: { tone: "purple", icon: <Info className="h-3 w-3" aria-hidden /> },
  PARTIALLY_REFUNDED: { tone: "purple", label: "Partially refunded", icon: <Info className="h-3 w-3" aria-hidden /> },
  AUTHORIZE_PENDING: { tone: "warning", label: "Placing hold", icon: <Clock className="h-3 w-3" aria-hidden /> },
  AUTHORIZED: { tone: "cyan", label: "Hold placed", icon: <ShieldCheck className="h-3 w-3" aria-hidden /> },
  HOLD_PLACED: { tone: "cyan", label: "Hold placed", icon: <ShieldCheck className="h-3 w-3" aria-hidden /> },
  SETTLE_PENDING: { tone: "warning", label: "Settling", icon: <Clock className="h-3 w-3" aria-hidden /> },
  DISPUTED: { tone: "warning", icon: <AlertTriangle className="h-3 w-3" aria-hidden /> },
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <Badge className={className}>—</Badge>;
  const s = STATUS[status] ?? { tone: "neutral" as Tone, icon: <Info className="h-3 w-3" aria-hidden /> };
  return (
    <Badge tone={s.tone} icon={s.icon} className={className}>
      {s.label ?? status.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

export function ModeBadge({ mode, simulated }: { mode: string | null | undefined; simulated?: boolean | null }) {
  if (mode === "DEMO" || simulated)
    return (
      <Badge tone="purple" icon={<FlaskConical className="h-3 w-3" aria-hidden />}>
        Demo · simulated
      </Badge>
    );
  if (mode === "SANDBOX") return <Badge tone="blue">PayPal Sandbox</Badge>;
  if (mode === "LIVE") return <Badge tone="critical">Live</Badge>;
  return <Badge>—</Badge>;
}
