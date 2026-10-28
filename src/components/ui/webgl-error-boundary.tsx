"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Catches render-time failures inside a WebGL subtree (context creation, shader compile, texture load)
 * and swaps in a static fallback, so a broken canvas never takes the surrounding page down with it.
 */
export class WebGLErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onError?: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error);
    if (process.env.NODE_ENV !== "production") console.warn("[webgl] scene replaced by fallback:", error.message, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Static, decorative stand-in for a canvas: graphite depth, a faint grid and a soft cyan pool. Content around it stays in the DOM. */
export function WebGLFallback({ className, label }: { className?: string; label?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-[radial-gradient(70%_60%_at_50%_45%,rgb(111_227_238/0.10),transparent_70%),linear-gradient(180deg,#0b0d12,#050608)]",
        className,
      )}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      <div className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(60%_60%_at_50%_50%,black,transparent)]" />
    </div>
  );
}
