"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  [0]: { readonly transcript: string };
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [i: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvt extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((e: Event) => void) | null;
  onresult: ((e: SpeechRecognitionEvt) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  start(): void;
  stop(): void;
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

type CallState = "idle" | "connecting" | "ai_speaking" | "listening" | "processing" | "ended" | "error";

type ServerMessage =
  | { type: "ready"; call_id: string; language: string; program: string; ai_message: string }
  | { type: "ai_reply"; text: string; state: string; disposition: string }
  | { type: "call_ended"; reason: string }
  | { type: "error"; message: string };

type Transcript = { speaker: "ai" | "customer"; text: string };

export function CustomerCallView({ token }: { token: string }) {
  const [state, setState] = useState<CallState>("idle");
  const [program, setProgram] = useState("Support");
  const [language, setLanguage] = useState("English");
  const [transcript, setTranscript] = useState<Transcript[]>([]);
  const [interim, setInterim] = useState("");
  const [aiText, setAiText] = useState("");
  const [endReason, setEndReason] = useState("");
  const hasSpeech = useSyncExternalStore(subscribeToSpeechSupport, getSpeechSupportSnapshot, () => true);

  const wsRef = useRef<WebSocket | null>(null);
  const recogRef = useRef<ISpeechRecognition | null>(null);
  const activeRef = useRef(false);
  const processingRef = useRef(false);
  const languageRef = useRef(language);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interim]);

  const speak = useCallback((text: string, lang: string, onDone?: () => void) => {
    if (typeof window === "undefined" || !text) {
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === "Hindi" ? "hi-IN" : "en-IN";
    utter.rate = 0.92;
    utter.onend = () => onDone?.();
    utter.onerror = () => onDone?.();
    window.speechSynthesis.speak(utter);
  }, []);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    recogRef.current = null;
  }, []);

  const sendTurn = useCallback((message: string) => {
    if (!wsRef.current || processingRef.current || !activeRef.current) return;
    processingRef.current = true;
    stopListening();
    setState("processing");
    setTranscript((prev) => [...prev, { speaker: "customer", text: message }]);
    wsRef.current.send(JSON.stringify({ type: "turn", message }));
  }, [stopListening]);

  const startListening = useCallback((lang: string) => {
    const SpeechRecog = getSpeechRecognition();
    if (!SpeechRecog || !activeRef.current) return;

    const recog = new SpeechRecog();
    recog.continuous = false;
    recog.interimResults = true;
    recog.lang = lang === "Hindi" ? "hi-IN" : "en-IN";
    recogRef.current = recog;

    recog.onstart = () => {
      if (activeRef.current) setState("listening");
    };

    recog.onresult = (event: SpeechRecognitionEvt) => {
      let nextInterim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += text;
        else nextInterim += text;
      }
      setInterim(nextInterim);
      if (finalText.trim() && activeRef.current && !processingRef.current) {
        setInterim("");
        sendTurn(finalText.trim());
      }
    };

    recog.onerror = () => setState("listening");
    recog.onend = () => {
      if (activeRef.current && !processingRef.current) setState("listening");
    };

    recog.start();
    setState("listening");
  }, [sendTurn]);

  const endCall = useCallback(() => {
    activeRef.current = false;
    window.speechSynthesis.cancel();
    stopListening();
    wsRef.current?.send(JSON.stringify({ type: "end" }));
    wsRef.current?.close();
    setState("ended");
  }, [stopListening]);

  const startCall = useCallback(() => {
    setState("connecting");
    activeRef.current = true;

    const ws = new WebSocket(`${WS_BASE}/ws/customer-call/${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;

      if (msg.type === "ready") {
        setProgram(msg.program);
        setLanguage(msg.language);
        languageRef.current = msg.language;
        setAiText(msg.ai_message);
        setTranscript([{ speaker: "ai", text: msg.ai_message }]);
        setState("ai_speaking");
        speak(msg.ai_message, msg.language, () => {
          processingRef.current = false;
          if (activeRef.current) startListening(msg.language);
        });
      }

      if (msg.type === "ai_reply") {
        const replyLanguage = languageRef.current;
        setAiText(msg.text);
        setTranscript((prev) => [...prev, { speaker: "ai", text: msg.text }]);
        setState("ai_speaking");
        speak(msg.text, replyLanguage, () => {
          processingRef.current = false;
          if (activeRef.current) startListening(replyLanguage);
        });
      }

      if (msg.type === "call_ended") {
        activeRef.current = false;
        window.speechSynthesis.cancel();
        stopListening();
        setEndReason(msg.reason);
        setState("ended");
      }

      if (msg.type === "error") {
        setAiText(msg.message);
        setState("error");
      }
    };

    ws.onerror = () => {
      setState("error");
      setAiText("Could not connect. Please check your internet and try again.");
    };

    ws.onclose = () => {
      if (activeRef.current) {
        activeRef.current = false;
        setState("ended");
      }
    };
  }, [speak, startListening, stopListening, token]);

  if (state === "idle") {
    return (
      <div className="cc-idle">
        <div className="cc-brand">
          <div className="cc-brand-logo">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden>
              <circle cx="16" cy="16" r="16" fill="rgba(15,123,119,0.9)" />
              <path d="M10 22 L16 10 L22 22 M13 18 L19 18" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="cc-brand-name">VoiceOps Support</span>
        </div>
        <div className="cc-idle-body">
          <div className="cc-phone-icon">📞</div>
          <h1 className="cc-idle-title">Tap to speak with our AI support agent</h1>
          <p className="cc-idle-sub">
            Your call is handled by AI. No hold music, no waiting.
            {!hasSpeech && (
              <span className="cc-browser-warn"> Use Chrome or Edge for voice support.</span>
            )}
          </p>
          <button className="cc-dial-btn" onClick={startCall}>
            Start Call
          </button>
        </div>
      </div>
    );
  }

  if (state === "ended" || state === "error") {
    const isError = state === "error";
    return (
      <div className="cc-ended">
        <div className="cc-ended-icon">{isError ? "⚠️" : "✅"}</div>
        <h2 className="cc-ended-title">
          {isError
            ? "Connection error"
            : endReason === "resolved"
              ? "Issue resolved"
              : endReason === "escalated"
                ? "Transferred to human agent"
                : endReason === "callback"
                  ? "Callback scheduled"
                  : "Call ended"}
        </h2>
        <p className="cc-ended-sub">
          {isError ? aiText : "Thank you for contacting support. Have a great day!"}
        </p>
        <button
          className="cc-dial-btn"
          onClick={() => {
            setTranscript([]);
            setAiText("");
            setEndReason("");
            setState("idle");
          }}
        >
          Call again
        </button>
      </div>
    );
  }

  return (
    <div className="cc-active">
      <div className="cc-header">
        <div className="cc-header-info">
          <span className="cc-program-name">{program}</span>
          <span className={`cc-status-badge cc-status-${state}`}>
            {state === "connecting" && "Connecting..."}
            {state === "ai_speaking" && "AI speaking..."}
            {state === "listening" && "Listening..."}
            {state === "processing" && "Processing..."}
          </span>
        </div>
        <button className="cc-end-btn" onClick={endCall} title="End call">
          <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
          </svg>
        </button>
      </div>

      <div className="cc-transcript">
        {transcript.map((turn, index) => (
          <div key={index} className={`cc-turn cc-turn-${turn.speaker}`}>
            <span className="cc-turn-label">{turn.speaker === "ai" ? "Agent" : "You"}</span>
            <p className="cc-turn-text">{turn.text}</p>
          </div>
        ))}
        {interim && (
          <div className="cc-turn cc-turn-customer cc-turn-interim">
            <span className="cc-turn-label">You (speaking...)</span>
            <p className="cc-turn-text">{interim}</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="cc-mic-area">
        {state === "listening" && (
          <div className="cc-mic-rings">
            <div className="cc-mic-ring cc-ring1" />
            <div className="cc-mic-ring cc-ring2" />
            <div className="cc-mic-icon">🎙️</div>
          </div>
        )}
        {state === "ai_speaking" && (
          <div className="cc-wave-area">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="cc-wave-bar" style={{ animationDelay: `${index * 0.12}s` }} />
            ))}
          </div>
        )}
        {state === "processing" && <div className="cc-processing-dot" />}
        {state === "connecting" && <div className="cc-connecting-text">Connecting...</div>}
        <p className="cc-mic-hint">
          {state === "listening"
            ? "Speak now - we are listening"
            : state === "ai_speaking"
              ? "Agent is speaking..."
              : state === "processing"
                ? "Processing your message..."
                : ""}
        </p>
      </div>
    </div>
  );
}

