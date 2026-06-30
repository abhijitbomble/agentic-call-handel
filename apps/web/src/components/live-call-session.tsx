"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface SpeechRecognitionResultAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResultEntry {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionResultAlternative;
  [index: number]: SpeechRecognitionResultAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResultEntry;
  [index: number]: SpeechRecognitionResultEntry;
}
interface SpeechRecognitionEvt extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrEvt extends Event {
  readonly error: string;
}
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvt) => void) | null;
  onerror: ((ev: SpeechRecognitionErrEvt) => void) | null;
  onend: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
      .SpeechRecognition ??
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
      .webkitSpeechRecognition ??
    null
  );
}

function subscribeToSpeechSupport() {
  return () => {};
}

function getSpeechSupportSnapshot() {
  return getSpeechRecognition() !== null;
}

const WS_BASE =
  typeof window === "undefined"
    ? "ws://127.0.0.1:8020"
    : /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
      ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8020").replace(/^http/, "ws")
      : window.location.origin.replace(/^http/, "ws");

type Turn = {
  id: string;
  speaker: string;
  message: string;
  created_at: string;
};

type CallInfo = {
  id: string;
  session_state: string;
  disposition: string;
  verification_state: string;
  language: string;
  summary: string;
};

type SessionPayload = {
  call: CallInfo;
  transcript: Turn[];
};

type Props = {
  organizationId: string;
  programId: string;
  queueId: string;
  phoneNumber: string;
  language: string;
  onEnd: () => void;
};

