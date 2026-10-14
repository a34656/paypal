import { MissionComposer } from "@/components/mission/mission-composer";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody } from "@/components/ui/panel";

export const metadata = { title: "New mission" };

export default async function NewMissionPage({ searchParams }: PageProps<"/missions/new">) {
  const sp = await searchParams;
  const scenario = typeof sp.scenario === "string" ? sp.scenario : undefined;
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr_280px]">
      <div>
        <PageHeader eyebrow="Create mission" title="What should the agents buy?" subtitle="AEGIS turns your request into a structured proposal. You confirm it before any agent runs, and a human approves before any money moves." />
        <Panel>
          <PanelBody className="p-5 md:p-6">
            <MissionComposer initialScenario={scenario} />
          </PanelBody>
        </Panel>
      </div>
      <aside className="space-y-5 pt-2 lg:pt-24" aria-label="What happens next">
        {[
          ["01", "Confirm", "Review the parsed constraints. Raw text never reaches the policy engine."],
          ["02", "Discover & analyze", "Scout searches real retailer offers; Risk scores the evidence."],
          ["03", "Decide", "Policy Guard allows, requires approval, or blocks — deterministically."],
          ["04", "Approve & pay", "A human approves the exact snapshot; PayPal processes server-side."],
        ].map(([n, t, b]) => (
          <div key={n} className="border-l border-line pl-4">
            <p className="font-mono text-[10px] text-faint">{n}</p>
            <p className="mt-1 text-sm text-fg">{t}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">{b}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}
