"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { CampaignCall, Customer } from "@/lib/types";

type Props = {
  campaignId: string;
  initialStatus: string;
  campaignCalls: CampaignCall[];
  customers: Customer[];
};

const CALL_STATUS_BADGE: Record<string, string> = {
  pending: "badge-default",
  dialing: "badge-medium",
  active: "badge-low",
  resolved: "badge-resolved",
  failed: "badge-high",
};

export function CampaignBoard({ campaignId, initialStatus, campaignCalls: initialCalls, customers }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [calls, setCalls] = useState<CampaignCall[]>(initialCalls);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/calls`);
        if (!res.ok) return;
        const updated = (await res.json()) as CampaignCall[];
        setCalls(updated);
        const allDone = updated.every((call) => call.status === "resolved" || call.status === "failed");
        if (allDone && updated.length > 0) {
          setStatus("completed");
          router.refresh();
        }
      } catch {
        // Ignore polling failures for now.
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [status, campaignId, router]);

  async function startCampaign() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/start`, { method: "POST" });
      const payload = (await res.json().catch(() => null)) as { detail?: string; error?: string } | null;
      if (!res.ok) {
        throw new Error(payload?.detail ?? payload?.error ?? "Could not start campaign");
      }
      setStatus("running");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start - check the backend is running.");
    } finally {
      setBusy(false);
    }
  }

  const dialed = calls.filter((call) => call.status !== "pending").length;
  const resolved = calls.filter((call) => call.status === "resolved").length;
  const failed = calls.filter((call) => call.status === "failed").length;

  return (
    <div className="campaign-board">
      <div className="campaign-board-stats">
        <div className="campaign-board-stat">
          <span>{calls.length}</span>
          <label>Customers</label>
        </div>
        <div className="campaign-board-stat">
          <span>{dialed}</span>
          <label>Dialed</label>
        </div>
        <div className="campaign-board-stat campaign-board-stat-green">
          <span>{resolved}</span>
          <label>Resolved</label>
        </div>
        <div className="campaign-board-stat campaign-board-stat-red">
          <span>{failed}</span>
          <label>Failed</label>
        </div>
      </div>

      {calls.length > 0 && (
        <div className="campaign-board-calls">
          {calls.map((campaignCall) => {
            const customer = customers.find((item) => item.id === campaignCall.customer_id);
            return (
              <div key={campaignCall.id} className="campaign-board-call-row">
                <span className="campaign-board-call-name">{customer?.full_name ?? "Unknown"}</span>
                <span className={`badge ${CALL_STATUS_BADGE[campaignCall.status] ?? "badge-default"}`}>{campaignCall.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="live-call-error" style={{ borderRadius: "6px", marginTop: "8px" }}>{error}</p>}

      {status === "draft" && (
        <button className="campaign-start-btn" onClick={startCampaign} disabled={busy}>
          {busy ? "Starting..." : "Start campaign"}
        </button>
      )}
      {status === "running" && (
        <div className="campaign-running-indicator">
          <span className="supervisor-live-dot" />
          Campaign running - the AI is calling customers
        </div>
      )}
      {status === "completed" && (
        <div className="campaign-done-indicator">
          Campaign complete - all customers have been called
        </div>
      )}
    </div>
  );
}

