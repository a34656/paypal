"use client";

import { FlaskConical, Lock } from "lucide-react";
import { cn } from "@/lib/client/cn";

interface PaymentHeaderProps {
  mode: string | null | undefined;
  missionId: string;
  simulated?: boolean;
}

export function PaymentHeader({ mode, missionId, simulated }: PaymentHeaderProps) {
  const env = simulated ? "DEMO · SIMULATED" : mode === "SANDBOX" ? "SANDBOX" : mode === "LIVE" ? "LIVE" : "SANDBOX";
  const envTone = mode === "LIVE" && !simulated ? "text-critical" : simulated ? "text-purple" : "text-blue";

  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-purple/15 border border-purple/25">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 4L8 13L13 4" stroke="#9d8cf2" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <p className="font-mono text-sm font-semibold tracking-[0.04em] text-fg">VANTA AI</p>
            <p className="font-mono text-[9px] tracking-[0.18em] text-faint uppercase">Trust Layer for Agentic Commerce</p>
          </div>
        </div>

        {/* Right badges */}
        <div className="flex items-center gap-3">
          <span className={cn("flex items-center gap-1.5 rounded-full border border-current/20 bg-current/8 px-2.5 py-1 font-mono text-[10px] font-medium tracking-[0.14em] uppercase", envTone)}>
            {simulated ? <FlaskConical className="h-3 w-3" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current animate-aegis-pulse" aria-hidden />}
            {env}
          </span>
          <span className="hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-faint sm:flex uppercase">
            <Lock className="h-3 w-3 text-success" aria-hidden />
            Secure Checkout
          </span>
          <span className="hidden font-mono text-[9px] text-faint sm:block">
            #{missionId.slice(0, 8).toUpperCase()}
          </span>
        </div>
      </div>
    </header>
  );
}

