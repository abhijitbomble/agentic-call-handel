"use client";

import type { Call as TwilioCall, Device as TwilioDevice } from "@twilio/voice-sdk";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type QueueInfo = {
  queue_id: string;
  queue_name: string;
  program: string;
  voice_webhook: string;
  status_callback: string;
  stream_websocket: string;
};

type BrowserSoftphoneConfig = {
  ready: boolean;
  voice_webhook: string;
  twiml_app_sid: string;
  missing: string[];
  setup_steps: string[];
};

type TokenResponse = {
  token: string;
  identity: string;
  queue_id: string;
  queue_name: string;
  program: string;
  expires_in_seconds: number;
};

type Props = {
  browser?: BrowserSoftphoneConfig;
  queues: QueueInfo[];
};

type SoftphoneState = "idle" | "preparing" | "connecting" | "live" | "ended" | "error";

type SoftphoneError = {
  error?: string;
  detail?: string;
};

function levelWidth(value: number) {
  return `${Math.max(8, Math.round(value * 100))}%`;
}

export function TwilioBrowserTester({ browser, queues }: Props) {
  const browserConfig = browser ?? {
    ready: false,
    voice_webhook: "/twilio/browser/voice",
    twiml_app_sid: "not set",
    missing: ["VOICEOPS_TWILIO_API_KEY_SID", "VOICEOPS_TWILIO_API_KEY_SECRET", "VOICEOPS_TWILIO_TWIML_APP_SID"],
    setup_steps: [
      "Create a TwiML App in Twilio and set its Voice Request URL to /twilio/browser/voice using HTTP POST",
      "Create a Twilio API Key and Secret for the Voice JavaScript SDK",
      "Set VOICEOPS_TWILIO_API_KEY_SID, VOICEOPS_TWILIO_API_KEY_SECRET, and VOICEOPS_TWILIO_TWIML_APP_SID in apps/api/.env",
      "Restart the API, then open the Browser Softphone Test panel in the dashboard",
    ],
  };
  const [selectedQueueId, setSelectedQueueId] = useState(() => queues[0]?.queue_id ?? "");
  const [softphoneState, setSoftphoneState] = useState<SoftphoneState>("idle");
  const [statusMessage, setStatusMessage] = useState(
    browserConfig.ready
      ? "Use your browser microphone to place a real Twilio call without dialing the US number from India."
      : "Finish the Twilio browser softphone setup below, then come back here to place a real test call.",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasActiveCall, setHasActiveCall] = useState(false);
  const [inputLevel, setInputLevel] = useState(0.08);
  const [outputLevel, setOutputLevel] = useState(0.08);
  const deviceRef = useRef<TwilioDevice | null>(null);
  const callRef = useRef<TwilioCall | null>(null);

  useEffect(() => {
    return () => {
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
      callRef.current = null;
      deviceRef.current = null;
    };
  }, []);

  function cleanupDevice(nextState: SoftphoneState, nextMessage: string) {
    callRef.current = null;
    deviceRef.current?.destroy();
    deviceRef.current = null;
    setBusy(false);
    setHasActiveCall(false);
    setSoftphoneState(nextState);
    setStatusMessage(nextMessage);
    setInputLevel(0.08);
    setOutputLevel(0.08);
  }

  async function fetchBrowserToken(queueId: string) {
    const response = await fetch(`/api/twilio-browser/token?queue_id=${encodeURIComponent(queueId)}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => null)) as SoftphoneError | TokenResponse | null;
    if (!response.ok) {
      const errorPayload = payload as SoftphoneError | null;
      const message = errorPayload?.error ?? errorPayload?.detail ?? "Could not create a Twilio browser token.";
      throw new Error(message);
    }
    return payload as TokenResponse;
  }

  async function startCall() {
    if (!browserConfig.ready) {
      setError("The browser softphone is not configured yet. Finish the setup steps below first.");
      setSoftphoneState("error");
      return;
    }
    if (!selectedQueueId) {
      setError("Pick a queue before starting the browser call.");
      setSoftphoneState("error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not expose microphone access. Use Chrome or Edge on localhost/https.");
      setSoftphoneState("error");
      return;
    }

    setBusy(true);
    setError(null);
    setSoftphoneState("preparing");
    setStatusMessage("Checking microphone permission and creating a Twilio access token...");

    try {
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
      callRef.current = null;
      deviceRef.current = null;

      const previewStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      previewStream.getTracks().forEach((track) => track.stop());

      const payload = await fetchBrowserToken(selectedQueueId);
      const voice = await import("@twilio/voice-sdk");
      const device = new voice.Device(payload.token, {
        closeProtection: true,
        codecPreferences: [voice.Call.Codec.Opus, voice.Call.Codec.PCMU],
        logLevel: 1,
      });

      device.on("error", (deviceError) => {
        setError(deviceError.message);
        cleanupDevice("error", "Twilio browser device hit an error before the call could continue.");
      });

      device.on("tokenWillExpire", () => {
        setStatusMessage("The current browser-call token is about to expire. Start a fresh test call if needed.");
      });

      deviceRef.current = device;
      setSoftphoneState("connecting");
      setStatusMessage(`Calling ${payload.queue_name} for ${payload.program}. Watch the Live Calls page for transcript updates.`);

      const call = await device.connect({ params: { queue_id: payload.queue_id } });
      callRef.current = call;
      setHasActiveCall(true);

      call.on("accept", () => {
        setBusy(false);
        setSoftphoneState("live");
        setStatusMessage(`Browser call is live in ${payload.queue_name}. The same Twilio Media Streams and Deepgram runtime is now active.`);
      });

      call.on("volume", (inputVolume, outputVolume) => {
        setInputLevel(inputVolume);
        setOutputLevel(outputVolume);
      });

      call.on("disconnect", () => {
        cleanupDevice("ended", "Browser call ended. You can place another real test call whenever you are ready.");
      });

      call.on("cancel", () => {
        cleanupDevice("ended", "Twilio canceled the browser call before it was fully connected.");
      });

      call.on("reject", () => {
        cleanupDevice("ended", "The browser call was rejected.");
      });

      call.on("error", (callError) => {
        setError(callError.message);
        cleanupDevice("error", "The live browser call hit an error. Review the message and try again.");
      });
    } catch (err) {
      setBusy(false);
      setSoftphoneState("error");
      setStatusMessage("The browser call could not be started.");
      setHasActiveCall(false);
      setError(err instanceof Error ? err.message : "Could not start the browser call.");
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
      callRef.current = null;
      deviceRef.current = null;
    }
  }

  function endCall() {
    setBusy(true);
    setStatusMessage("Ending the active browser call...");
    callRef.current?.disconnect();
  }

  return (
    <section className="twilio-section twilio-softphone-card">
      <div className="twilio-softphone-header">
        <div>
          <p className="twilio-softphone-kicker">Browser Softphone Test</p>
          <h2 className="twilio-section-title">Place a real Twilio-backed call from this dashboard</h2>
        </div>
        <span className={`twilio-status-badge ${browserConfig.ready ? "twilio-badge-ok" : "twilio-badge-warn"}`}>
          {browserConfig.ready ? "Ready to test" : "Setup needed"}
        </span>
      </div>
      <p className="twilio-section-desc">
        This avoids the India-to-US dialing problem while still running through Twilio, your live Media Streams websocket, Deepgram STT/TTS, and the same SessionEngine business logic.
      </p>

      {browserConfig.ready ? (
        <>
          <div className="twilio-softphone-controls">
            <label className="twilio-softphone-field">
              <span className="twilio-webhook-label">Queue</span>
              <select value={selectedQueueId} onChange={(event) => setSelectedQueueId(event.target.value)}>
                {queues.map((queue) => (
                  <option key={queue.queue_id} value={queue.queue_id}>
                    {queue.queue_name} - {queue.program}
                  </option>
                ))}
              </select>
            </label>
            <div className="twilio-softphone-actions">
              <button className="twilio-copy-btn" onClick={startCall} disabled={busy || softphoneState === "live"}>
                {busy && softphoneState !== "live" ? "Starting..." : "Start browser call"}
              </button>
              <button className="twilio-softphone-stop" onClick={endCall} disabled={!hasActiveCall || busy}>
                End call
              </button>
            </div>
          </div>

          <div className="twilio-softphone-status-panel">
            <div className={`twilio-softphone-state twilio-softphone-state-${softphoneState}`}>{softphoneState}</div>
            <p className="twilio-softphone-status-copy">{statusMessage}</p>
            {error ? <p className="twilio-softphone-error">{error}</p> : null}
          </div>

          <div className="twilio-softphone-meter-grid">
            <div className="twilio-softphone-meter-card">
              <span className="twilio-webhook-label">Your microphone</span>
              <div className="twilio-softphone-meter-rail">
                <span className="twilio-softphone-meter-fill twilio-softphone-meter-input" style={{ width: levelWidth(inputLevel) }} />
              </div>
            </div>
            <div className="twilio-softphone-meter-card">
              <span className="twilio-webhook-label">AI audio return</span>
              <div className="twilio-softphone-meter-rail">
                <span className="twilio-softphone-meter-fill twilio-softphone-meter-output" style={{ width: levelWidth(outputLevel) }} />
              </div>
            </div>
          </div>

          <p className="twilio-softphone-note">
            Keep <Link href="/calls">Live Calls</Link> open in another tab to watch the real transcript stream and speaker activity while this browser call is running.
          </p>
        </>
      ) : (
        <>
          <div className="twilio-softphone-missing">
            <span className="twilio-webhook-label">Missing configuration</span>
            <p>{browserConfig.missing.join(", ")}</p>
          </div>
          <div className="twilio-webhook-row">
            <span className="twilio-webhook-label">TwiML App voice webhook</span>
            <code className="twilio-webhook-url">{browserConfig.voice_webhook}</code>
          </div>
          <ol className="twilio-steps-list">
            {browserConfig.setup_steps.map((step) => (
              <li key={step} className="twilio-step-item">
                {step}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
