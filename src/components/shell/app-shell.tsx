"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BarChart3, Bell, Bot, FileClock, LayoutDashboard, ListChecks, Menu, Plus, Receipt, Settings, ShieldHalf, X } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { VantaWordmark } from "./logo";
import { IdentityMenu, type SessionInfo } from "./identity-menu";
import { ModeIndicator } from "./mode-indicator";

const NAV: { group: string; items: { href: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    group: "Operate",
    items: [
      { href: "/command-center", label: "Command Center", icon: LayoutDashboard },
      { href: "/missions", label: "Missions", icon: ListChecks },
      { href: "/agents", label: "Agents", icon: Bot },
    ],
  },
  {
    group: "Govern",
    items: [
      { href: "/policies", label: "Policies", icon: ShieldHalf },
      { href: "/audit", label: "Audit", icon: FileClock },
    ],
  },
  {
    group: "Ledger",
    items: [
      { href: "/transactions", label: "Transactions", icon: Receipt },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data: session } = useApi<SessionInfo>("/api/session");
  const { data: missions } = useApi<{ items: { displayStatus: string }[] }>("/api/missions?take=100", { refreshInterval: 10_000 });
  const pending = missions?.items.filter((m) => m.displayStatus === "AWAITING_APPROVAL").length ?? 0;

  const navLink = (href: string, label: string, Icon: typeof LayoutDashboard) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-[4px] px-2.5 py-[7px] text-[13px] transition-colors duration-200",
          active ? "bg-cyan/[0.07] text-fg" : "text-muted hover:bg-elevated/70 hover:text-fg",
        )}
      >
        <span className={cn("absolute left-0 top-1.5 bottom-1.5 w-px transition-colors", active ? "bg-cyan" : "bg-transparent")} aria-hidden />
        <Icon className={cn("h-4 w-4", active ? "text-cyan" : "text-faint group-hover:text-muted")} aria-hidden />
        {label}
        {label === "Missions" && pending > 0 && <span className="ml-auto rounded-[3px] bg-warning/15 px-1.5 font-mono text-[10px] text-warning">{pending}</span>}
      </Link>
    );
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <div className="ambient" aria-hidden />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-cyan focus:px-3 focus:py-1 focus:text-bg">
        Skip to content
      </a>
      {session && !session.paypalConnected && (
        <div role="status" className="relative z-40 border-b border-purple/25 bg-purple/[0.08] px-4 py-1.5 text-center font-mono text-[10.5px] tracking-[0.14em] text-purple">
          DEMO MODE — PAYPAL NOT CONNECTED · payments are simulated and no money moves ·{" "}
          <Link href="/settings" className="underline underline-offset-2">
            configure Sandbox
          </Link>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/75 px-3 backdrop-blur-md md:px-5">
        <button className="rounded p-1.5 text-muted hover:text-fg md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/" aria-label="VANTA home">
          <VantaWordmark />
        </Link>
        <div className="ml-5 hidden items-center gap-3 lg:flex">
          <span className="h-4 w-px bg-line-strong" aria-hidden />
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> System nominal
          </span>
          <ModeIndicator mode={session?.mode} />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            AI · <span className={session?.aiConnected ? "text-purple" : "text-muted"}>{session ? (session.aiConnected ? "Gemini" : "Deterministic") : "…"}</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ModeIndicator mode={session?.mode} className="lg:hidden" />
          <Link href="/missions?status=AWAITING_APPROVAL" className="relative rounded-[4px] p-2 text-muted hover:bg-elevated hover:text-fg" aria-label={`${pending} pending approvals`}>
            <Bell className="h-4 w-4" />
            {pending > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-warning px-1 text-center font-mono text-[10px] font-bold text-bg">{pending}</span>}
          </Link>
          <IdentityMenu session={session} />
        </div>
      </header>
      <div className="relative z-10 flex flex-1">
        <nav
          data-demo-target="app-navigation"
          aria-label="Primary"
          className={cn(
            "fixed inset-y-0 left-0 top-14 z-20 flex w-56 shrink-0 flex-col border-r border-line bg-bg/95 p-3 backdrop-blur-md transition-transform duration-300 ease-[var(--ease-cine)] md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:translate-x-0 md:bg-bg/40",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Link
            href="/missions/new"
            onClick={() => setOpen(false)}
            className="mb-4 flex h-9 items-center justify-center gap-2 rounded-[4px] border border-cyan/35 bg-cyan/[0.06] text-[13px] text-cyan transition-colors hover:border-cyan/60 hover:bg-cyan/10"
          >
            <Plus className="h-4 w-4" aria-hidden /> Create mission
          </Link>
          <div className="space-y-4">
            {NAV.map((g) => (
              <div key={g.group}>
                <p className="tech-label mb-1.5 px-2.5 !text-faint">{g.group}</p>
                <ul className="space-y-0.5">
                  {g.items.map(({ href, label, icon }) => (
                    <li key={href}>{navLink(href, label, icon)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-auto space-y-3 border-t border-line pt-3">
            {navLink("/settings", "Settings", Settings)}
            <p className="px-2.5 text-[11px] leading-relaxed text-faint">The AI proposes. Policy enforces. A human authorizes. PayPal processes. The audit log remembers.</p>
          </div>
        </nav>
        {open && <button className="fixed inset-0 top-14 z-10 bg-bg/60 md:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
        <main id="main" className="min-w-0 flex-1 px-3 py-6 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
