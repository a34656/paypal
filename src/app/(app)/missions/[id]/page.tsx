import { MissionDetail } from "@/components/mission/mission-detail";
import type { ComposerDraft } from "@/components/mission/confirm-form";

export const metadata = { title: "Mission" };

const num = (v: unknown) => (typeof v === "string" && /^\d{1,6}$/.test(v) ? Number(v) : undefined);
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : undefined);

export default async function MissionPage({ params, searchParams }: PageProps<"/missions/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  // Values from the structured composer. They only pre-fill the confirmation form.
  const draft: ComposerDraft = { quantity: num(sp.qty), budget: str(sp.budget, 20), currency: str(sp.cur, 3), deadlineDays: num(sp.days) ?? null, tolerance: str(sp.tol, 20) };
  return <MissionDetail id={id} draft={draft} />;
}
