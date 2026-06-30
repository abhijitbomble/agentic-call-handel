import { SupervisorLiveMonitor } from "@/components/supervisor-live-monitor";
import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { getCalls, getCustomers, getTranscript } from "@/lib/api";

export default async function CallsPage() {
  const [calls, customers] = await Promise.all([getCalls(), getCustomers()]);
  const liveCalls = calls.filter((call) => call.status === "active" || call.status === "in_progress");
  const initialTranscripts = Object.fromEntries(
    await Promise.all(liveCalls.map(async (call) => [call.id, await getTranscript(call.id)] as const)),
  );

  return (
    <div className="page-stack">
      <SectionHeader
        title="Live Calls"
        description="Real-time call monitoring with live voice activity, customer speech capture, and transcript playback as each conversation unfolds."
        meta={`${liveCalls.length} active`}
      />
      <Panel
        title="Supervisor monitor"
        subtitle="Watch who is speaking, follow the transcript in real time, and step in only when the business rules require a human handoff"
      >
        <SupervisorLiveMonitor initialCalls={liveCalls} customers={customers} initialTranscripts={initialTranscripts} />
      </Panel>
    </div>
  );
}
