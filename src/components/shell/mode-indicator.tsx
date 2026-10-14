"use client";
import { cn } from "@/lib/client/cn";

/** Honest environment indicator. DEMO = simulated payments; SANDBOX = PayPal test money; LIVE never by default. */
export function ModeIndicator({ mode, className }: { mode: "DEMO" | "SANDBOX" | "LIVE" | undefined; className?: string }) {
  const cfg =
    mode === "SANDBOX"
      ? { dot: "bg-blue", text: "text-blue", label: "PayPal Sandbox" }
      : mode === "LIVE"
        ? { dot: "bg-critical", text: "text-critical", label: "LIVE" }
        : mode === "DEMO"
          ? { dot: "bg-purple", text: "text-purple", label: "Demo · simulated" }
          : { dot: "bg-faint", text: "text-faint", label: "Connecting" };
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-[3px] border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]", cfg.text, className)} role="status" aria-label={`Payment environment: ${cfg.label}`}>
      <span className="relative flex h-1.5 w-1.5">
        <span className={cn("absolute inset-0 rounded-full opacity-60 animate-aegis-pulse", cfg.dot)} />
        <span className={cn("relative h-1.5 w-1.5 rounded-full", cfg.dot)} />
      </span>
      {cfg.label}
    </span>
  );
}
