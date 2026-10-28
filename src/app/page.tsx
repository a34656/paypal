import Link from "next/link";
import { Hero, LandingNav } from "@/components/landing/hero";
import { StorySection } from "@/components/landing/story";
import { AgentsSection } from "@/components/landing/agents";
import { ActivitySection } from "@/components/landing/activity";
import { FinalCta, PaymentsSection, PolicySection } from "@/components/landing/sections";
import { VantaWordmark } from "@/components/shell/logo";

const FOOTER_LINKS = [
  ["/command-center", "Command center"],
  ["/missions", "Missions"],
  ["/policies", "Policies"],
  ["/audit", "Audit log"],
  ["/transactions", "Transactions"],
] as const;

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg">
      <div className="ambient" aria-hidden />
      <LandingNav />
      <main className="relative z-10">
        <Hero />
        <StorySection />
        <AgentsSection />
        <PolicySection />
        <ActivitySection />
        <PaymentsSection />
        <FinalCta />
      </main>
      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-10 md:grid-cols-[1fr_auto] md:px-10">
          <div>
            <VantaWordmark subtitle />
            <p className="mt-5 max-w-2xl text-[11px] leading-relaxed text-faint">
              Hackathon MVP. Runs in a clearly labelled demo mode without credentials and against PayPal Sandbox when configured; live payments are refused by default. VANTA does not guarantee fraud detection, and an AI&apos;s confidence is never treated as proof of safety.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-muted sm:grid-cols-3 md:grid-cols-1">
              {FOOTER_LINKS.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="transition-colors hover:text-fg">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
