"use client";

import { useState } from "react";

type Program = { id: string; name: string };
type Queue   = { id: string; name: string; client_program_id: string };

type SessionResult = {
  call_url: string;
  program: string;
  queue: string;
  language: string;
  expires_in_hours: number;
};

type Props = { programs: Program[]; queues: Queue[] };

export function CallLinkGenerator({ programs, queues }: Props) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [language, setLanguage] = useState("English");
  const [phone, setPhone] = useState("");
  const [expires, setExpires] = useState(24);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [copied, setCopied] = useState(false);

  const filteredQueues = queues.filter((q) => q.client_program_id === programId);
  const queueId = filteredQueues[0]?.id ?? "";

  async function generate() {
    if (!programId || !queueId) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/customer-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_program_id: programId,
          queue_id: queueId,
          customer_phone: phone.trim() || "unknown",
          preferred_language: language,
          expires_hours: expires,
          frontend_base_url: window.location.origin,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as SessionResult;
      setResult(data);
    } catch {
      alert("Could not generate link. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(result.call_url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function whatsapp() {
    if (!result) return;
    const text = encodeURIComponent(
      `Hello! Please click this link to speak with our support agent:\n${result.call_url}\n\nThis link is valid for ${result.expires_in_hours} hours.`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }

  return (
    <div className="clg-container">
      <p className="clg-desc">
        Generate a link and send it to your customer via WhatsApp, SMS, or email.
        They open it on any smartphone browser — no app, no account needed.
      </p>

      <div className="clg-form">
        <div className="clg-field">
          <label className="clg-label">Program</label>
          <select className="clg-select" value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="clg-field">
          <label className="clg-label">Language</label>
          <select className="clg-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="English">English</option>
            <option value="Hindi">Hindi</option>
          </select>
        </div>

        <div className="clg-field">
          <label className="clg-label">Customer phone (optional)</label>
          <input
            className="clg-input"
            type="tel"
            placeholder="+91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <span className="clg-field-hint">If provided, the AI will recognise the customer automatically</span>
        </div>

        <div className="clg-field">
          <label className="clg-label">Link expires after</label>
          <select className="clg-select" value={expires} onChange={(e) => setExpires(Number(e.target.value))}>
            <option value={1}>1 hour</option>
            <option value={6}>6 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
          </select>
        </div>

        <button className="clg-btn" onClick={generate} disabled={loading || !programId || !queueId}>
          {loading ? "Generating…" : "Generate Call Link"}
        </button>
      </div>

      {result && (
        <div className="clg-result">
          <div className="clg-result-meta">
            <span className="clg-result-tag">{result.program}</span>
            <span className="clg-result-tag">{result.language}</span>
            <span className="clg-result-tag">Expires {result.expires_in_hours}h</span>
          </div>
          <div className="clg-url-box">
            <span className="clg-url-text">{result.call_url}</span>
          </div>
          <div className="clg-result-actions">
            <button className="clg-copy-btn" onClick={copy}>
              {copied ? "Copied!" : "Copy Link"}
            </button>
            <button className="clg-whatsapp-btn" onClick={whatsapp}>
              Share via WhatsApp
            </button>
          </div>
          <p className="clg-result-hint">
            Customer opens this link on their phone → taps Start Call → talks to the AI directly.
          </p>
        </div>
      )}
    </div>
  );
}
