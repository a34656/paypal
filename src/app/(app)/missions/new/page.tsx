import { MissionLauncher } from "@/components/mission/mission-launcher";
import { PageHeader } from "@/components/shell/page-header";
import { Panel, PanelBody } from "@/components/ui/panel";

export const metadata = { title: "New mission" };

export default async function NewMissionPage({ searchParams }: PageProps<"/missions/new">) {
  const sp = await searchParams;
  const scenario = typeof sp.scenario === "string" ? sp.scenario : undefined;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Mission" title="Launch a purchasing mission" subtitle="Describe what you need. AEGIS proposes a structured mission; you confirm it before any agent runs." />
      <Panel>
        <PanelBody>
          <MissionLauncher initialScenario={scenario} />
        </PanelBody>
      </Panel>
    </div>
  );
}
