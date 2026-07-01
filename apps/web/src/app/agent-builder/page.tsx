import { AgentBuilderForm } from "@/components/agent-builder-form";
import { getOrganizations, getPrograms } from "@/lib/api";

export default async function AgentBuilderPage() {
  const [orgs, programs] = await Promise.all([getOrganizations(), getPrograms()]);
  const orgName = orgs[0]?.name ?? "My Organization";

  return <AgentBuilderForm orgName={orgName} programs={programs} />;
}
