import { MissionsList } from "@/components/mission/missions-list";

export const metadata = { title: "Missions" };

export default async function MissionsPage({ searchParams }: PageProps<"/missions">) {
  const sp = await searchParams;
  return <MissionsList initialStatus={typeof sp.status === "string" ? sp.status : ""} />;
}
