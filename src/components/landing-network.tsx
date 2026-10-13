"use client";
import { NetworkView } from "@/components/three/network-view";

/** Idle network on the landing page: no fabricated activity, nodes are inspectable. */
export function LandingNetwork() {
  return (
    <NetworkView
      vm={null}
      height="h-[340px] sm:h-[420px]"
      caption="Idle network. Activity appears only when a real mission runs."
      nodeInfo={{
        core: { title: "AEGIS Core", lines: ["Bounded, resumable step runner", "Cannot create orders or move money"] },
        interpreter: { title: "Mission Interpreter", lines: ["Turns text into a proposal", "User must confirm every field"] },
        scout: { title: "Scout", lines: ["Searches the product provider", "Demo catalogue: fictional sellers"] },
        risk: { title: "Risk engine", lines: ["Deterministic scoring 0–100", "Missing evidence = worst case"] },
        optimizer: { title: "Optimizer", lines: ["Ranks eligible offers only", "Weights live in the versioned policy"] },
        policy: { title: "Policy Guard", lines: ["Pure function, hard-coded floor", "BLOCK > REQUIRE APPROVAL > ALLOW"] },
        human: { title: "Human approver", lines: ["Approves the exact purchase", "Snapshot-hashed, expiring approval"] },
        paypal: { title: "PayPal", lines: ["Sandbox by default", "Server-verified order and capture"] },
      }}
    />
  );
}
