import { getOrganizations } from "@/lib/api";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage() {
  const orgs = await getOrganizations();
  const orgName = orgs[0]?.name ?? "My Organization";

  return <SettingsForm orgName={orgName} />;
}
