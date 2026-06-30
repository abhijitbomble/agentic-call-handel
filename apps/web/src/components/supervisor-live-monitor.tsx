"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type { Call, CallTurn, Customer } from "@/lib/types";

type Props = {
  initialCalls: Call[];
  customers: Customer[];
  initialTranscripts: Record<string, CallTurn[]>;
};

type ActiveSpeaker = "customer" | "ai" | null;

type LiveSessionEvent = {
  type?: string;
  call_id?: string;
  speaker?: "customer" | "ai";
  message?: string;
  [key: string]: unknown;
};

const REFRESH_INTERVAL_MS = 4000;
const EMPTY_TRANSCRIPT: CallTurn[] = [];
const WS_BASE =
  typeof window === "undefined"
    ? "ws://127.0.0.1:8020"
    : /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
      ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8020").replace(/^http/, "ws")
      : window.location.origin.replace(/^http/, "ws");

const STATE_LABELS: Record<string, string> = {
  disclosure_consent: "Disclosure",
  language_detected: "Listening",
  verification_if_needed: "Verifying",
  intent_captured: "Understanding",
  answer_or_tool_action: "Responding",
  live_handoff: "Transferring",
  callback: "Callback",
  resolved: "Resolved",
  summary: "Wrapping up",
  closed: "Ended",
};

const STATE_BADGES: Record<string, string> = {
  disclosure_consent: "badge-open",
  language_detected: "badge-low",
  verification_if_needed: "badge-verifying",
  intent_captured: "badge-low",
  answer_or_tool_action: "badge-ai-progress",
  live_handoff: "badge-handoff",
  callback: "badge-callback",
  resolved: "badge-resolved",
  summary: "badge-open",
  closed: "badge-open",
};

const DISPOSITION_BADGES: Record<string, string> = {
  resolved: "badge-resolved",
  escalated: "badge-escalated",
  callback: "badge-callback",
  open: "badge-open",
  ticket_created: "badge-open",
};