const STATE_LABELS: Record<string, string> = {
  disclosure_consent: "Playing disclosure",
  language_detected: "Listening",
  verification_if_needed: "Verifying identity",
  intent_captured: "Understanding intent",
  answer_or_tool_action: "AI responding",
  live_handoff: "Transferring to agent",
  callback: "Scheduling callback",
  resolved: "Call resolved",
  summary: "Wrapping up",
  closed: "Ended",
};

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function LiveCallSession({ organizationId, programId, queueId, phoneNumber, language, onEnd }: Props) {
  const [callInfo, setCallInfo] = useState<CallInfo | null>(null);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [status, setStatus] = useState<"idle" | "starting" | "active" | "ended">("idle");
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const hasSpeechAPI = useSyncExternalStore(subscribeToSpeechSupport, getSpeechSupportSnapshot, () => true);

  const callIdRef = useRef<string | null>(null);
  const activeRef = useRef(false);
  const muteRef = useRef(false);
  const speakingRef = useRef(false);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    muteRef.current = muted;
  }, [muted]);

  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interim]);

  const speak = useCallback((text: string, lang: string) => {
    if (typeof window === "undefined" || !text) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === "Hindi" ? "hi-IN" : "en-IN";
    utter.rate = 0.92;
    utter.pitch = 1.05;
    setSpeaking(true);
    speakingRef.current = true;
    utter.onend = () => {
      setSpeaking(false);
      speakingRef.current = false;
    };
    utter.onerror = () => {
      setSpeaking(false);
      speakingRef.current = false;
    };
    window.speechSynthesis.speak(utter);
  }, []);

  const handleEnd = useCallback(() => {
    activeRef.current = false;
    window.speechSynthesis.cancel();
    recognitionRef.current?.stop();
    wsRef.current?.close();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setStatus("ended");
    setListening(false);
    setSpeaking(false);
    onEnd();
  }, [onEnd]);

  const sendTurn = useCallback(async (message: string) => {
    const callId = callIdRef.current;
    if (!callId || processingRef.current) return;
    processingRef.current = true;

    window.speechSynthesis.cancel();
    setSpeaking(false);
    speakingRef.current = false;

    setTranscript((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, speaker: "customer", message, created_at: new Date().toISOString() },
    ]);

    try {
      const response = await fetch(`/api/voice-lab/${callId}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) throw new Error("turn failed");
      const data = (await response.json()) as SessionPayload;
      setCallInfo(data.call);
      setTranscript(data.transcript);

      const lastAiTurn = [...data.transcript].reverse().find((turn) => turn.speaker === "ai");
      if (lastAiTurn && activeRef.current) {
        speak(lastAiTurn.message, data.call.language);
      }

      if (["resolved", "closed", "summary"].includes(data.call.session_state)) {
        setTimeout(() => {
          if (activeRef.current) handleEnd();
        }, 5000);
      }
    } catch {
      setError("Connection issue - please check the backend is running.");
    } finally {
      processingRef.current = false;
    }
  }, [handleEnd, speak]);

  const startRecognition = useCallback((lang: string) => {
    const SpeechRecog = getSpeechRecognition();
    if (!SpeechRecog) return;

    const recognition = new SpeechRecog();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang === "Hindi" ? "hi-IN" : "en-IN";
    recognitionRef.current = recognition;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event: SpeechRecognitionEvt) => {
      if (muteRef.current || speakingRef.current || processingRef.current) return;
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else interimText += text;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        sendTurn(finalText.trim());
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrEvt) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(`Microphone error: ${event.error}. Try refreshing.`);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      if (activeRef.current && !muteRef.current) {
        try {
          recognition.start();
        } catch {
          // Recognition may already be started.
        }
      }
    };

    recognition.start();
  }, [sendTurn]);

  async function startCall() {
    setStatus("starting");
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
          preferred_language: language,
        }),
      });
      if (!response.ok) throw new Error("Failed to start call");
      const data = (await response.json()) as SessionPayload;

      callIdRef.current = data.call.id;
      activeRef.current = true;
      setCallInfo(data.call);
      setTranscript(data.transcript);
      setStatus("active");

      timerRef.current = setInterval(() => setDuration((value) => value + 1), 1000);

      const ws = new WebSocket(`${WS_BASE}/ws/voice-sessions/${data.call.id}`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data as string) as Partial<CallInfo>;
          setCallInfo((prev) => (prev ? { ...prev, ...update } : prev));
        } catch {
          // Ignore non-JSON heartbeat frames.
        }
      };

      const firstAiTurn = data.transcript.find((turn) => turn.speaker === "ai");
      if (firstAiTurn) speak(firstAiTurn.message, data.call.language);

      setTimeout(() => {
        if (activeRef.current && hasSpeechAPI) startRecognition(data.call.language);
      }, 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start call");
      setStatus("idle");
    }
  }

  async function handleEscalate() {
    const callId = callIdRef.current;
    if (callId) {
      try {
        await fetch(`/api/voice-lab/${callId}/escalate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Agent escalation requested", requested_by: "agent" }),
        });
      } catch {
        // Non-blocking.
      }
    }
    handleEnd();
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    muteRef.current = next;
    if (next) {
      recognitionRef.current?.stop();
      setListening(false);
    } else if (callInfo && activeRef.current) {
      startRecognition(callInfo.language);
    }
  }

  if (status === "idle") {
    return (
      <div className="live-call-start">
        <div className="live-call-start-icon">📞</div>
        <h3 className="live-call-start-title">Start a live AI call</h3>
        <p className="live-call-start-desc">
          The AI will handle the call using your microphone for customer input and speak responses aloud.
          {!hasSpeechAPI && (
            <span className="live-call-browser-warn"> Use Chrome or Edge for microphone support.</span>
          )}
        </p>
        <button className="live-call-dial-btn" onClick={startCall}>
          Dial in
        </button>
      </div>
    );
  }

  if (status === "starting") {
    return (
      <div className="live-call-start">
        <div className="live-call-start-icon live-call-starting-pulse">📞</div>
        <p className="live-call-start-desc">Connecting call...</p>
      </div>
    );
  }

  return (
    <div className="live-call-container">
      <div className="live-call-topbar">
        <div className="live-call-topbar-left">
          <span className="live-call-phone">{phoneNumber}</span>
          <span className="live-call-duration">{formatDuration(duration)}</span>
          {callInfo && (
            <span className="live-call-state-badge">
              {STATE_LABELS[callInfo.session_state] ?? callInfo.session_state.replaceAll("_", " ")}
            </span>
          )}
        </div>
        <div className="live-call-topbar-right">
          {speaking && <span className="live-call-speaking-indicator">AI speaking...</span>}
          {listening && !speaking && !muted && <span className="live-call-listening-indicator">Listening...</span>}
          {muted && <span className="live-call-muted-indicator">Muted</span>}
        </div>
      </div>

      <div className="live-call-transcript">
        {transcript.map((turn) => (
          <div key={turn.id} className={`live-turn live-turn-${turn.speaker}`}>
            <span className="live-turn-label">
              {turn.speaker === "ai" ? "AI Agent" : turn.speaker === "customer" ? "Customer" : "System"}
            </span>
            <p className="live-turn-text">{turn.message}</p>
          </div>
        ))}
        {interim && (
          <div className="live-turn live-turn-customer live-turn-interim">
            <span className="live-turn-label">Customer (speaking...)</span>
            <p className="live-turn-text">{interim}</p>
          </div>
        )}
        <div ref={transcriptEndRef} />
      </div>

      {callInfo && (
        <div className="live-call-info-strip">
          <span className={`badge badge-${callInfo.disposition}`}>{callInfo.disposition}</span>
          <span className={`badge badge-${callInfo.verification_state}`}>{callInfo.verification_state}</span>
          <span className="badge badge-default">{callInfo.language}</span>
          <span className="live-call-summary">{callInfo.summary}</span>
        </div>
      )}

      {error && <p className="live-call-error">{error}</p>}

      <div className="live-call-controls">
        <button
          className={`live-ctrl-btn live-ctrl-mute${muted ? " live-ctrl-active" : ""}`}
          onClick={toggleMute}
          title={muted ? "Unmute microphone" : "Mute microphone"}
        >
          {muted ? "🎙️ Unmute" : "🔇 Mute"}
        </button>
        <button
          className="live-ctrl-btn live-ctrl-escalate"
          onClick={handleEscalate}
          title="Transfer to a human agent"
        >
          👤 Transfer to agent
        </button>
        <button className="live-ctrl-btn live-ctrl-end" onClick={handleEnd} title="End the call">
          📴 End call
        </button>
      </div>
    </div>
  );
}

