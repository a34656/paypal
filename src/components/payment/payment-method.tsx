"use client";

import { DitherCreditCard } from "@/components/payment/dither-credit-card";
import { cn } from "@/lib/client/cn";

interface PaymentMethodProps {
  mode: string | null | undefined;
  simulated: boolean;
  className?: string;
}

export function PaymentMethod({ mode, simulated, className }: PaymentMethodProps) {
  const cardholderLabel = simulated
    ? "SIMULATED PAYMENT"
    : mode === "SANDBOX"
    ? "PAYPAL SANDBOX"
    : "SECURE PAYMENT";

  return (
    <div className={cn("space-y-3", className)}>
      {/* The Dither card is the primary visual anchor for the payment method */}
      <DitherCreditCard
        colors={{
          accent: "#8B7CFF",
          background: "#171C32",
          details: "#D9DDF0",
          foreground: "#F5F7FB",
        }}
        content={{
          brandName: "VANTA",
          cardNumber: "•••• ••••",
          cardholder: cardholderLabel,
        }}
        dither={{
          shape: "wave",
          type: "8x8",
          speed: 0.22,
          offsetX: 0.55,
          offsetY: 0.42,
          rotation: 6,
          scale: 2.8,
          size: 2,
        }}
        interactive
        physics={{
          mode: "tilt",
          tilt: 5,
          magnetism: 8,
          lift: 5,
          scale: 1.015,
          glare: 0.16,
        }}
        className="max-w-full"
      />
    </div>
  );
}

