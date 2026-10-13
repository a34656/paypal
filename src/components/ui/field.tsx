import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

const base = "w-full rounded-md border border-line-strong bg-bg px-3 py-2 text-sm text-fg placeholder:text-muted/60 focus:border-cyan/60 focus:outline-none disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, "h-9", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "min-h-24 resize-y", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(base, "h-9", className)} {...p} />;
});

export function Field({ label, htmlFor, hint, warning, children }: { label: string; htmlFor: string; hint?: ReactNode; warning?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {warning && <p className="text-xs text-warning">{warning}</p>}
      {hint && !warning && <p className="text-xs text-muted/80">{hint}</p>}
    </div>
  );
}
