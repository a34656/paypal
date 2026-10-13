"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, BarChart3, Bell, Bot, FileClock, LayoutDashboard, ListChecks, Menu, Receipt, Settings, ShieldHalf, X } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { AegisWordmark } from "./logo";
import { IdentityMenu, type SessionInfo } from "./identity-menu";

const NAV = [
  { href: "/command-center", label: "Command Center", icon: LayoutDashboard },
  { href: "/missions", label: "Missions", icon: ListChecks },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/policies", label: "Policies", icon: ShieldHalf },
  { href: "/transactions", label: "Transactions", icon: Receipt },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/audit", label: "Audit", icon: FileClock },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data: session } = useApi<SessionInfo>("/api/session");
  const { data: missions } = useApi<{ items: { displayStatus: string }[] }>("/api/missions?take=100", { refreshInterval: 10_000 });
  const pending = missions?.items.filter((m) => m.displayStatus === "AWAITING_APPROVAL").length ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-bg bg-grid">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-cyan focus:px-3 focus:py-1 focus:text-bg">
        Skip to content
      </a>
      {session && !session.paypalConnected && (
        <div role="status" className="border-b border-purple/30 bg-purple/10 px-4 py-1.5 text-center text-xs font-semibold tracking-[0.12em] text-purple">
          DEMO MODE — PAYPAL NOT CONNECTED · payments are simulated and no money moves ·{" "}
          <Link href="/settings" className="underline underline-offset-2">
            configure Sandbox
          </Link>
        </div>
      )}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-3 backdrop-blur md:px-5">
        <button className="rounded p-1.5 text-muted hover:text-fg md:hidden" onClick={() => setOpen((o) => !o)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <Link href="/" aria-label="AEGIS home">
          <AegisWordmark />
        </Link>
        <div className="ml-4 hidden items-center gap-2 text-xs text-muted lg:flex">
          <Activity className="h-3.5 w-3.5 text-success" aria-hidden />
          <span>System nominal</span>
          <span className="text-line-strong">|</span>
          <span>
            Mode:{" "}
            <strong className={session?.mode === "SANDBOX" ? "text-blue" : "text-purple"}>{session?.mode === "SANDBOX" ? "PayPal Sandbox" : session?.mode === "LIVE" ? "LIVE" : "Demo (simulated)"}</strong>
          </span>
          <span className="text-line-strong">|</span>
          <span>AI: {session?.aiConnected ? "Anthropic" : "deterministic fallback"}</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Link href="/missions?status=AWAITING_APPROVAL" className="relative rounded-md p-2 text-muted hover:bg-elevated hover:text-fg" aria-label={`${pending} pending approvals`}>
            <Bell className="h-4.5 w-4.5" />
            {pending > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-warning px-1 text-center font-mono text-[10px] font-bold text-bg">{pending}</span>}
          </Link>
          <Link href="/settings" className="rounded-md p-2 text-muted hover:bg-elevated hover:text-fg" aria-label="Settings">
            <Settings className="h-4.5 w-4.5" />
          </Link>
          <IdentityMenu session={session} />
        </div>
      </header>
      <div className="flex flex-1">
        <nav
          aria-label="Primary"
          className={cn(
            "fixed inset-y-0 left-0 top-14 z-20 w-56 shrink-0 border-r border-line bg-bg-2/95 p-3 transition-transform md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors", active ? "bg-cyan/10 text-cyan" : "text-muted hover:bg-elevated hover:text-fg")}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                    {label === "Missions" && pending > 0 && <span className="ml-auto rounded bg-warning/15 px-1.5 font-mono text-[10px] text-warning">{pending}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-6 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
            The AI proposes. The policy engine enforces. A human authorizes. PayPal processes. The audit log remembers.
          </p>
        </nav>
        <main id="main" className="min-w-0 flex-1 px-3 py-5 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
