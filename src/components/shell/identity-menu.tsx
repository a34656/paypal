"use client";
import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";
import { useSWRConfig } from "swr";
import { apiFetch } from "@/lib/client/api";

export interface SessionInfo {
  user: { id: string; displayName: string; roles: string[] };
  mode: "DEMO" | "SANDBOX" | "LIVE";
  paypalConnected: boolean;
  aiConnected: boolean;
  demoAuthNotice: string;
}

export function IdentityMenu({ session }: { session: SessionInfo | undefined }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { mutate } = useSWRConfig();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const isApprover = session?.user.roles.includes("APPROVER") ?? false;
  const toggle = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/session/roles", { method: "POST", body: { approver: !isApprover } });
      await mutate("/api/session");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-elevated hover:text-fg">
        <UserRound className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">{session?.user.displayName ?? "…"}</span>
      </button>
      {open && session && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-72 rounded-lg border border-line-strong bg-elevated p-3 shadow-2xl">
          <p className="text-sm font-medium">{session.user.displayName}</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted">{session.user.id}</p>
          <div className="mt-2 flex gap-1">
            {session.user.roles.map((r) => (
              <span key={r} className="rounded border border-line-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                {r}
              </span>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2 text-sm">
            <span>
              Approver privileges
              <span className="block text-[11px] text-muted">Toggle to demo role-gated approval</span>
            </span>
            <input type="checkbox" role="menuitemcheckbox" aria-checked={isApprover} checked={isApprover} disabled={busy} onChange={toggle} className="h-4 w-4 accent-[#56E0F0]" />
          </label>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">{session.demoAuthNotice}</p>
        </div>
      )}
    </div>
  );
}
