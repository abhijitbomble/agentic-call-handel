import { CustomerCallView } from "@/components/customer-call-view";

type Props = { params: Promise<{ token: string }> };

export const metadata = { title: "Support Call | VoiceOps" };

export default async function CustomerCallPage({ params }: Props) {
  const { token } = await params;
  return <CustomerCallView token={token} />;
}
