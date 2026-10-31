import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { CheckoutView } from "@/components/payment/checkout-view";
import { prisma } from "@/server/db";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Checkout · VANTA",
  description: "Secure payment gateway for agentic commerce transactions.",
};

export default async function CheckoutRootPage({
  searchParams,
}: PageProps<"/checkout">) {
  const sp = await searchParams;
  const missionId = typeof sp.missionId === "string" ? sp.missionId : typeof sp.id === "string" ? sp.id : null;

  if (missionId) {
    return <CheckoutView missionId={missionId} />;
  }

  // If no mission specified, find recent missions
  const recentMissions = await prisma.mission.findMany({
    take: 8,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      mode: true,
      budgetMinor: true,
      currency: true,
      createdAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <div className="mb-8">
        <Link
          href="/missions"
          className="mb-4 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Return to Dashboard
        </Link>
        <p className="tech-label !text-cyan">VANTA Payment Gateway</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.02em] text-fg">Select a Transaction to Authorize</h1>
        <p className="mt-2 text-sm text-muted">
          Choose an evaluated mission to review trust verification and complete checkout.
        </p>
      </div>

      {recentMissions.length === 0 ? (
        <div className="surface rounded-[var(--radius-panel)] p-8 text-center space-y-4">
          <p className="text-sm text-muted">No missions found. Create a mission first to begin an agent purchase.</p>
          <Link href="/missions/new">
            <Button variant="primary">Create New Mission</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {recentMissions.map((m) => (
            <Link
              key={m.id}
              href={`/checkout/${m.id}`}
              className="surface group flex items-center justify-between gap-4 rounded-[6px] p-4 transition-all hover:border-cyan/40 hover:bg-elevated/70"
            >
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-faint uppercase tracking-[0.14em]">
                  #{m.id.slice(0, 14)} · {m.mode}
                </p>
                <p className="mt-1 truncate text-sm font-medium text-fg group-hover:text-cyan transition-colors">
                  {m.title}
                </p>
                <p className="mt-0.5 text-xs text-muted">Status: {m.status.replace(/_/g, " ").toLowerCase()}</p>
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-cyan shrink-0">
                <span>Checkout</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
