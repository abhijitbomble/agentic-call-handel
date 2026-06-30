"use client";

import { useEffect, useState } from "react";

import { TwilioBrowserTester } from "@/components/twilio-browser-tester";

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

type TwilioConfig = {
  configured: boolean;
  phone_number: string;
  escalation_number: string;
  public_base_url: string;
  media_stream_websocket: string;
  stream_action_webhook: string;
  browser_softphone?: BrowserSoftphoneConfig;
  queues: QueueInfo[];
  setup_steps: string[];
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button className="twilio-copy-btn" onClick={copy}>
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export function TwilioSetup() {
  const [config, setConfig] = useState<TwilioConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/twilio-config")
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { error?: string } | TwilioConfig | null;
        if (!response.ok) {
          const message = payload && typeof payload === "object" && "error" in payload ? payload.error : "Could not load Twilio config.";
          throw new Error(message ?? "Could not load Twilio config.");
        }
        if (cancelled) return;
        setConfig(payload as TwilioConfig);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load Twilio config.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="twilio-loading">Loading Twilio config...</div>;
  if (error) return <div className="twilio-error">{error}</div>;
  if (!config) return <div className="twilio-error">Could not load config. Is the backend running?</div>;

  const browserSoftphone: BrowserSoftphoneConfig = config.browser_softphone ?? {
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

  const setupSteps = [
    "Set VOICEOPS_TWILIO_ACCOUNT_SID, VOICEOPS_TWILIO_AUTH_TOKEN, VOICEOPS_TWILIO_PHONE_NUMBER, and VOICEOPS_DEEPGRAM_API_KEY in apps/api/.env",
    "Run ngrok against the API: ngrok http 8020",
    "Set VOICEOPS_PUBLIC_BASE_URL to your public https tunnel URL and restart the API",
    "For PSTN testing, paste the queue-specific Voice webhook into the Twilio phone number config",
    "For browser testing, create a TwiML App that points to /twilio/browser/voice and add your Twilio API Key SID + Secret",
    "Both entry paths reuse the same Twilio Media Streams, Deepgram STT/TTS, and SessionEngine business logic",
  ];

  return (
    <div className="twilio-setup">
      <div className="twilio-status-row">
        <span className={`twilio-status-badge ${config.configured ? "twilio-badge-ok" : "twilio-badge-warn"}`}>
          {config.configured ? "Twilio credentials set" : "Twilio not configured"}
        </span>
        <span className="twilio-status-detail">
          Phone: <strong>{config.phone_number}</strong>
          {" | "}Escalation: <strong>{config.escalation_number}</strong>
          {" | "}Public URL: <strong>{config.public_base_url}</strong>
        </span>
      </div>

      <TwilioBrowserTester browser={browserSoftphone} queues={config.queues} />

      <section className="twilio-section">
        <h2 className="twilio-section-title">How real calls work</h2>
        <div className="twilio-flow">
          {[
            { label: "Customer dials or browser calls", desc: "A real caller comes through either your Twilio number or the browser softphone test panel" },
            { label: "Voice webhook", desc: "Twilio hits /twilio/voice or /twilio/browser/voice and the API creates the live call record" },
            { label: "Media Stream", desc: "The webhook returns Connect + Stream TwiML so Twilio opens a bidirectional websocket" },
            { label: "Deepgram STT", desc: "Inbound mulaw / 8 kHz call audio is streamed to Deepgram for live transcription" },
            { label: "Business logic", desc: "Transcripts run through your existing verification, KB, callback, and escalation rules" },
            { label: "Deepgram TTS", desc: "The AI response is synthesized back to mulaw / 8 kHz audio and streamed into the live call" },
            { label: "Handoff or end", desc: "The stream closes only when the call is resolved, queued for callback, or transferred to a human" },
          ].map((step, i) => (
            <div key={i} className="twilio-flow-step">
              <div className="twilio-flow-num">{i + 1}</div>
              <div className="twilio-flow-text">
                <div className="twilio-flow-label">{step.label}</div>
                <div className="twilio-flow-desc">{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="twilio-section">
        <h2 className="twilio-section-title">Setup checklist</h2>
        <ol className="twilio-steps-list">
          {setupSteps.map((step, i) => (
            <li key={i} className="twilio-step-item">
              {step}
            </li>
          ))}
        </ol>
      </section>

      <section className="twilio-section">
        <h2 className="twilio-section-title">apps/api/.env</h2>
        <p className="twilio-section-desc">Create this file (copy from .env.example) and fill in your values:</p>
        <div className="twilio-code-block">
          <pre>{`VOICEOPS_TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VOICEOPS_TWILIO_AUTH_TOKEN=your_auth_token_here
VOICEOPS_TWILIO_PHONE_NUMBER=+14155551234
VOICEOPS_TWILIO_ESCALATION_NUMBER=+919876543210
VOICEOPS_TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VOICEOPS_TWILIO_API_KEY_SECRET=your_twilio_api_key_secret_here
VOICEOPS_TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
VOICEOPS_DEEPGRAM_API_KEY=dg_your_key_here
VOICEOPS_PUBLIC_BASE_URL=https://your-ngrok-id.ngrok.io`}</pre>
        </div>
      </section>

      <section className="twilio-section">
        <h2 className="twilio-section-title">Twilio webhook URLs</h2>
        <p className="twilio-section-desc">
          In the Twilio dashboard, open Phone Numbers, choose your number, then use Voice &amp; Fax and paste the queue voice webhook below.
        </p>
        {config.queues.length === 0 ? (
          <p className="twilio-no-queues">No queues found. Restart the backend to seed data.</p>
        ) : (
          config.queues.map((q) => (
            <div key={q.queue_id} className="twilio-queue-card">
              <div className="twilio-queue-header">
                <span className="twilio-queue-name">{q.queue_name}</span>
                <span className="twilio-queue-program">{q.program}</span>
              </div>
              <div className="twilio-webhook-row">
                <span className="twilio-webhook-label">Voice webhook (paste this into Twilio phone number config)</span>
                <div className="twilio-webhook-value-row">
                  <code className="twilio-webhook-url">{q.voice_webhook}</code>
                  <CopyButton value={q.voice_webhook} />
                </div>
              </div>
              <div className="twilio-webhook-row">
                <span className="twilio-webhook-label">Media stream websocket (used automatically)</span>
                <div className="twilio-webhook-value-row">
                  <code className="twilio-webhook-url">{q.stream_websocket}</code>
                  <CopyButton value={q.stream_websocket} />
                </div>
              </div>
              <div className="twilio-webhook-row">
                <span className="twilio-webhook-label">Optional backup status callback</span>
                <div className="twilio-webhook-value-row">
                  <code className="twilio-webhook-url">{q.status_callback}</code>
                  <CopyButton value={q.status_callback} />
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="twilio-section">
        <h2 className="twilio-section-title">TwiML app for browser calling</h2>
        <p className="twilio-section-desc">
          Create one TwiML App in Twilio, set its Voice Request URL to the browser webhook below, and use HTTP POST. The selected queue is passed at call time from the dashboard.
        </p>
        <div className="twilio-webhook-row">
          <span className="twilio-webhook-label">Browser voice webhook</span>
          <div className="twilio-webhook-value-row">
            <code className="twilio-webhook-url">{browserSoftphone.voice_webhook}</code>
            <CopyButton value={browserSoftphone.voice_webhook} />
          </div>
        </div>
        <div className="twilio-webhook-row">
          <span className="twilio-webhook-label">Configured TwiML App SID</span>
          <div className="twilio-webhook-value-row">
            <code className="twilio-webhook-url">{browserSoftphone.twiml_app_sid}</code>
            {browserSoftphone.twiml_app_sid !== "not set" ? <CopyButton value={browserSoftphone.twiml_app_sid} /> : null}
          </div>
        </div>
      </section>

      <section className="twilio-section">
        <h2 className="twilio-section-title">Shared stream callbacks</h2>
        <p className="twilio-section-desc">These are wired by the voice webhook and TwiML automatically.</p>
        <div className="twilio-webhook-row">
          <span className="twilio-webhook-label">Generic media stream path</span>
          <div className="twilio-webhook-value-row">
            <code className="twilio-webhook-url">{config.media_stream_websocket}</code>
            <CopyButton value={config.media_stream_websocket} />
          </div>
        </div>
        <div className="twilio-webhook-row">
          <span className="twilio-webhook-label">Post-stream action webhook</span>
          <div className="twilio-webhook-value-row">
            <code className="twilio-webhook-url">{config.stream_action_webhook}</code>
            <CopyButton value={config.stream_action_webhook} />
          </div>
        </div>
      </section>
    </div>
  );
}
