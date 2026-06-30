"use client";

import { startTransition, useDeferredValue, useMemo, useState } from "react";

import type { Call, CallTurn, Customer } from "@/lib/types";

type CallWorkbenchProps = {
  calls: Call[];
  customers: Customer[];
  transcript: Record<string, CallTurn[]>;
};

export function CallWorkbench({ calls, customers, transcript }: CallWorkbenchProps) {
  const [languageFilter, setLanguageFilter] = useState<"All" | "English" | "Hindi">("All");
  const [query, setQuery] = useState("");
  const [selectedCallId, setSelectedCallId] = useState(calls[0]?.id ?? "");

  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const matchesLanguage = languageFilter === "All" || call.language === languageFilter;
      const matchesQuery =
        deferredQuery.length === 0 ||
        call.intent.toLowerCase().includes(deferredQuery) ||
        call.summary.toLowerCase().includes(deferredQuery) ||
        call.customer_phone.toLowerCase().includes(deferredQuery);
      return matchesLanguage && matchesQuery;
    });
  }, [calls, deferredQuery, languageFilter]);

  const selectedCall = filteredCalls.find((call) => call.id === selectedCallId) ?? filteredCalls[0] ?? calls[0];
  const selectedCustomer = customers.find((customer) => customer.id === selectedCall?.customer_id);
  const selectedTranscript = (selectedCall ? transcript[selectedCall.id] : []) ?? [];

  return (
    <div className="call-workbench">
      <div className="workbench-toolbar">
        <div className="workbench-segmented">
          {(["All", "English", "Hindi"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={languageFilter === option ? "segment-active" : ""}
              onClick={() => {
                startTransition(() => {
                  setLanguageFilter(option);
                });
              }}
            >
              {option}
            </button>
          ))}
        </div>
        <label className="workbench-search">
          <span>Find by intent, summary, or number</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="claim status, callback, +91..." />
        </label>
      </div>

      <div className="workbench-grid">
        <div className="call-list">
          {filteredCalls.map((call) => (
            <button
              key={call.id}
              type="button"
              className={`call-list-item${selectedCall?.id === call.id ? " call-list-item-active" : ""}`}
              onClick={() => {
                startTransition(() => {
                  setSelectedCallId(call.id);
                });
              }}
            >
              <div className="call-list-topline">
                <strong>{call.intent.replaceAll("_", " ")}</strong>
                <span className={`badge badge-${call.disposition}`}>{call.disposition}</span>
              </div>
              <p>{call.summary}</p>
              <div className="call-list-meta">
                <span>{call.language}</span>
                <span>{call.sentiment}</span>
                <span>{call.customer_phone}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="call-detail">
          {selectedCall ? (
            <>
              <div className="detail-hero">
                <div>
                  <p className="detail-label">Selected session</p>
                  <h3>{selectedCustomer?.full_name ?? selectedCall.customer_phone}</h3>
                  <p>{selectedCall.summary}</p>
                </div>
                <div className="detail-chip-row">
                  <span className={`badge badge-${selectedCall.disposition}`}>{selectedCall.disposition}</span>
                  <span className={`badge badge-${selectedCall.sentiment}`}>{selectedCall.sentiment}</span>
                  <span className="badge badge-default">{selectedCall.language}</span>
                </div>
              </div>
              <div className="detail-grid">
                <article className="detail-stat">
                  <span>Intent</span>
                  <strong>{selectedCall.intent.replaceAll("_", " ")}</strong>
                </article>
                <article className="detail-stat">
                  <span>Verification</span>
                  <strong>{selectedCall.verification_state}</strong>
                </article>
                <article className="detail-stat">
                  <span>Confidence</span>
                  <strong>{Math.round(selectedCall.confidence * 100)}%</strong>
                </article>
              </div>
              <div className="transcript-stack">
                {selectedTranscript.map((turn) => (
                  <div key={turn.id} className={`transcript-bubble transcript-${turn.speaker}`}>
                    <span>{turn.speaker}</span>
                    <p>{turn.message}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty-state">No call matched the current filters.</p>
          )}
        </div>
      </div>
    </div>
  );
}

