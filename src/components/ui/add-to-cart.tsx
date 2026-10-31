"use client";

/**
 * AddToCart — animated product selection and cart tray component.
 * Uses `motion` and `@number-flow/react` for smooth financial updates.
 */

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import NumberFlow from "@number-flow/react";
import { Check, Plus, ShoppingBag } from "lucide-react";

import { cn } from "@/lib/client/cn";

export interface AddToCartItem {
  id: number | string;
  image: string;
  price: number;
  alt: string;
  title?: string;
}

export type AddToCartImage = string | { src: string; alt: string };

export interface AddToCartLayout {
  columns?: number;
  gap?: "compact" | "normal" | "roomy";
  stackLimit?: number;
}

export interface AddToCartMotion {
  duration?: number;
  strength?: number;
  peak?: number;
}

export interface AddToCartProps {
  items: readonly AddToCartItem[];
  images?: readonly AddToCartImage[];
  currency?: string;
  locale?: string;
  initialItems?: readonly (number | string)[];
  layout?: AddToCartLayout;
  motion?: AddToCartMotion;
  onCartChange?: (selectedIds: (number | string)[], total: number) => void;
  className?: string;
}

export function AddToCart({
  items,
  currency = "USD",
  locale = "en-US",
  initialItems = [],
  layout = { columns: 2, gap: "normal", stackLimit: 4 },
  onCartChange,
  className,
}: AddToCartProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number | string>>(
    () => new Set(initialItems),
  );

  const toggleItem = (id: number | string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (layout.stackLimit && next.size >= layout.stackLimit) {
          return prev;
        }
        next.add(id);
      }
      const selectedArray = Array.from(next);
      const newTotal = items
        .filter((item) => next.has(item.id))
        .reduce((sum, item) => sum + item.price, 0);
      onCartChange?.(selectedArray, newTotal);
      return next;
    });
  };

  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const total = selectedItems.reduce((sum, item) => sum + item.price, 0);

  const gapClass =
    layout.gap === "compact" ? "gap-2" : layout.gap === "roomy" ? "gap-4" : "gap-3";

  return (
    <div className={cn("space-y-4", className)}>
      {/* Product grid */}
      <div
        className={cn(
          "grid",
          gapClass,
          layout.columns === 1
            ? "grid-cols-1"
            : layout.columns === 3
            ? "grid-cols-1 sm:grid-cols-3"
            : "grid-cols-1 sm:grid-cols-2",
        )}
      >
        {items.map((item) => {
          const isSelected = selectedIds.has(item.id);
          return (
            <motion.div
              key={item.id}
              whileHover={{ y: -2 }}
              className={cn(
                "group relative overflow-hidden rounded-[6px] border bg-elevated/40 p-3 transition-colors",
                isSelected ? "border-cyan/50 bg-cyan/[0.04]" : "border-line hover:border-line-strong",
              )}
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-[4px] bg-bg/80">
                {item.image ? (
                  <Image
                    src={item.image}
                    alt={item.alt}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, 320px"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-mono text-[10px] text-faint">
                    NO IMAGE
                  </div>
                )}
              </div>
              <div className="mt-2.5 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-fg">{item.title ?? item.alt}</span>
                <span className="font-mono text-xs tabular-nums text-fg/90">
                  <NumberFlow
                    value={item.price}
                    locales={locale}
                    format={{
                      style: "currency",
                      currency,
                      minimumFractionDigits: 2,
                    }}
                  />
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                className={cn(
                  "mt-2.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-[4px] font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase transition-colors",
                  isSelected
                    ? "bg-cyan text-bg"
                    : "border border-line-strong bg-elevated/70 text-fg hover:border-cyan/40 hover:bg-elevated",
                )}
              >
                {isSelected ? (
                  <>
                    <Check className="h-3 w-3" aria-hidden /> Selected
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" aria-hidden /> Add
                  </>
                )}
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* Cart summary strip */}
      <AnimatePresence>
        {selectedItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="flex items-center justify-between rounded-[6px] border border-cyan/30 bg-cyan/[0.04] p-3 text-xs"
          >
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-cyan" aria-hidden />
              <span className="font-mono text-muted">
                {selectedItems.length} {selectedItems.length === 1 ? "item" : "items"} selected
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="tech-label">Total</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-fg">
                <NumberFlow
                  value={total}
                  locales={locale}
                  format={{
                    style: "currency",
                    currency,
                    minimumFractionDigits: 2,
                  }}
                />
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
