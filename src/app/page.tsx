import { Hero, LandingNav } from "@/components/landing/hero";
import { GuaranteesSection, NetworkSection, ProtocolSection } from "@/components/landing/sections";

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-bg">
      <div className="ambient" aria-hidden />
      <LandingNav />
      <main className="relative z-10">
        <Hero />
        <ProtocolSection />
        <NetworkSection />
        <GuaranteesSection />
      </main>
      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[11px] text-faint md:px-10">
          <p className="max-w-2xl leading-relaxed">
            Hackathon MVP. Runs in a clearly labelled demo mode without credentials and against PayPal Sandbox when configured; live payments are refused by default. AEGIS does not guarantee fraud detection, and an AI&apos;s confidence is never treated as proof of safety.
          </p>
          <p className="font-mono tracking-[0.16em]">AEGIS · AI COMMERCE GUARDIAN</p>
        </div>
      </footer>
    </div>
  );
}
