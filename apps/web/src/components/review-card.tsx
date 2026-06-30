"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { QAReview } from "@/lib/types";

type Props = { review: QAReview; programName: string };

export function ReviewCard({ review, programName }: Props) {
  const router = useRouter();
  const [score, setScore] = useState(review.score ?? 80);
  const [notes, setNotes] = useState(review.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [done, setDone] = useState(review.status === "reviewed");

  async function submit() {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, notes, status: "reviewed" }),
      });
      if (!res.ok) throw new Error("Failed");
      setDone(true);
      setFeedback("Scored successfully");
      router.refresh();
    } catch {
      setFeedback("Could not save — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-card">
      <div className="review-card-header">
        <div>
          <span className="review-card-id">{review.display_id ?? `QA-${review.id.slice(-5).toUpperCase()}`}</span>
          <span className="review-card-program">{programName}</span>
        </div>
        <span className={`badge badge-${review.status}`}>
          {review.status === "in_review" ? "In Review" : review.status.charAt(0).toUpperCase() + review.status.slice(1)}
        </span>
      </div>

      <div className="review-card-meta">
        <span>Call: <strong>{review.call_display_id ?? review.call_id.slice(0, 8)}</strong></span>
        {review.date_label && <span>{review.date_label}</span>}
        {review.flags.length > 0 && (
          <span className="review-flags">{review.flags.map((f) => f.replaceAll("_", " ")).join(", ")}</span>
        )}
      </div>

      {done ? (
        <div className="review-scored-row">
          <span className="review-score-display">{score}%</span>
          <span style={{ fontSize: "0.78rem", color: "var(--success)" }}>Reviewed ✓</span>
        </div>
      ) : (
        <div className="review-score-form">
          <label className="review-score-label">
            Score
            <div className="review-score-row">
              <input
                type="range"
                min={0}
                max={100}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="review-score-slider"
              />
              <span className="review-score-value">{score}%</span>
            </div>
          </label>
          <label className="review-notes-label">
            Coaching notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="review-notes-input"
              placeholder="Optional coaching note for the agent…"
            />
          </label>
          <button className="review-submit-btn" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Submit score"}
          </button>
        </div>
      )}

      {feedback && (
        <p className={`action-feedback ${done ? "action-feedback-success" : "action-feedback-error"}`}>
          {feedback}
        </p>
      )}
    </div>
  );
}
