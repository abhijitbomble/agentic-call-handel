import { SettingsForm } from "@/components/settings-form";
import { getOrganizations, getPrograms } from "@/lib/api";

export default async function SettingsPage() {
  const [orgs, programs] = await Promise.all([getOrganizations(), getPrograms()]);
  const orgName = orgs[0]?.name ?? "My Organization";

  return <SettingsForm orgName={orgName} programs={programs} />;
}