function isLiveCall(call: Call): boolean {
  return call.status === "active" || call.status === "in_progress";
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(startedAt: string, nowMs: number): string {
  const delta = Math.max(0, nowMs - new Date(startedAt).getTime());
  const mins = Math.floor(delta / 60000);
  const secs = Math.floor((delta % 60000) / 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\w/g, (match) => match.toUpperCase());
}

function buildCallLabel(call: Call): string {
  return call.display_call_id ?? `C-${call.id.slice(-6).toUpperCase()}`;
}

function activityLabel(speaker: ActiveSpeaker, interim: string): string {
  if (speaker === "customer") return interim ? `Customer speaking ? ${interim}` : "Customer speaking";
  if (speaker === "ai") return "AI answering";
  return "Waiting";
}

function activityTone(speaker: ActiveSpeaker): string {
  if (speaker === "customer") return "customer";
  if (speaker === "ai") return "ai";
  return "idle";
}

function previewText(call: Call, transcript: CallTurn[] | undefined, interim: string): string {
  if (interim) return interim;
  const latestTurn = transcript ? [...transcript].reverse().find((turn) => turn.speaker !== "system") : null;
  if (latestTurn?.message) return latestTurn.message;
  if (call.summary) return call.summary;
  return "Conversation is waiting for the next live turn.";
}

export function SupervisorLiveMonitor({ initialCalls, customers, initialTranscripts }: Props) {
  const [calls, setCalls] = useState(() => initialCalls.filter(isLiveCall));
  const [selectedId, setSelectedId] = useState<string | null>(() => initialCalls.find(isLiveCall)?.id ?? null);
  const [transcriptsByCall, setTranscriptsByCall] = useState<Record<string, CallTurn[]>>(initialTranscripts);
  const [interimByCall, setInterimByCall] = useState<Record<string, string>>({});
  const [activeSpeakerByCall, setActiveSpeakerByCall] = useState<Record<string, ActiveSpeaker>>({});
  const [loadingTranscriptId, setLoadingTranscriptId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [nowMs, setNowMs] = useState(() => Date.now());

  const wsRefs = useRef<Map<string, WebSocket>>(new Map());
  const transcriptRefreshTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const callRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const fetchLiveCalls = useCallback(async (): Promise<Call[]> => {
    const response = await fetch("/api/calls", { cache: "no-store" });
    if (!response.ok) return [];
    const data = (await response.json()) as Call[];
    return data.filter(isLiveCall);
  }, []);

  const fetchTranscript = useCallback(async (callId: string): Promise<CallTurn[] | null> => {
    const response = await fetch(`/api/calls/${callId}/transcript`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as CallTurn[];
  }, []);

  const loadTranscript = useCallback(async (callId: string, force = false) => {
    if (!force && transcriptsByCall[callId]) return;
    setLoadingTranscriptId(callId);
    const transcript = await fetchTranscript(callId);
    if (transcript) {
      setTranscriptsByCall((prev) => ({ ...prev, [callId]: transcript }));
    }
    setLoadingTranscriptId((current) => (current === callId ? null : current));
  }, [fetchTranscript, transcriptsByCall]);

  const refreshCallsNow = useCallback(async () => {
    const liveCalls = await fetchLiveCalls();
    startTransition(() => {
      setCalls(liveCalls);
      setLastRefresh(new Date());
      if (selectedId && !liveCalls.some((call) => call.id === selectedId)) {
        setSelectedId(liveCalls[0]?.id ?? null);
      }
    });
  }, [fetchLiveCalls, selectedId]);

  const scheduleCallRefresh = useCallback(() => {
    if (callRefreshTimerRef.current) clearTimeout(callRefreshTimerRef.current);
    callRefreshTimerRef.current = setTimeout(() => {
      void refreshCallsNow();
    }, 1200);
  }, [refreshCallsNow]);

  const scheduleTranscriptRefresh = useCallback((callId: string) => {
    const existing = transcriptRefreshTimersRef.current.get(callId);
    if (existing) clearTimeout(existing);
    const timeoutId = setTimeout(() => {
      void loadTranscript(callId, true).finally(() => {
        transcriptRefreshTimersRef.current.delete(callId);
      });
    }, 900);
    transcriptRefreshTimersRef.current.set(callId, timeoutId);
  }, [loadTranscript]);

  const handleSocketEvent = useCallback((callId: string, event: LiveSessionEvent) => {
    if (event.type === "speech.started") {
      if (event.speaker === "customer" || event.speaker === "ai") {
        const nextSpeaker: ActiveSpeaker = event.speaker;
        setActiveSpeakerByCall((prev) => ({ ...prev, [callId]: nextSpeaker }));
      }
      return;
    }

    if (event.type === "speech.ended") {
      if (event.speaker === "customer" || event.speaker === "ai") {
        setActiveSpeakerByCall((prev) => {
          const currentSpeaker = prev[callId] ?? null;
          if (currentSpeaker !== event.speaker) return prev;
          return { ...prev, [callId]: null };
        });
      }
      return;
    }

    if (event.type === "transcript.interim") {
      if (event.speaker === "customer" && typeof event.message === "string") {
        const interimMessage = event.message;
        setActiveSpeakerByCall((prev) => ({ ...prev, [callId]: "customer" }));
        setInterimByCall((prev) => ({ ...prev, [callId]: interimMessage }));
      }
      return;
    }

    scheduleCallRefresh();
    scheduleTranscriptRefresh(callId);
  }, [scheduleCallRefresh, scheduleTranscriptRefresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshCallsNow();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshCallsNow]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const liveIds = new Set(calls.map((call) => call.id));
    const wsMap = wsRefs.current;

    for (const [callId, socket] of wsMap.entries()) {
      if (!liveIds.has(callId)) {
        socket.close();
        wsMap.delete(callId);
      }
    }

    for (const call of calls) {
      if (wsMap.has(call.id)) continue;
      try {
        const ws = new WebSocket(`${WS_BASE}/ws/voice-sessions/${call.id}`);
        ws.onmessage = (rawEvent) => {
          try {
            handleSocketEvent(call.id, JSON.parse(rawEvent.data as string) as LiveSessionEvent);
          } catch {
            // Ignore malformed event payloads.
          }
        };
        wsMap.set(call.id, ws);
      } catch {
        // Ignore browser runtime connection issues.
      }
    }
  }, [calls, handleSocketEvent]);

  useEffect(() => {
    const wsMap = wsRefs.current;
    const transcriptTimers = transcriptRefreshTimersRef.current;

    return () => {
      for (const socket of wsMap.values()) socket.close();
      wsMap.clear();

      if (callRefreshTimerRef.current) clearTimeout(callRefreshTimerRef.current);
      callRefreshTimerRef.current = null;

      for (const timeoutId of transcriptTimers.values()) clearTimeout(timeoutId);
      transcriptTimers.clear();
    };
  }, []);

  const effectiveSelectedId = selectedId && calls.some((call) => call.id === selectedId) ? selectedId : calls[0]?.id ?? null;
  const selectedTranscript = effectiveSelectedId ? transcriptsByCall[effectiveSelectedId] ?? EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT;
  const selectedInterim = effectiveSelectedId ? interimByCall[effectiveSelectedId] ?? "" : "";

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [effectiveSelectedId, selectedTranscript, selectedInterim]);

  const selectedCall = effectiveSelectedId ? calls.find((call) => call.id === effectiveSelectedId) ?? null : null;
  const selectedCustomer = selectedCall ? customers.find((customer) => customer.id === selectedCall.customer_id) ?? null : null;
  const selectedSpeaker = effectiveSelectedId ? activeSpeakerByCall[effectiveSelectedId] ?? null : null;

  return (
    <div className="supervisor-monitor">
      <div className="supervisor-monitor-header">
        <span className="supervisor-live-badge">
          <span className="supervisor-live-dot" />
          {calls.length} live conversation{calls.length === 1 ? "" : "s"}
        </span>
        <span className="supervisor-refresh-note">
          Updated {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          {" ? "}live voice activity and transcript refresh running
        </span>
      </div>

      {calls.length === 0 ? (
        <div className="supervisor-empty-state">
          <p className="supervisor-empty-title">No live calls right now</p>
          <p className="supervisor-empty-desc">As soon as a caller connects, this space will switch into a live conversation board with speaker activity and transcript bubbles.</p>
        </div>
      ) : (
        <div className="supervisor-grid">
          <div className="supervisor-call-list">
            {calls.map((call) => {
              const customer = customers.find((item) => item.id === call.customer_id);
              const interim = interimByCall[call.id] ?? "";
              const transcript = transcriptsByCall[call.id];
              const speaker = activeSpeakerByCall[call.id] ?? null;
              const stateLabel = STATE_LABELS[call.session_state] ?? humanize(call.session_state);
              const stateBadge = STATE_BADGES[call.session_state] ?? "badge-open";
              const dispositionBadge = DISPOSITION_BADGES[call.disposition] ?? "badge-open";
              const cardSelected = effectiveSelectedId === call.id;

              return (
                <button
                  key={call.id}
                  type="button"
                  className={`supervisor-call-card${cardSelected ? " supervisor-call-card-active" : ""}`}
                  onClick={() => {
                    startTransition(() => {
                      setSelectedId(call.id);
                    });
                    if (!transcriptsByCall[call.id]) {
                      void loadTranscript(call.id, true);
                    }
                  }}
                >
                  <div className="supervisor-call-card-top">
                    <div>
                      <p className="supervisor-call-card-kicker">{buildCallLabel(call)}</p>
                      <h3 className="supervisor-call-card-name">{customer?.full_name ?? call.customer_phone}</h3>
                    </div>
                    <div className="supervisor-call-card-duration">{formatElapsed(call.started_at, nowMs)}</div>
                  </div>

                  <div className="supervisor-call-card-meta">
                    <span className={`badge ${stateBadge}`}>{stateLabel}</span>
                    <span className={`badge ${dispositionBadge}`}>{humanize(call.disposition)}</span>
                    <span className={`supervisor-activity-pill supervisor-activity-pill-${activityTone(speaker)}`}>
                      {activityLabel(speaker, interim)}
                    </span>
                  </div>

                  <p className="supervisor-call-card-preview">{previewText(call, transcript, interim)}</p>

                  <div className="supervisor-call-card-footer">
                    <span>{call.language}</span>
                    <span>{humanize(call.intent)}</span>
                    <span>{formatClock(call.started_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="supervisor-call-stage">
            {selectedCall ? (
              <div className="supervisor-stage-shell">
                <div className="supervisor-stage-hero">
                  <div>
                    <p className="detail-label">Live Conversation</p>
                    <h3>{selectedCustomer?.full_name ?? selectedCall.customer_phone}</h3>
                    <p className="supervisor-stage-summary">
                      {selectedCall.summary || "The AI is actively handling this caller. Live speech and transcript updates appear below as soon as the conversation advances."}
                    </p>
                  </div>
                  <div className="supervisor-stage-chip-row">
                    <span className={`badge ${STATE_BADGES[selectedCall.session_state] ?? "badge-open"}`}>
                      {STATE_LABELS[selectedCall.session_state] ?? humanize(selectedCall.session_state)}
                    </span>
                    <span className={`badge ${DISPOSITION_BADGES[selectedCall.disposition] ?? "badge-open"}`}>
                      {humanize(selectedCall.disposition)}
                    </span>
                    <span className="supervisor-stage-time">Started {formatClock(selectedCall.started_at)}</span>
                  </div>
                </div>

                <div className="supervisor-voice-grid">
                  <article className={`supervisor-voice-card supervisor-voice-card-customer${selectedSpeaker === "customer" ? " supervisor-voice-card-active" : ""}`}>
                    <div className="supervisor-voice-topline">
                      <span className="supervisor-voice-role">Customer</span>
                      <span className={`supervisor-voice-state supervisor-voice-state-${selectedSpeaker === "customer" ? "live" : "idle"}`}>
                        {selectedSpeaker === "customer" ? "Speaking now" : "Waiting"}
                      </span>
                    </div>
                    <div className="supervisor-voice-wave" aria-hidden>
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <p className="supervisor-voice-note">
                      {selectedInterim || "When the caller speaks, the live monitor shows the active speaker and the transcript stream below updates into conversation bubbles."}
                    </p>
                  </article>

                  <article className={`supervisor-voice-card supervisor-voice-card-ai${selectedSpeaker === "ai" ? " supervisor-voice-card-active" : ""}`}>
                    <div className="supervisor-voice-topline">
                      <span className="supervisor-voice-role">AI Agent</span>
                      <span className={`supervisor-voice-state supervisor-voice-state-${selectedSpeaker === "ai" ? "live" : "idle"}`}>
                        {selectedSpeaker === "ai" ? "Replying now" : "Waiting"}
                      </span>
                    </div>
                    <div className="supervisor-voice-wave" aria-hidden>
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                    <p className="supervisor-voice-note">
                      The AI answer appears in the transcript as a normal conversational turn, so a supervisor can follow exactly what was said.
                    </p>
                  </article>
                </div>

                <div className="detail-grid">
                  <div className="detail-stat">
                    <span>Duration</span>
                    <strong>{formatElapsed(selectedCall.started_at, nowMs)}</strong>
                  </div>
                  <div className="detail-stat">
                    <span>Language</span>
                    <strong>{selectedCall.language}</strong>
                  </div>
                  <div className="detail-stat">
                    <span>Intent</span>
                    <strong>{humanize(selectedCall.intent)}</strong>
                  </div>
                  <div className="detail-stat">
                    <span>Sentiment</span>
                    <strong>{humanize(selectedCall.sentiment)}</strong>
                  </div>
                </div>

                <div className="supervisor-customer-strip">
                  <div>
                    <p className="detail-label">Customer</p>
                    <strong>{selectedCustomer?.full_name ?? selectedCall.customer_phone}</strong>
                  </div>
                  <div>
                    <p className="detail-label">Call ID</p>
                    <strong>{buildCallLabel(selectedCall)}</strong>
                  </div>
                  <div>
                    <p className="detail-label">Queue</p>
                    <strong>{selectedCall.queue_id}</strong>
                  </div>
                  <div>
                    <p className="detail-label">Disposition</p>
                    <strong>{humanize(selectedCall.disposition)}</strong>
                  </div>
                </div>

                {selectedCall.disposition === "escalated" ? (
                  <div className="supervisor-escalation-alert">
                    <strong>Escalation triggered.</strong>
                    <span>{selectedCall.escalation_reason || "This call is eligible for human handoff based on the current business rules."}</span>
                  </div>
                ) : null}

                <div className="supervisor-transcript-shell">
                  <div className="supervisor-transcript-header">
                    <div>
                      <p className="supervisor-transcript-kicker">Live transcript</p>
                      <h4 className="supervisor-transcript-title">Conversation stream</h4>
                    </div>
                    <span className="supervisor-transcript-note">
                      {loadingTranscriptId === selectedCall.id ? "Syncing transcript..." : "Text updates as soon as each spoken turn is captured"}
                    </span>
                  </div>

                  <div className="supervisor-transcript-stream">
                    {selectedTranscript.length === 0 && !selectedInterim ? (
                      <div className="supervisor-transcript-empty">
                        The conversation transcript will appear here as soon as the first spoken turn is captured.
                      </div>
                    ) : (
                      <>
                        {selectedTranscript.map((turn) => (
                          <div key={turn.id} className={`supervisor-turn supervisor-turn-${turn.speaker}`}>
                            <div className="supervisor-turn-label">
                              {humanize(turn.speaker)} ? {formatClock(turn.created_at)}
                            </div>
                            <div className="supervisor-turn-text">{turn.message}</div>
                          </div>
                        ))}
                        {selectedInterim ? (
                          <div className="supervisor-turn supervisor-turn-interim supervisor-turn-customer">
                            <div className="supervisor-turn-label">Customer ? live</div>
                            <div className="supervisor-turn-text">{selectedInterim}</div>
                          </div>
                        ) : null}
                        <div ref={transcriptEndRef} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="supervisor-empty-state supervisor-empty-state-stage">
                <p className="supervisor-empty-title">Choose a live call</p>
                <p className="supervisor-empty-desc">Select a call card to open the live speaker view and transcript stream.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
