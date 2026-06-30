import { Panel } from "@/components/panel";
import { SectionHeader } from "@/components/section-header";
import { Sparkline } from "@/components/sparkline";
import { StatCard } from "@/components/stat-card";
import { getAnalytics } from "@/lib/api";

export default async function AnalyticsPage() {
  const analytics = await getAnalytics();

  return (
    <div className="page-stack">
      <SectionHeader
        title="Analytics"
        description="Resolution, escalation, and sentiment patterns designed for BPO supervisors and program owners."
        meta="Operational metrics"
      />

      <div className="kpi-grid">
        <StatCard label="Resolved today" value={analytics.resolved_today} detail="AI-only or AI-assisted closure" tone="accent" />
        <StatCard label="Open tickets" value={analytics.tickets_open} detail="Supervisor backlog" />
        <StatCard label="Callbacks pending" value={analytics.callbacks_pending} detail="Fallback workload" tone="warning" />
        <StatCard label="Escalations today" value={analytics.escalations_today} detail="Live takeover or callback handoff" />
      </div>

      <div className="double-grid">
        <Panel title="Top intents" subtitle="Where the queue is spending its time">
          <Sparkline values={analytics.top_intents.map((intent) => intent.count)} accent="teal" />
          <div className="stack-list">
            {analytics.top_intents.map((intent) => (
              <div key={intent.intent} className="stack-row">
                <div className="row-title-line">
                  <strong>{intent.intent.replaceAll("_", " ")}</strong>
                  <span className="badge badge-default">{intent.share}%</span>
                </div>
                <div className="row-meta">
                  <span>{intent.count} calls</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Disposition mix" subtitle="How conversations are closing today">
          <Sparkline values={analytics.dispositions.map((item) => item.count)} accent="rust" />
          <div className="stack-list">
            {analytics.dispositions.map((item) => (
              <div key={item.label} className="stack-row">
                <div className="row-title-line">
                  <strong>{item.label}</strong>
                  <span className={`badge badge-${item.label}`}>{item.count}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

