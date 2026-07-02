import { AgentBuilderForm } from "@/components/agent-builder-form";
import { SectionHeader } from "@/components/section-header";
import { getDashboardBundle } from "@/lib/api";

export default async function AgentBuilderPage() {
  const bundle = await getDashboardBundle();
  const orgName = bundle.organizations[0]?.name ?? "My Organization";
  const kbCount = bundle.knowledge.length;
  const queueCount = bundle.queues.length;
  const programCount = bundle.programs.length;
  const liveCalls = bundle.analytics.live_calls;
  const pendingCallbacks = bundle.analytics.callbacks_pending;
  const qaPending = bundle.analytics.qa_pending;

  return (
    <div className="page-stack">
      <SectionHeader
        title="Agent Portal"
        description="Manage call handling behavior, knowledge, tools, and escalation rules like a real SaaS control plane. Configure the agent first, then publish it for live calls."
        meta={`${programCount} programs • ${queueCount} queues • ${kbCount} KB docs`}
      />

      <div className="double-grid">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Portal overview</span>
          </div>
          <div style={{ padding: 16, display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
              <div style={{ padding: 14, borderRadius: 14, background: "rgba(15,123,119,0.08)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Programs</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{programCount}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Each program owns its own agent behavior and policy pack.</div>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: "rgba(59,130,246,0.08)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Knowledge docs</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{kbCount}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Uploaded files and articles available to the agent.</div>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: "rgba(245,158,11,0.10)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Queues</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{queueCount}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Routing lanes that own live handoff behavior.</div>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: "rgba(16,185,129,0.10)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>Live work</div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>{liveCalls}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{pendingCallbacks} callbacks and {qaPending} QA reviews pending.</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>What a tenant configures here</div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div style={{ padding: 12, borderRadius: 12, background: "rgba(28,42,43,0.04)" }}>Agent thinking, tone, and response length</div>
                <div style={{ padding: 12, borderRadius: 12, background: "rgba(28,42,43,0.04)" }}>Approved KB documents and topics</div>
                <div style={{ padding: 12, borderRadius: 12, background: "rgba(28,42,43,0.04)" }}>Tools like case lookup, ticket creation, callback, handoff</div>
                <div style={{ padding: 12, borderRadius: 12, background: "rgba(28,42,43,0.04)" }}>Escalation rules and queue ownership</div>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Resource list</span>
          </div>
          <div style={{ padding: 16, display: "grid", gap: 10 }}>
            {bundle.programs.map((program) => {
              const queues = bundle.queues.filter((queue) => queue.client_program_id === program.id);
              const knowledge = bundle.knowledge.filter((doc) => doc.client_program_id === program.id);
              return (
                <div
                  key={program.id}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(28,42,43,0.12)",
                    background: "white",
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div className="row-title-line">
                    <strong>{program.name}</strong>
                    <span className={`badge badge-${program.policy_status === "active" ? "high" : "default"}`}>{program.policy_status ?? "active"}</span>
                  </div>
                  <div className="row-meta">
                    <span>{queues.length} queues</span>
                    <span>{knowledge.length} KB docs</span>
                    <span>Version {String(program.policy_version ?? 1)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                    This is the program-level container for the AI agent, its KB, and its escalation rules.
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AgentBuilderForm orgName={orgName} programs={bundle.programs} />
    </div>
  );
}
