"use client";

/**
 * HoldToConfirm — deliberate hold-to-authorize interaction.
 * Equivalent to @uiarc/hold-to-confirm.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useReducedMotion } from "motion/react";
import { cn } from "@/lib/client/cn";

export interface HoldToConfirmProps {
  /** Text shown on the button before confirmation. */
  label?: string;
  /** Text shown after confirmation completes. */
  confirmedLabel?: string;
  /** Hold duration in ms. */
  duration?: number;
  /** Visual tone. */
  tone?: "accent" | "success" | "danger";
  /** Called once when the hold duration completes. */
  onConfirm?: () => void;
  disabled?: boolean;
  className?: string;
}

const TONE_STYLES = {
  accent: {
    track: "bg-purple/20 border-purple/30",
    fill: "bg-purple",
    text: "text-purple",
    glow: "shadow-[0_0_24px_-8px_rgb(157_140_242/0.6)]",
  },
  success: {
    track: "bg-success/15 border-success/30",
    fill: "bg-success",
    text: "text-success",
    glow: "shadow-[0_0_24px_-8px_rgb(82_211_163/0.6)]",
  },
  danger: {
    track: "bg-critical/15 border-critical/30",
    fill: "bg-critical",
    text: "text-critical",
    glow: "shadow-[0_0_24px_-8px_rgb(255_93_108/0.6)]",
  },
} as const;

export function HoldToConfirm({
  label = "Hold to Authorize Purchase",
  confirmedLabel = "Authorization Submitted",
  duration = 1400,
  tone = "accent",
  onConfirm,
  disabled,
  className,
}: HoldToConfirmProps) {
  const shouldReduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<"idle" | "holding" | "confirmed">("idle");
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<() => void>(() => {});
  const progressTarget = useMotionValue(0);
  const progress = useSpring(progressTarget, { stiffness: 280, damping: 28, mass: 0.6 });

  const t = TONE_STYLES[tone];

  const stopHold = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
    if (phase === "holding") {
      setPhase("idle");
      progressTarget.set(0);
    }
  }, [phase, progressTarget]);

  const tick = useCallback(() => {
    if (!startRef.current) return;
    const elapsed = Date.now() - startRef.current;
    const pct = Math.min(1, elapsed / duration);
    progressTarget.set(pct);

    if (pct >= 1) {
      setPhase("confirmed");
      onConfirm?.();
      return;
    }
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, [duration, onConfirm, progressTarget]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const startHold = useCallback(() => {
    if (disabled || phase === "confirmed") return;
    if (shouldReduceMotion) {
      // For reduced motion: single click confirms immediately
      setPhase("confirmed");
      onConfirm?.();
      return;
    }
    setPhase("holding");
    startRef.current = Date.now();
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, [disabled, phase, shouldReduceMotion, onConfirm]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const isConfirmed = phase === "confirmed";

  return (
    <div className={cn("relative select-none", className)}>
      {/* Progress track */}
      <div
        className={cn(
          "relative h-12 w-full overflow-hidden rounded-[6px] border",
          t.track,
          disabled && "opacity-40 cursor-not-allowed",
          !disabled && !isConfirmed && "cursor-pointer",
          isConfirmed && t.glow,
        )}
        onMouseDown={!disabled && !isConfirmed ? startHold : undefined}
        onMouseUp={!isConfirmed ? stopHold : undefined}
        onMouseLeave={!isConfirmed ? stopHold : undefined}
        onTouchStart={!disabled && !isConfirmed ? startHold : undefined}
        onTouchEnd={!isConfirmed ? stopHold : undefined}
        role="button"
        aria-label={isConfirmed ? confirmedLabel : label}
        aria-disabled={disabled}
        aria-pressed={isConfirmed}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !disabled && !isConfirmed) {
            startHold();
          }
        }}
        onKeyUp={(e) => {
          if ((e.key === " " || e.key === "Enter") && !isConfirmed) {
            stopHold();
          }
        }}
      >
        {/* Fill bar */}
        <motion.div
          className={cn("absolute inset-y-0 left-0 rounded-[5px] origin-left", t.fill)}
          style={{ scaleX: progress, opacity: isConfirmed ? 1 : 0.85 }}
        />

        {/* Label */}
        <div className="relative z-10 flex h-full items-center justify-center gap-2.5 px-4">
          {!isConfirmed && (
            <motion.div
              animate={{ x: phase === "holding" ? [0, -2, 2, -2, 2, 0] : 0 }}
              transition={{ repeat: phase === "holding" ? Infinity : 0, duration: 0.5 }}
              className={cn("h-4 w-0.5 rounded-full", t.fill)}
              aria-hidden
            />
          )}
          {isConfirmed && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8L6.5 11.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={t.text} />
            </svg>
          )}
          <span className={cn("font-mono text-sm font-medium tracking-[0.02em]", t.text)}>
            {isConfirmed ? confirmedLabel : label}
          </span>
        </div>
      </div>

      {/* Hold instruction */}
      {!isConfirmed && !disabled && (
        <p className="mt-1.5 text-center font-mono text-[10px] text-faint tracking-[0.1em] uppercase">
          {phase === "holding" ? "Keep holding…" : "Press and hold to confirm"}
        </p>
      )}
    </div>
  );
}

