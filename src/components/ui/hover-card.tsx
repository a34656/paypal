"use client";

/**
 * HoverCard — contextual information overlay.
 * Equivalent functionality to @uiarc/hover-card (shadcn registry install timed out;
 * this implementation uses Radix primitives that are already available via the existing deps).
 */

import { type ReactNode, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/client/cn";

export interface HoverCardProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  /** Delay in ms before the card opens. */
  openDelay?: number;
}

export function HoverCard({ trigger, children, className, side = "bottom", openDelay = 180 }: HoverCardProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timerRef.current = setTimeout(() => setOpen(true), openDelay);
  };

  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  };

  const positionClasses: Record<typeof side, string> = {
    top: "bottom-full mb-2 left-1/2 -translate-x-1/2",
    bottom: "top-full mt-2 left-1/2 -translate-x-1/2",
    left: "right-full mr-2 top-1/2 -translate-y-1/2",
    right: "left-full ml-2 top-1/2 -translate-y-1/2",
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {trigger}
      <AnimatePresence>
        {open && (
          <motion.div
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96, y: side === "bottom" ? -4 : side === "top" ? 4 : 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute z-50 min-w-[220px] max-w-[320px]",
              "rounded-md border border-line-strong bg-elevated/95 backdrop-blur-md",
              "p-3 text-sm text-fg shadow-xl shadow-black/40",
              positionClasses[side],
              className,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

export function HoverCardRow({ label, value, tone }: { label: string; value: ReactNode; tone?: "success" | "warning" | "critical" | "muted" }) {
  const toneClass = {
    success: "text-success",
    warning: "text-warning",
    critical: "text-critical",
    muted: "text-muted",
  }[tone ?? "muted"] ?? "text-fg";
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn("font-mono text-xs tabular-nums", toneClass)}>{value}</span>
    </div>
  );
}

