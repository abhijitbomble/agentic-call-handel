"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = { ticketId: string; currentStatus: string };

const NEXT_STATUS: Record<string, string> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: "closed",
};

const ACTION_LABEL: Record<string, string> = {
  open: "Start work",
  in_progress: "Mark resolved",
  resolved: "Close ticket",
};

export function TicketActions({ ticketId, currentStatus }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus = NEXT_STATUS[currentStatus];
  if (!nextStatus || currentStatus === "closed") {
    return <span style={{ fontSize: "0.74rem", color: "var(--muted)" }}>Closed</span>;
  }
  if (done) {
    return <span style={{ fontSize: "0.74rem", color: "var(--success)", fontWeight: 600 }}>Updated ✓</span>;
  }

  async function update() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <button
        onClick={update}
        disabled={busy}
        className="ticket-action-btn"
      >
        {busy ? "…" : ACTION_LABEL[currentStatus]}
      </button>
      {error && <span style={{ fontSize: "0.7rem", color: "var(--warning)" }}>{error}</span>}
    </div>
  );
}
