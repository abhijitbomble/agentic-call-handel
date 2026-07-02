import Link from "next/link";

import { AutoRefresh } from "@/components/auto-refresh";
import { HandoffActions } from "@/components/handoff-actions";
import { StatCard } from "@/components/stat-card";
import { getDashboardBundle, getTranscript } from "@/lib/api";
import type { Call, CallTurn } from "@/lib/types";

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    "AI in Progress": "badge-ai-progress",
    Verifying: "badge-verifying",
    "Handoff Requested": "badge-handoff",
    "Agent Joined": "badge-agent-joined",
    Escalated: "badge-escalated",
    Callback: "badge-callback",
    Resolved: "badge-resolved",
  };

  return map[status] ?? "badge-open";
}

function reviewStatusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: "badge-pending",
    reviewed: "badge-reviewed",
    in_review: "badge-in_review",
  };

  return map[status] ?? "badge-open";
}

function reviewStatusLabel(status: string): string {
  if (status === "in_review") return "In Review";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function DonutChart({ items }: { items: { count: number; color: string }[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const radius = 46;
  const circumference = 2 * Math.PI * radius;

  const slices = items.reduce<
    { accumulated: number; slices: Array<{ count: number; color: string; dash: number; dashoffset: number }> }
  >(
    (result, item) => {
      const dash = (item.count / total) * circumference;
      const dashoffset = circumference / 4 - result.accumulated;

      return {
        accumulated: result.accumulated + dash,
        slices: [...result.slices, { ...item, dash, dashoffset }],
      };
    },
    { accumulated: 0, slices: [] },
  ).slices;

  return (
    <svg viewBox="0 0 120 120" width="120" height="120">
      {slices.map((slice, index) => (
        <circle
          key={index}
          cx={60}
          cy={60}
          r={radius}
          fill="none"
          stroke={slice.color}
          strokeWidth="14"
          strokeDasharray={`${slice.dash} ${circumference - slice.dash}`}
          strokeDashoffset={slice.dashoffset}
        />
      ))}
    </svg>
  );
}

function ActiveHandoffPanel({ call, transcript }: { call: Call; transcript: CallTurn[] }) {
  const recent = transcript.slice(-3);

  return (
    <div className="handoff-panel">
      <div className="handoff-header">
        <div className="handoff-title-group">
          <span className="handoff-dot" />
          <span className="handoff-title">Active Handoff</span>
          <span className="handoff-count">1</span>
        </div>
        <svg viewBox="0 0 20 20" fill="none" width="16" height="16" style={{ color: "var(--muted)", cursor: "pointer" }}>
          <path d="M5 12l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>

      <div className="handoff-body">
        <div className="handoff-meta">
          <div className="handoff-field">
            <span className="handoff-field-label">Call ID</span>
            <span className="handoff-field-value handoff-call-id">{call.display_call_id ?? call.id}</span>
          </div>
          <div className="handoff-field">
            <span className="handoff-field-label">Program</span>
            <span className="handoff-field-value">{call.program_name ?? "—"}</span>
          </div>
          <div className="handoff-field">
            <span className="handoff-field-label">Customer</span>
            <div>
              <span className="handoff-field-value">{call.customer_name ?? "—"}</span>
              <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>{call.customer_phone}</div>
            </div>
          </div>
          <div className="handoff-field">
            <span className="handoff-field-label">Duration</span>
            <span className="handoff-field-value">{call.duration_label ?? "—"}</span>
          </div>
        </div>

        <div className="handoff-reason">
          <div className="handoff-reason-label">Reason</div>
          <div className="handoff-reason-text">{call.escalation_reason || "Customer requested human"}</div>
        </div>

        <div className="handoff-summary">
          <div className="handoff-summary-label">AI Summary</div>
          <div className="handoff-summary-text">{call.summary}</div>
        </div>

        {recent.length > 0 && (
          <div className="handoff-transcript">
            <div className="handoff-transcript-label">Conversation Snapshot</div>
            {recent.map((turn) => (
              <div
                key={turn.id}
                className={`handoff-bubble ${turn.speaker === "ai" ? "handoff-bubble-ai" : "handoff-bubble-customer"}`}
              >
                {turn.message}
              </div>
            ))}
            <Link href="/calls" className="handoff-transcript-link">
              Open full transcript →
            </Link>
          </div>
        )}

        <HandoffActions callId={call.id} />
      </div>
    </div>
  );
}

export default async function HomePage() {
  const data = await getDashboardBundle();

  const activeCalls = data.calls.filter((call) => call.status === "active");
  const activeHandoff = activeCalls.find((call) => call.handoff_mode === "live");
  const handoffTranscript = activeHandoff ? await getTranscript(activeHandoff.id) : [];

  const dispositionItems = data.analytics.dispositions.map((item) => ({
    count: item.count,
    color: item.color ?? "#94a3b8",
    label: item.label,
  }));
  const totalDispositions = dispositionItems.reduce((sum, item) => sum + item.count, 0);
  const maxIntent = Math.max(...data.analytics.top_intents.map((item) => item.count));

  const resolvedDelta = data.analytics.resolved_today - data.analytics.resolved_yesterday;
  const escalationsDelta = data.analytics.escalations_today - data.analytics.escalations_yesterday;

  function trendLabel(delta: number, unit = "vs yesterday"): string {
    const arrow = delta > 0 ? "↑" : "↓";
    const sign = delta > 0 ? "+" : "";
    return `${arrow} ${sign}${delta} ${unit}`;
  }

  return (
    <div className="page-content">
      <AutoRefresh intervalMs={30_000} />

      <div className="dashboard-home-hero panel">
        <div className="panel-header dashboard-home-hero-header">
          <div className="panel-title-group">
            <span className="panel-title">Operations overview</span>
            <span className="panel-count-badge">Live</span>
          </div>
          <div className="row-meta" style={{ gap: 10 }}>
            <span>{data.organizations.length} organizations</span>
            <span>{data.programs.length} programs</span>
            <span>{data.queues.length} queues</span>
          </div>
        </div>
        <div className="dashboard-home-hero-body">
          <div className="dashboard-home-hero-copy">
            <h1>VoiceOps Control Center</h1>
            <p>
              A live operating console for calls, callbacks, QA, and AI policy. The workspace stays focused on what needs attention now while the
              agent runtime handles the call path in the background.
            </p>
          </div>
          <div className="dashboard-home-hero-metrics">
            <div className="dashboard-home-hero-metric">
              <span className="dashboard-home-hero-label">Active calls</span>
              <strong>{data.analytics.live_calls}</strong>
            </div>
            <div className="dashboard-home-hero-metric">
              <span className="dashboard-home-hero-label">Pending callbacks</span>
              <strong>{data.analytics.callbacks_pending}</strong>
            </div>
            <div className="dashboard-home-hero-metric">
              <span className="dashboard-home-hero-label">QA queue</span>
              <strong>{data.analytics.qa_pending}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="kpi-row">
        <StatCard
          icon="phone"
          tone="accent"
          label="Live Calls"
          value={data.analytics.live_calls}
          detail={`${data.analytics.queue_depth} in queue`}
        />
        <StatCard
          icon="check"
          tone="success"
          label="Resolved Today"
          value={data.analytics.resolved_today}
          trend={resolvedDelta !== 0 ? trendLabel(resolvedDelta) : undefined}
          trendUp={resolvedDelta >= 0}
        />
        <StatCard
          icon="clock"
          tone="warning"
          label="Avg Handle Time"
          value={data.analytics.avg_handle_time}
          detail="per call today"
        />
        <StatCard
          icon="star"
          tone="info"
          label="CSAT Score"
          value={data.analytics.csat_score > 0 ? data.analytics.csat_score.toFixed(1) : "—"}
          detail="from QA reviews"
        />
        <StatCard
          icon="alert"
          tone="warning"
          label="Escalations"
          value={data.analytics.escalations_today}
          trend={escalationsDelta !== 0 ? trendLabel(escalationsDelta) : undefined}
          trendUp={escalationsDelta < 0}
        />
        <StatCard
          icon="queue"
          tone="info"
          label="Callbacks Pending"
          value={data.analytics.callbacks_pending}
          detail={data.analytics.tickets_open > 0 ? `${data.analytics.tickets_open} tickets open` : "No open tickets"}
        />
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-column dashboard-column-primary">
          <div className="panel dashboard-table-panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <span className="panel-title">Live Calls</span>
                <span className="panel-count-badge panel-count-badge-orange">{activeCalls.length} active</span>
              </div>
              <Link href="/calls" className="panel-link">View all →</Link>
            </div>
            <div className="panel-body">
              <table className="calls-table">
                <thead>
                  <tr>
                    <th>Call ID</th>
                    <th>Program</th>
                    <th>Lang</th>
                    <th>Customer</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Agent</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCalls.map((call) => (
                    <tr key={call.id}>
                      <td>
                        <div className="call-row-id">
                          <svg className="call-phone-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                            <path d="M6.3 3.5h2.5l1.2 3.2-1.8 1.4a12 12 0 0 0 3.6 3.6l1.4-1.8 3.2 1.2v2.5c0 .8-.7 1.5-1.5 1.5A11.4 11.4 0 0 1 3.5 5c0-.8.7-1.5 1.5-1.5" />
                          </svg>
                          <span className="call-id-text">{call.display_call_id ?? call.id}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: "0.77rem", color: "var(--muted)", maxWidth: "90px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {call.program_name ?? call.client_program_id}
                      </td>
                      <td style={{ fontSize: "0.77rem" }}>{call.language}</td>
                      <td>
                        <div className="call-customer">
                          <span className="call-customer-name">{call.customer_name ?? "—"}</span>
                          <span className="call-customer-phone">{call.customer_phone}</span>
                        </div>
                      </td>
                      <td>
                        <span className="call-duration">{call.duration_label ?? "—"}</span>
                      </td>
                      <td>
                        <span className={`badge ${statusBadgeClass(call.display_status ?? "")}`}>
                          {call.display_status ?? call.session_state}
                        </span>
                      </td>
                      <td>
                        {call.agent_initials ? (
                          <div className="agent-chip" title={call.agent_name ?? ""}>
                            {call.agent_initials}
                          </div>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel dashboard-table-panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <span className="panel-title">QA Review</span>
                <span className="panel-count-badge">{data.analytics.qa_pending} pending</span>
              </div>
              <Link href="/reviews" className="panel-link">View all →</Link>
            </div>
            <div className="panel-body">
              <table className="qa-table">
                <thead>
                  <tr>
                    <th>Review ID</th>
                    <th>Program</th>
                    <th>Agent</th>
                    <th>Call ID</th>
                    <th>Date/Time</th>
                    <th>Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reviews.map((review) => (
                    <tr key={review.id}>
                      <td style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--accent-strong)" }}>
                        {review.display_id ?? review.id}
                      </td>
                      <td style={{ fontSize: "0.75rem", color: "var(--muted)", maxWidth: "80px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {review.program_name ?? review.client_program_id}
                      </td>
                      <td style={{ fontSize: "0.78rem" }}>{review.agent_name ?? "—"}</td>
                      <td style={{ fontSize: "0.74rem", color: "var(--accent-strong)" }}>
                        {review.call_display_id ?? review.call_id}
                      </td>
                      <td style={{ fontSize: "0.74rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {review.date_label ?? review.created_at}
                      </td>
                      <td style={{ fontSize: "0.78rem", fontWeight: 700 }}>
                        {review.score != null ? `${review.score}%` : "—"}
                      </td>
                      <td>
                        <span className={`badge ${reviewStatusBadge(review.status)}`}>
                          {reviewStatusLabel(review.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="dashboard-column dashboard-column-secondary">
          {activeHandoff ? (
            <ActiveHandoffPanel call={activeHandoff} transcript={handoffTranscript} />
          ) : (
            <div className="panel dashboard-empty-panel" style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "0.85rem" }}>
              No active handoffs
            </div>
          )}

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Dispositions (Today)</span>
            </div>
            <div className="disposition-chart">
              <div className="disposition-donut">
                <DonutChart items={dispositionItems} />
                <div className="disposition-donut-center">
                  <span className="disposition-total">{totalDispositions}</span>
                  <span className="disposition-total-label">Total</span>
                </div>
              </div>
              <div className="disposition-legend">
                {dispositionItems.map((item) => (
                  <div key={item.label} className="disposition-legend-item">
                    <div className="disposition-legend-left">
                      <span className="disposition-legend-dot" style={{ background: item.color }} />
                      <span className="disposition-legend-name">{item.label}</span>
                    </div>
                    <span className="disposition-legend-count">
                      {item.count} <span className="disposition-legend-pct">({Math.round((item.count / totalDispositions) * 100)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-column dashboard-column-tertiary">
          <div className="panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <span className="panel-title">Callback Queue</span>
                <span className="panel-count-badge">{data.analytics.callbacks_pending} pending</span>
              </div>
              <Link href="/callbacks" className="panel-link">View All →</Link>
            </div>
            <div className="panel-body">
              <table className="callbacks-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Customer</th>
                    <th>Scheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.callbacks.map((callback) => (
                    <tr key={callback.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className={`priority-dot priority-dot-${callback.priority}`} />
                          <div>
                            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "var(--accent-strong)" }}>
                              {callback.display_id ?? callback.id}
                            </div>
                            <div style={{ fontSize: "0.7rem", color: "var(--muted)", marginTop: "1px" }}>
                              {callback.program_name ?? callback.client_program_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: "0.8rem", fontWeight: 600 }}>{callback.customer_name ?? "—"}</td>
                      <td style={{ fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {callback.scheduled_time ?? callback.scheduled_for_label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Top Intents (Today)</span>
            </div>
            <div className="intents-chart">
              {data.analytics.top_intents.map((item) => (
                <div key={item.intent} className="intent-row">
                  <div className="intent-row-header">
                    <span className="intent-name">{item.intent.replaceAll("_", " ")}</span>
                    <span className="intent-count">
                      {item.count} ({item.share}%)
                    </span>
                  </div>
                  <div className="intent-bar-wrap">
                    <div className="intent-bar" style={{ width: `${(item.count / maxIntent) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
