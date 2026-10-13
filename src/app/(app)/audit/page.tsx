import { AuditView } from "@/components/audit-view";

export const metadata = { title: "Audit" };

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const sp = await searchParams;
  return <AuditView initialMissionId={typeof sp.missionId === "string" ? sp.missionId : ""} />;
}
