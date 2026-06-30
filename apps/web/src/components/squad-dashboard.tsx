"use client";

import { useEffect, useState } from "react";
import { SquadSession } from "./squad-session";

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

type Props = {
  organizationId: string;
  clientProgramId: string;
  queueId: string;
  initialAgents: AgentStatus[];
};

const STATUS_COLORS: Record<string, string> = {
  idle: "squad-agent-idle",
  busy: "squad-agent-busy-card",
  escalated: "squad-agent-escalated",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Available",
  busy: "On call",
  escalated: "Escalated",
};

const LANG_FLAG: Record<string, string> = {
  Hindi: "🇮🇳",
  English: "🇬🇧",
};

export function SquadDashboard({ organizationId, clientProgramId, queueId, initialAgents }: Props) {
  const [agents, setAgents] = useState<AgentStatus[]>(initialAgents);
  const [showSession, setShowSession] = useState(false);
  const [sessionLang, setSessionLang] = useState("English");

  // Poll squad status every 4 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/squad");
        if (res.ok) {
          const data = await res.json();
          setAgents(data);
        }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const idleCount = agents.filter((a) => a.status === "idle").length;
  const busyCount = agents.filter((a) => a.status === "busy").length;
  const totalHandled = agents.reduce((s, a) => s + a.calls_handled_today, 0);
  const totalEscalated = agents.reduce((s, a) => s + a.escalations_today, 0);

  function startTestSession(lang: string) {
    setSessionLang(lang);
    setShowSession(true);
  }

  if (showSession) {
    return (
      <SquadSession
        organizationId={organizationId}
        clientProgramId={clientProgramId}
        queueId={queueId}
        customerPhone="+91 98765 00001"
        preferredLanguage={sessionLang}
        onClose={() => setShowSession(false)}
      />
    );
  }

  return (
    <div className="squad-dashboard">
      {/* Summary bar */}
      <div className="squad-summary">
        <div className="squad-summary-stat">
          <span className="squad-summary-val squad-val-green">{idleCount}</span>
          <span className="squad-summary-label">Available</span>
        </div>
        <div className="squad-summary-stat">
          <span className="squad-summary-val squad-val-blue">{busyCount}</span>
          <span className="squad-summary-label">On call</span>
        </div>
        <div className="squad-summary-stat">
          <span className="squad-summary-val">{totalHandled}</span>
          <span className="squad-summary-label">Handled today</span>
        </div>
        <div className="squad-summary-stat">
          <span className="squad-summary-val squad-val-amber">{totalEscalated}</span>
          <span className="squad-summary-label">Escalated today</span>
        </div>
      </div>

      {/* Agent cards */}
      <div className="squad-agent-grid">
        {agents.map((agent) => (
          <div key={agent.id} className={`squad-agent-card ${STATUS_COLORS[agent.status] ?? ""}`}>
            <div className="squad-agent-card-top">
              <div className={`squad-agent-avatar ${agent.status === "busy" ? "squad-avatar-pulse" : ""}`}>
                {agent.name[0]}
              </div>
              <div className="squad-agent-info">
                <div className="squad-agent-name">{agent.name}</div>
                <div className="squad-agent-lang">
                  {LANG_FLAG[agent.language] ?? ""} {agent.language}
                </div>
              </div>
              <div className={`squad-status-pill squad-status-${agent.status}`}>
                {agent.status === "busy" && <span className="squad-live-dot" />}
                {STATUS_LABELS[agent.status]}
              </div>
            </div>
            <div className="squad-agent-style">{agent.style}</div>
            <div className="squad-agent-stats">
              <span>{agent.calls_handled_today} calls</span>
              {agent.escalations_today > 0 && (
                <span className="squad-stat-warn">{agent.escalations_today} escalated</span>
              )}
            </div>
            {agent.current_call_id && (
              <div className="squad-agent-call-id">Call: {agent.current_call_id.slice(0, 8)}…</div>
            )}
          </div>
        ))}
      </div>

      {/* Test session panel */}
      <div className="squad-test-panel">
        <h3 className="squad-test-title">Test a single agent session</h3>
        <p className="squad-test-desc">
          Start a conversation to see how an agent handles a call end-to-end — identity verification,
          case lookup, complaints, escalation.
        </p>
        {agents.length === 0 ? (
          <p className="squad-test-busy">
            Squad not loaded yet. Restart the backend server to activate the 6 AI agents, then refresh this page.
          </p>
        ) : (
          <>
            <div className="squad-test-actions">
              <button
                className="squad-test-btn"
                onClick={() => startTestSession("English")}
                disabled={idleCount === 0}
              >
                English session
              </button>
              <button
                className="squad-test-btn squad-test-btn-hi"
                onClick={() => startTestSession("Hindi")}
                disabled={idleCount === 0}
              >
                Hindi session
              </button>
            </div>
            {idleCount === 0 && agents.length > 0 && (
              <p className="squad-test-busy">All agents are currently on calls. Wait for one to become available.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
