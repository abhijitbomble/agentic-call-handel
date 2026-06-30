"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CallbackTask } from "@/lib/types";

type Props = { task: CallbackTask; programName: string; customerPhone?: string };

export function CallbackCard({ task, programName, customerPhone }: Props) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<"resolve" | "remove" | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function updateStatus(status: "resolved" | "removed", resolutionNote: string) {
    setBusyAction(status === "resolved" ? "resolve" : "remove");
    setError(null);
    try {
      const res = await fetch(`/api/callbacks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolution_note: resolutionNote }),
      });
      if (!res.ok) throw new Error("Failed");
      setHidden(true);
      router.refresh();
    } catch {
      setError(status === "removed" ? "Could not remove callback" : "Could not update callback");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyPhone() {
    if (!customerPhone) return;
    await navigator.clipboard.writeText(customerPhone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (hidden) {
    return null;
  }

  return (
    <div className="callback-card">
      <div className="callback-card-header">
        <div>
          <span className="callback-card-id">{task.display_id ?? `CB-${task.id.slice(-5).toUpperCase()}`}</span>
          <span className="callback-card-program">{programName}</span>
        </div>
        <span className={`badge badge-${task.priority}`}>
          {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} priority
        </span>
      </div>

      <div className="callback-customer-block">
        {task.customer_name && <p className="callback-customer-name">{task.customer_name}</p>}
        {customerPhone ? (
          <div className="callback-phone-row">
            <span className="callback-phone">{customerPhone}</span>
            <button className="callback-copy-btn" onClick={copyPhone} title="Copy phone number">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <p className="callback-phone-missing">Phone number not on file</p>
        )}
      </div>

      <p className="callback-card-reason">{task.reason}</p>

      <div className="callback-card-meta">
        <span>Call back by: <strong>{task.scheduled_time ?? task.scheduled_for_label ?? "As soon as possible"}</strong></span>
        <span className={`badge badge-${task.status}`}>{task.status}</span>
      </div>

      <div className="callback-actions">
        <button
          className="callback-resolve-btn"
          onClick={() => updateStatus("resolved", "Marked resolved by supervisor")}
          disabled={busyAction !== null}
        >
          {busyAction === "resolve" ? "Updating..." : "Mark as called back"}
        </button>
        <button
          className="callback-remove-btn"
          onClick={() => updateStatus("removed", "Removed from callback queue by supervisor")}
          disabled={busyAction !== null}
        >
          {busyAction === "remove" ? "Removing..." : "Remove from queue"}
        </button>
      </div>

      {error && <p className="action-feedback action-feedback-error">{error}</p>}
    </div>
  );
}
