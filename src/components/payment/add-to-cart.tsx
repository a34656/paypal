"use client";

/**
 * AddToCart — Integration adapter for VANTA mission candidate products.
 * Wraps `@/components/ui/add-to-cart` and populates it with real mission products.
 */

import { useMemo } from "react";
import { AddToCart, type AddToCartItem } from "@/components/ui/add-to-cart";
import type { MissionProductDTO } from "@/components/mission/types";
import { CURRENCY_EXPONENTS, type Currency } from "@/lib/money";

interface MissionAddToCartProps {
  products: MissionProductDTO[];
  currency?: string;
  selectedProductId?: string | null;
  onSelectProduct?: (productId: string) => void;
  className?: string;
}

export function MissionAddToCart({
  products,
  currency = "USD",
  selectedProductId,
  onSelectProduct,
  className,
}: MissionAddToCartProps) {
  const exp = CURRENCY_EXPONENTS[currency as Currency] ?? 2;
  const divisor = 10 ** exp;

  const items: AddToCartItem[] = useMemo(() => {
    return products.map((mp) => ({
      id: mp.productId,
      image: mp.product.imageUrl ?? "",
      price: (mp.totalMinor ?? mp.product.unitPriceMinor * mp.quantity) / divisor,
      alt: mp.product.title,
      title: mp.product.title,
    }));
  }, [products, divisor]);

  const initialItems = selectedProductId ? [selectedProductId] : [];

  return (
    <div className={className}>
      <AddToCart
        items={items}
        currency={currency}
        initialItems={initialItems}
        layout={{ columns: 2, gap: "normal", stackLimit: 1 }}
        onCartChange={(cartItems) => {
          if (cartItems.length > 0 && onSelectProduct) {
            onSelectProduct(String(cartItems[0]));
          }
        }}
        className="w-full"
      />
    </div>
  );
}

export { AddToCart };
export type { AddToCartItem } from "@/components/ui/add-to-cart";

