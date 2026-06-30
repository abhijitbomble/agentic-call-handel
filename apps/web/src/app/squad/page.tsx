import { SectionHeader } from "@/components/section-header";
import { SquadDashboard } from "@/components/squad-dashboard";
import { getDashboardBundle } from "@/lib/api";
import { backendRequest } from "@/lib/backend-proxy";

type AgentStatus = {
  id: string;
  name: string;
  language: string;
  style: string;
  status: "idle" | "busy" | "escalated";
  current_call_id: string | null;
  calls_handled_today: number;
  escalations_today: number;
};

export default async function SquadPage() {
  const [agents, bundle] = await Promise.all([
    backendRequest<AgentStatus[]>("/squad/status"),
    getDashboardBundle(),
  ]);

  const org = bundle.organizations[0];
  const program = bundle.programs[0];
  const queue = bundle.queues[0];

  const idleCount = agents.filter((agent) => agent.status === "idle").length;
  const busyCount = agents.filter((agent) => agent.status === "busy").length;

  return (
    <div className="page-stack">
      <SectionHeader
        title="Agent Squad"
        description="Six autonomous AI agents each handle one complete customer call from greeting to resolution. They verify identity, look up cases, file tickets, schedule callbacks, and only escalate when they genuinely cannot help."
        meta={`${idleCount} available · ${busyCount} on call · ${agents.length} total agents`}
      />

      {org && program && queue ? (
        <SquadDashboard
          organizationId={org.id}
          clientProgramId={program.id}
          queueId={queue.id}
          initialAgents={agents}
        />
      ) : (
        <div className="empty-state">
          <p className="empty-state-title">No program configured</p>
          <p className="empty-state-desc">Create a client program and queue first to use the agent squad.</p>
        </div>
      )}
    </div>
  );
}

