"use client";

import { startTransition, useMemo, useState } from "react";

import { LiveCallSession } from "@/components/live-call-session";
import type { Program, Queue } from "@/lib/types";

type SessionPayload = {
  call: {
    id: string;
    summary: string;
    session_state: string;
    verification_state: string;
    disposition: string;
    language: string;
  };
  transcript: {
    id: string;
    speaker: string;
    message: string;
    created_at: string;
  }[];
  events: { type: string }[];
  tool_results: { tool_name: string; status: string; output: Record<string, unknown> }[];
};

type VoiceLabProps = {
  organizationId: string;
  programs: Program[];
  queues: Queue[];
};

type Mode = "text" | "voice";

export function VoiceLab({ organizationId, programs, queues }: VoiceLabProps) {
  const [mode, setMode] = useState<Mode>("voice");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [queueId, setQueueId] = useState(queues[0]?.id ?? "");
  const [phoneNumber, setPhoneNumber] = useState("+919876543210");
  const [preferredLanguage, setPreferredLanguage] = useState("English");
  const [draftMessage, setDraftMessage] = useState("I want the status of claim CLM-9001");
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveActive, setLiveActive] = useState(false);

  const availableQueues = useMemo(
    () => queues.filter((queue) => queue.client_program_id === programId),
    [programId, queues],
  );
  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === programId) ?? programs[0],
    [programId, programs],
  );

  async function startSession() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/voice-lab/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          client_program_id: programId,
          queue_id: queueId,
          customer_phone: phoneNumber,
          preferred_language: preferredLanguage,
        }),
      });
      if (!response.ok) throw new Error("Failed to start the demo session");
      const payload = (await response.json()) as SessionPayload;
      startTransition(() => { setSession(payload); });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to start session");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendTurn() {
    if (!session || draftMessage.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/voice-lab/${session.call.id}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: draftMessage }),
      });
      if (!response.ok) throw new Error("Failed to send the turn");
      const payload = (await response.json()) as SessionPayload;
      startTransition(() => { setSession(payload); setDraftMessage(""); });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to send the turn");
    } finally {
      setSubmitting(false);
    }
  }

  const configForm = (
    <div className="voice-lab-form">
      <label>
        <span>Client program</span>
        <select
          value={programId}
          onChange={(event) => {
            const nextProgramId = event.target.value;
            setProgramId(nextProgramId);
            const nextQueue = queues.find((queue) => queue.client_program_id === nextProgramId);
            if (nextQueue) setQueueId(nextQueue.id);
          }}
        >
          {programs.map((program) => (
            <option key={program.id} value={program.id}>{program.name}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Queue</span>
        <select value={queueId} onChange={(event) => setQueueId(event.target.value)}>
          {availableQueues.map((queue) => (
            <option key={queue.id} value={queue.id}>{queue.name}</option>
          ))}
        </select>
      </label>

      <label>
        <span>Customer phone number</span>
        <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} />
      </label>

      <label>
        <span>Language</span>
        <select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)}>
          <option value="English">English</option>
          <option value="Hindi">Hindi</option>
        </select>
      </label>

      {selectedProgram ? (
        <div className="stack-row">
          <div className="row-title-line">
            <strong>Active playbook</strong>
            <span className="badge badge-default">{selectedProgram.languages.join(" / ")}</span>
          </div>
          <div className="row-meta">
            <span>Verify on: {selectedProgram.verification_policy.required_for.join(", ")}</span>
            <span>Live triggers: {selectedProgram.handoff_policy.live_on.join(", ")}</span>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="voice-lab">
      {/* Mode toggle */}
      <div className="voice-lab-mode-row">
        <button
          type="button"
          className={`voice-lab-mode-btn${mode === "voice" ? " voice-lab-mode-active" : ""}`}
          onClick={() => { setMode("voice"); setLiveActive(false); setSession(null); }}
        >
          🎙️ Live call (voice)
        </button>
        <button
          type="button"
          className={`voice-lab-mode-btn${mode === "text" ? " voice-lab-mode-active" : ""}`}
          onClick={() => { setMode("text"); setLiveActive(false); setSession(null); }}
        >
          ⌨️ Text simulator
        </button>
      </div>

      {/* VOICE MODE */}
      {mode === "voice" && (
        liveActive ? (
          <LiveCallSession
            organizationId={organizationId}
            programId={programId}
            queueId={queueId}
            phoneNumber={phoneNumber}
            language={preferredLanguage}
            onEnd={() => setLiveActive(false)}
          />
        ) : (
          <div className="voice-lab-grid">
            {configForm}
            <div className="voice-lab-session">
              <div className="live-call-start">
                <div className="live-call-start-icon">📞</div>
                <h3 className="live-call-start-title">Live voice call simulator</h3>
                <p className="live-call-start-desc">
                  Speak as the customer — the AI will handle the call, verify identity, look up cases, and respond aloud.
                  Uses your microphone and browser speech synthesis. Works best in Chrome or Edge.
                </p>
                <button className="live-call-dial-btn" onClick={() => setLiveActive(true)}>
                  Dial in
                </button>
                <p className="voice-lab-note">
                  Try phone <code>+919876543210</code> — this customer has a seeded claim case you can look up.
                </p>
              </div>
            </div>
          </div>
        )
      )}

      {/* TEXT MODE */}
      {mode === "text" && (
        <div className="voice-lab-grid">
          <div className="voice-lab-form">
            {configForm}
            <button type="button" onClick={startSession} disabled={submitting}>
              {submitting ? "Starting…" : "Start text session"}
            </button>
            <p className="voice-lab-note">
              Type customer messages to exercise the backend state machine — verification, case lookup, handoff policy.
            </p>
          </div>

          <div className="voice-lab-session">
            {session ? (
              <>
                <div className="detail-hero">
                  <div>
                    <p className="detail-label">Session state</p>
                    <h3>{session.call.session_state.replaceAll("_", " ")}</h3>
                    <p>{session.call.summary}</p>
                  </div>
                  <div className="detail-chip-row">
                    <span className={`badge badge-${session.call.disposition}`}>{session.call.disposition}</span>
                    <span className={`badge badge-${session.call.verification_state}`}>{session.call.verification_state}</span>
                    <span className="badge badge-default">{session.call.language}</span>
                  </div>
                </div>

                <div className="transcript-stack">
                  {session.transcript.map((turn) => (
                    <div key={turn.id} className={`transcript-bubble transcript-${turn.speaker}`}>
                      <span>{turn.speaker}</span>
                      <p>{turn.message}</p>
                    </div>
                  ))}
                </div>

                <div className="voice-lab-composer">
                  <textarea
                    value={draftMessage}
                    onChange={(event) => setDraftMessage(event.target.value)}
                    placeholder="Type the next customer message…"
                    rows={4}
                  />
                  <button type="button" onClick={sendTurn} disabled={submitting}>
                    {submitting ? "Sending…" : "Send"}
                  </button>
                </div>

                <div className="double-grid">
                  <div className="voice-lab-log">
                    <h4>Events</h4>
                    {session.events.map((event, index) => (
                      <div key={`${event.type}-${index}`} className="stack-row">
                        <strong>{event.type}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="voice-lab-log">
                    <h4>Tool calls</h4>
                    {session.tool_results.map((tool, index) => (
                      <div key={`${tool.tool_name}-${index}`} className="stack-row">
                        <div className="row-title-line">
                          <strong>{tool.tool_name}</strong>
                          <span className={`badge badge-${tool.status}`}>{tool.status}</span>
                        </div>
                        <p>{JSON.stringify(tool.output)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="empty-state">Start a session to test the AI call flow from the browser.</p>
            )}
          </div>
        </div>
      )}

      {error ? <p className="voice-lab-error">{error}</p> : null}
    </div>
  );
}
