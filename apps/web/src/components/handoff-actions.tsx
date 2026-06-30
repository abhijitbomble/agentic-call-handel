"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HandoffActions({ callId }: { callId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  async function escalate() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/calls/${callId}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Supervisor escalation from dashboard", live: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setFeedback({ msg: "Escalated — live handoff requested", ok: true });
      router.refresh();
    } catch (err) {
      setFeedback({ msg: err instanceof Error ? err.message : "Escalation failed", ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function joinCall() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/calls/${callId}/escalate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Supervisor joined the call", live: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setFeedback({ msg: "Joined — you are now connected to this call", ok: true });
      router.refresh();
    } catch (err) {
      setFeedback({ msg: err instanceof Error ? err.message : "Join failed", ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="handoff-actions">
        <button className="btn-escalate" onClick={escalate} disabled={busy}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M10 3v10M5 8l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
          {busy ? "Working…" : "Escalate"}
        </button>
        <button className="btn-join" onClick={joinCall} disabled={busy}>
          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M6.3 3.5h2.5l1.2 3.2-1.8 1.4a12 12 0 0 0 3.6 3.6l1.4-1.8 3.2 1.2v2.5c0 .8-.7 1.5-1.5 1.5A11.4 11.4 0 0 1 3.5 5c0-.8.7-1.5 1.5-1.5" />
          </svg>
          {busy ? "Working…" : "Join Call"}
        </button>
      </div>
      {feedback && (
        <p className={`action-feedback ${feedback.ok ? "action-feedback-success" : "action-feedback-error"}`}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
