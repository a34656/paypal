"use client";

/**
 * MoneyInput — minor-unit currency input.
 * Equivalent to @uiarc/money-input.
 * Values are always in minor units (cents for USD): $10.00 = 1000.
 */

import { useId, type ChangeEvent } from "react";
import { cn } from "@/lib/client/cn";
import { CURRENCY_EXPONENTS, type Currency } from "@/lib/money";

export interface MoneyInputProps {
  label?: string;
  /** Current value in minor units. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (minor: number) => void;
  currency?: Currency;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  locale?: string;
  description?: string;
  error?: string;
  className?: string;
  "aria-label"?: string;
}

export function MoneyInput({
  label,
  value,
  defaultValue,
  onValueChange,
  currency = "USD",
  disabled,
  min,
  max,
  step,
  locale = "en-US",
  description,
  error,
  className,
  "aria-label": ariaLabel,
}: MoneyInputProps) {
  const id = useId();
  const exp = CURRENCY_EXPONENTS[currency] ?? 2;
  const divisor = 10 ** exp;

  const toDisplay = (minor: number | undefined) =>
    minor == null ? "" : (minor / divisor).toFixed(exp);

  const fromDisplay = (display: string): number | null => {
    const n = parseFloat(display.replace(/,/g, ""));
    if (isNaN(n) || n < 0) return null;
    return Math.round(n * divisor);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const minor = fromDisplay(e.target.value);
    if (minor === null) return;
    if (min != null && minor < min) return;
    if (max != null && minor > max) return;
    onValueChange?.(minor);
  };

  const currencySymbol = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 })
    .formatToParts(0)
    .find((p) => p.type === "currency")?.value ?? "$";

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id} className="tech-label !text-fg/70">
          {label}
        </label>
      )}
      <div className={cn("relative flex items-center", error && "ring-1 ring-critical rounded-[4px]")}>
        <span className="pointer-events-none absolute left-3 font-mono text-sm text-muted select-none">{currencySymbol}</span>
        <input
          id={id}
          type="number"
          min={min != null ? min / divisor : undefined}
          max={max != null ? max / divisor : undefined}
          step={step != null ? step / divisor : 1 / divisor}
          value={value != null ? toDisplay(value) : undefined}
          defaultValue={defaultValue != null ? toDisplay(defaultValue) : undefined}
          onChange={handleChange}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          aria-describedby={description || error ? `${id}-desc` : undefined}
          aria-invalid={!!error}
          className={cn(
            "h-9 w-full rounded-[4px] border border-line-strong bg-elevated/60 pl-7 pr-3",
            "font-mono text-sm tabular-nums text-fg",
            "placeholder:text-faint",
            "focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/30",
            "disabled:cursor-not-allowed disabled:opacity-45",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
          placeholder={`0.${"0".repeat(exp)}`}
        />
        <span className="pointer-events-none absolute right-3 font-mono text-xs text-faint">{currency}</span>
      </div>
      {(description || error) && (
        <p id={`${id}-desc`} className={cn("text-xs", error ? "text-critical" : "text-muted")}>
          {error ?? description}
        </p>
      )}
    </div>
  );
}

