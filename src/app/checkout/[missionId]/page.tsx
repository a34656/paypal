import type { Metadata } from "next";
import { CheckoutView } from "@/components/payment/checkout-view";

export const metadata: Metadata = {
  title: "Complete Your Purchase · VANTA Checkout",
  description: "Secure authorization and payment for agentic commerce transactions.",
};

export default async function CheckoutPage({
  params,
}: PageProps<"/checkout/[missionId]">) {
  const { missionId } = await params;
  return <CheckoutView missionId={missionId} />;
}

