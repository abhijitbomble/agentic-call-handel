import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { VoiceLab } from "@/components/voice-lab";
import { CallLinkGenerator } from "@/components/call-link-generator";
import { getOrganizations, getPrograms, getQueues } from "@/lib/api";

export default async function VoiceLabPage() {
  const [organizations, programs, queues] = await Promise.all([getOrganizations(), getPrograms(), getQueues()]);
  const organizationId = organizations[0]?.id ?? "";

  return (
    <div className="page-stack">
      <SectionHeader
        title="Live Call Simulator"
        description="Test internally with the simulator, or send a real call link to a customer — they tap it on their phone and talk directly to the AI. No Twilio, no app, no phone number needed."
        meta="Voice + link-to-call"
      />
      <Panel title="Send call link to customer" subtitle="Customer opens the link on any smartphone browser → taps Start Call → speaks to the AI live">
        <CallLinkGenerator programs={programs} queues={queues} />
      </Panel>
      <Panel title="Internal call simulator" subtitle="Voice mode: your mic is the customer · AI speaks responses aloud · Text mode: type messages">
        <VoiceLab organizationId={organizationId} programs={programs} queues={queues} />
      </Panel>
    </div>
  );
}
