"use client";

import { useEffect, useRef, useState } from "react";

type CallTurn = { id: string; speaker: string; message: string; event_type: string };

type SquadTurnResponse = {
  call_id: string;
  agent_id: string;
  agent_name: string;
  ai_message: string;
  escalated: boolean;
  tool_used: string | null;
  transcript: CallTurn[];
};

type Props = {
  organizationId: string;
  clientProgramId: string;
  queueId: string;
  customerPhone: string;
  preferredLanguage: string;
  onClose: () => void;
};

type SessionState = "idle" | "starting" | "active" | "escalated" | "closed";

export function SquadSession({ organizationId, clientProgramId, queueId, customerPhone, preferredLanguage, onClose }: Props) {
  const [state, setState] = useState<SessionState>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [transcript, setTranscript] = useState<CallTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTool, setLastTool] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  async function startSession() {
    setState("starting");
    setError(null);
    try {
      const response = await fetch("/api/squad/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          client_program_id: clientProgramId,
          queue_id: queueId,
          customer_phone: customerPhone,
          preferred_language: preferredLanguage,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as SquadTurnResponse;
      setCallId(data.call_id);
      setAgentName(data.agent_name);
      setTranscript(data.transcript);
      setState("active");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
      setState("idle");
    }
  }

  async function sendMessage() {
    if (!input.trim() || !callId || busy) return;
    const message = input.trim();
    setInput("");
    setBusy(true);
    setLastTool(null);

    setTranscript((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, speaker: "customer", message, event_type: "message" },
    ]);

    try {
      const response = await fetch(`/api/squad/sessions/${callId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as SquadTurnResponse;
      setTranscript(data.transcript);
      setLastTool(data.tool_used);
      if (data.escalated) {
        setState("escalated");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Turn failed");
    } finally {
      setBusy(false);
    }
  }

  async function closeSession() {
    if (callId) {
      await fetch(`/api/squad/sessions/${callId}/close`, { method: "POST" }).catch(() => {});
    }
    setState("closed");
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  const toolLabels: Record<string, string> = {
    verify_customer_identity: "Verifying identity...",
    lookup_case_status: "Looking up case...",
    search_knowledge_base: "Searching knowledge base...",
    create_complaint_ticket: "Creating ticket...",
    schedule_callback: "Scheduling callback...",
    escalate_to_senior: "Escalating to senior agent...",
  };

  return (
    <div className="squad-session">
      <div className="squad-session-header">
        <div className="squad-session-agent">
          <div className={`squad-agent-avatar ${state === "active" ? "squad-agent-busy" : ""}`}>
            {agentName ? agentName[0] : "?"}
          </div>
          <div>
            <div className="squad-session-agent-name">{agentName || "Connecting..."}</div>
            <div className="squad-session-status">
              {state === "idle" && "Ready to connect"}
              {state === "starting" && "Connecting to agent..."}
              {state === "active" && "Active call"}
              {state === "escalated" && "Escalated to human agent"}
              {state === "closed" && "Call ended"}
            </div>
          </div>
        </div>
        {state === "active" && (
          <button className="squad-end-btn" onClick={closeSession}>End call</button>
        )}
      </div>

      <div className="squad-session-transcript">
        {state === "idle" && (
          <div className="squad-session-empty">
            <p>Testing a single agent session. Click Start to connect to the next available agent.</p>
          </div>
        )}
        {transcript.map((turn) => (
          <div
            key={turn.id}
            className={`squad-turn ${turn.speaker === "ai" ? "squad-turn-ai" : "squad-turn-customer"}`}
          >
            <div className="squad-turn-label">{turn.speaker === "ai" ? agentName : "Customer"}</div>
            <div className={`squad-turn-bubble ${turn.event_type === "escalation" ? "squad-turn-escalation" : ""}`}>
              {turn.message}
            </div>
          </div>
        ))}
        {busy && lastTool && (
          <div className="squad-tool-indicator">
            <span className="squad-tool-spinner" />
            {toolLabels[lastTool] ?? "Processing..."}
          </div>
        )}
        {busy && !lastTool && (
          <div className="squad-tool-indicator">
            <span className="squad-tool-spinner" />
            Agent is typing...
          </div>
        )}
        {state === "escalated" && (
          <div className="squad-escalation-banner">
            This call has been escalated to a senior human agent.
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {error && <div className="live-call-error">{error}</div>}

      {state === "idle" && (
        <div className="squad-session-footer">
          <button className="squad-start-session-btn" onClick={startSession}>
            Start agent session
          </button>
        </div>
      )}
      {state === "starting" && (
        <div className="squad-session-footer">
          <div className="squad-tool-indicator">
            <span className="squad-tool-spinner" /> Connecting to agent...
          </div>
        </div>
      )}
      {state === "active" && (
        <div className="squad-session-footer">
          <textarea
            className="squad-session-input"
            placeholder="Type as the customer... (Enter to send)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={busy}
          />
          <button className="squad-send-btn" onClick={sendMessage} disabled={busy || !input.trim()}>
            {busy ? "..." : "Send"}
          </button>
        </div>
      )}
      {(state === "escalated" || state === "closed") && (
        <div className="squad-session-footer">
          <button className="squad-start-session-btn" onClick={onClose}>
            Back to squad
          </button>
        </div>
      )}
    </div>
  );
}

