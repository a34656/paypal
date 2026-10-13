import { MissionDetail } from "@/components/mission/mission-detail";

export const metadata = { title: "Mission" };

export default async function MissionPage({ params }: PageProps<"/missions/[id]">) {
  const { id } = await params;
  return <MissionDetail id={id} />;
}
