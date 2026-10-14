"use client";
import { NetworkView } from "@/components/three/network-view";

/** Idle network on the landing page: no fabricated activity, nodes are inspectable. */
export function LandingNetwork() {
  return (
    <NetworkView
      vm={null}
      compact
      height="h-[320px] sm:h-[380px]"
      caption="Idle. Activity appears only when a real mission runs."
      nodeInfo={{
        core: { title: "AEGIS Core", lines: ["Bounded, resumable step runner", "Can propose — cannot create orders or move money"] },
        scout: { title: "Scout", lines: ["Searches Channel3's live retailer catalogue", "Keeps only what the catalogue states"] },
        risk: { title: "Risk", lines: ["Seller, price, delivery, evidence → 0–100", "Unknown is labelled unknown, never safe"] },
        optimizer: { title: "Optimizer", lines: ["Ranks only offers that pass hard gates", "Weights live in the versioned policy"] },
        policy: { title: "Policy Guard", lines: ["Pure function with a hard-coded floor", "BLOCK › REQUIRE APPROVAL › ALLOW"] },
        paypal: { title: "PayPal", lines: ["Activates only after approval and checkout", "Server-verified capture or authorization hold"] },
      }}
    />
  );
}
