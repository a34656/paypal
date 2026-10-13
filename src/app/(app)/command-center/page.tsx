import { CommandCenter } from "@/components/command-center";

export const metadata = { title: "Command Center" };

export default async function CommandCenterPage({ searchParams }: PageProps<"/command-center">) {
  const sp = await searchParams;
  return <CommandCenter scenario={typeof sp.demo === "string" ? sp.demo : undefined} />;
}
