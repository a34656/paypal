export { formatMoney } from "@/lib/money";

export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function relTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");
