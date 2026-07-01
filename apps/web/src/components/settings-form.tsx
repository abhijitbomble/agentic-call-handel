"use client";

import { useMemo, useState } from "react";
import type { Program, ProgramPolicy } from "@/lib/types";

type Props = {
  orgName: string;
  programs: Program[];
};

type PolicyDraft = {
  mode: string;
  requiredFor: string;
  allowedIdentifiers: string;
  liveTriggers: string;
  callbackTriggers: string;
  callbackOnUnavailable: boolean;
  lowConfidenceThreshold: number;
  allowedDocumentTypes: string;
  allowedIntents: string;
  enabledTools: string;
  supportedChannels: string;
  tone: string;
  length: string;
  languagePolicy: string;
  askOneQuestionAtATime: boolean;
  confirmCriticalDetails: boolean;
  summaryBeforeHandoff: boolean;
};

const DEFAULT_DRAFT: PolicyDraft = {
  mode: "ai_first_then_human",
  requiredFor: "case_status",
  allowedIdentifiers: "customer_code, last4_phone",
  liveTriggers: "human_request, angry, verification_failures, low_confidence, high_risk",
  callbackTriggers: "no_agent_available, outside_business_hours, callback_request, low_confidence",
  callbackOnUnavailable: true,
  lowConfidenceThreshold: 0.4,
  allowedDocumentTypes: "faq, policy, procedure",
  allowedIntents: "faq_answer, case_status, policy_query, payment_issue",
  enabledTools: "lookup_case, create_ticket, create_callback, request_handoff, verify_customer",
  supportedChannels: "phone, browser",
  tone: "calm",
  length: "short",
  languagePolicy: "match_caller",
  askOneQuestionAtATime: true,
  confirmCriticalDetails: true,
  summaryBeforeHandoff: true,
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (current && typeof current === "object" && !Array.isArray(current) && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function normalizedPolicy(program: Program): ProgramPolicy {
  const base: ProgramPolicy = {
    version: 1,
    mode: "ai_first_then_human",
    intent_policy: {
      allowed_intents: ["greeting", "faq_answer", "case_status", "policy_query", "payment_issue", "complaint", "callback_request", "human_transfer", "verification"],
      default_intent: "unknown_needs_clarification",
      blocked_intents: [],
    },
    confidence_policy: {
      answer_threshold: 0.8,
      clarify_threshold: 0.55,
      escalate_threshold: 0.4,
      max_clarify_turns: 1,
    },
    fallback_policy: {
      on_low_confidence: "clarify_then_escalate",
      on_no_kb_match: "ask_clarify",
      on_missing_required_data: "ask_one_question",
      on_silent_user: "repeat_prompt_once",
    },
    verification_policy: {
      required_for: ["case_status"],
      allowed_identifiers: ["customer_code", "last4_phone"],
    },
    escalation_policy: {
      live_triggers: ["human_request", "angry", "verification_failures", "low_confidence", "high_risk"],
      callback_when_unavailable: true,
      callback_triggers: ["no_agent_available", "outside_business_hours", "callback_request", "low_confidence"],
      require_summary_before_handoff: true,
    },
    kb_policy: {
      allowed_document_types: ["faq", "policy", "procedure"],
      allowed_intents: ["faq_answer", "case_status", "policy_query", "payment_issue"],
      must_be_approved: true,
      match_same_program_only: true,
    },
    tool_policy: {
      enabled_tools: ["lookup_case", "create_ticket", "create_callback", "request_handoff", "verify_customer"],
    },
    response_style: {
      tone: "calm",
      length: "short",
      language_policy: "match_caller",
      ask_one_question_at_a_time: true,
      confirm_critical_details: true,
    },
    queue_policy: {
      live_handoff_enabled: true,
      callback_enabled: true,
      supported_channels: ["phone", "browser"],
    },
  };

  const raw = program.policy_json ?? {};
  const merged = deepMerge(base, raw as Record<string, unknown>);
  merged.verification_policy = deepMerge(
    base.verification_policy as Record<string, unknown>,
    (program.verification_policy ?? {}) as Record<string, unknown>,
  ) as ProgramPolicy["verification_policy"];
  merged.handoff_policy = {
    live_on: program.handoff_policy?.live_on ?? [],
    callback_on_unavailable: program.handoff_policy?.callback_on_unavailable ?? true,
    low_confidence_threshold: program.handoff_policy?.low_confidence_threshold ?? 0.4,
  } as NonNullable<ProgramPolicy["handoff_policy"]>;
  return merged;
}

function policyToDraft(program: Program): PolicyDraft {
  const policy = normalizedPolicy(program);
  return {
    mode: String(policy.mode ?? DEFAULT_DRAFT.mode),
    requiredFor: joinList(policy.verification_policy?.required_for),
    allowedIdentifiers: joinList(policy.verification_policy?.allowed_identifiers),
    liveTriggers: joinList(policy.escalation_policy?.live_triggers),
    callbackTriggers: joinList(policy.escalation_policy?.callback_triggers),
    callbackOnUnavailable: Boolean(policy.escalation_policy?.callback_when_unavailable ?? true),
    lowConfidenceThreshold: Number(policy.confidence_policy?.escalate_threshold ?? DEFAULT_DRAFT.lowConfidenceThreshold),
    allowedDocumentTypes: joinList(policy.kb_policy?.allowed_document_types),
    allowedIntents: joinList(policy.kb_policy?.allowed_intents),
    enabledTools: joinList(policy.tool_policy?.enabled_tools),
    supportedChannels: joinList(policy.queue_policy?.supported_channels),
    tone: String(policy.response_style?.tone ?? DEFAULT_DRAFT.tone),
    length: String(policy.response_style?.length ?? DEFAULT_DRAFT.length),
    languagePolicy: String(policy.response_style?.language_policy ?? DEFAULT_DRAFT.languagePolicy),
    askOneQuestionAtATime: Boolean(policy.response_style?.ask_one_question_at_a_time ?? true),
    confirmCriticalDetails: Boolean(policy.response_style?.confirm_critical_details ?? true),
    summaryBeforeHandoff: Boolean(policy.escalation_policy?.require_summary_before_handoff ?? true),
  };
}

function draftToPolicy(program: Program, draft: PolicyDraft): ProgramPolicy {
  const current = normalizedPolicy(program);
  return {
    ...current,
    mode: draft.mode,
    verification_policy: {
      required_for: splitList(draft.requiredFor),
      allowed_identifiers: splitList(draft.allowedIdentifiers),
    },
    confidence_policy: {
      answer_threshold: current.confidence_policy?.answer_threshold ?? 0.8,
      clarify_threshold: current.confidence_policy?.clarify_threshold ?? 0.55,
      escalate_threshold: draft.lowConfidenceThreshold,
      max_clarify_turns: current.confidence_policy?.max_clarify_turns ?? 1,
    },
    escalation_policy: {
      live_triggers: splitList(draft.liveTriggers),
      callback_when_unavailable: draft.callbackOnUnavailable,
      callback_triggers: splitList(draft.callbackTriggers),
      require_summary_before_handoff: draft.summaryBeforeHandoff,
    },
    kb_policy: {
      allowed_document_types: splitList(draft.allowedDocumentTypes),
      allowed_intents: splitList(draft.allowedIntents),
      must_be_approved: true,
      match_same_program_only: true,
    },
    tool_policy: {
      enabled_tools: splitList(draft.enabledTools),
    },
    response_style: {
      tone: draft.tone,
      length: draft.length,
      language_policy: draft.languagePolicy,
      ask_one_question_at_a_time: draft.askOneQuestionAtATime,
      confirm_critical_details: draft.confirmCriticalDetails,
    },
    queue_policy: {
      live_handoff_enabled: true,
      callback_enabled: true,
      supported_channels: splitList(draft.supportedChannels),
    },
  };
}

export function SettingsForm({ orgName, programs }: Props) {
  const [items, setItems] = useState(programs);
  const [selectedProgramId, setSelectedProgramId] = useState(programs[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Record<string, PolicyDraft>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedProgram = useMemo(() => items.find((program) => program.id === selectedProgramId) ?? items[0], [items, selectedProgramId]);
  const draft = selectedProgram ? (drafts[selectedProgram.id] ?? policyToDraft(selectedProgram)) : DEFAULT_DRAFT;

  if (!selectedProgram) {
    return (
      <div className="page-content">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Settings</span>
          </div>
          <div style={{ padding: 16 }}>No client programs are available yet for {orgName}.</div>
        </div>
      </div>
    );
  }

  function updateDraft(patch: Partial<PolicyDraft>) {
    if (!selectedProgram) return;
    setDrafts((prev) => ({
      ...prev,
      [selectedProgram.id]: {
        ...(prev[selectedProgram.id] ?? policyToDraft(selectedProgram)),
        ...patch,
      },
    }));
    setStatus(null);
  }

  function selectProgram(programId: string) {
    setSelectedProgramId(programId);
    setStatus(null);
    const program = items.find((item) => item.id === programId);
    if (program) {
      setDrafts((prev) => prev[programId] ? prev : { ...prev, [programId]: policyToDraft(program) });
    }
  }

  async function savePolicy() {
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/programs/${selectedProgram.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_json: draftToPolicy(selectedProgram, draft),
          policy_status: "active",
        }),
      });
      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
      }
      const updated = (await response.json()) as Program;
      setItems((prev) => prev.map((program) => (program.id === updated.id ? updated : program)));
      setDrafts((prev) => ({ ...prev, [updated.id]: policyToDraft(updated) }));
      setStatus("Saved and published to the live policy engine.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const programsById = new Map(items.map((program) => [program.id, program]));
  const current = programsById.get(selectedProgram.id) ?? selectedProgram;

  return (
    <div className="page-content">
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.3rem", color: "var(--ink)" }}>Program policy editor</h2>
        <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
          Update the live AI policy for {orgName}. Changes apply to new calls immediately after save.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-header">
          <span className="panel-title">Select program</span>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <select
            value={selectedProgram.id}
            onChange={(e) => selectProgram(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)", maxWidth: 420 }}
          >
            {items.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
          </select>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="badge badge-default">Policy version {current.policy_version ?? 1}</span>
            <span className="badge badge-default">{current.policy_status ?? "active"}</span>
            <span className="badge badge-default">{current.languages.join(" / ")}</span>
          </div>
        </div>
      </div>

      <div className="double-grid" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Call mode</span></div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Operating mode</span>
                <select value={draft.mode} onChange={(e) => updateDraft({ mode: e.target.value })} style={{ padding: 10, borderRadius: 10 }}>
                  <option value="ai_first_then_human">AI first, then human on approved triggers</option>
                  <option value="ai_only">AI only</option>
                  <option value="callback_only">Callback only fallback</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Supported channels</span>
                <input value={draft.supportedChannels} onChange={(e) => updateDraft({ supportedChannels: e.target.value })} placeholder="phone, browser" style={{ padding: 10, borderRadius: 10 }} />
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Verification</span></div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Required for intents</span>
                <input value={draft.requiredFor} onChange={(e) => updateDraft({ requiredFor: e.target.value })} placeholder="case_status" style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Allowed identifiers</span>
                <input value={draft.allowedIdentifiers} onChange={(e) => updateDraft({ allowedIdentifiers: e.target.value })} placeholder="customer_code, last4_phone" style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Low confidence threshold</span>
                <input type="number" min="0" max="1" step="0.05" value={draft.lowConfidenceThreshold} onChange={(e) => updateDraft({ lowConfidenceThreshold: Number(e.target.value) })} style={{ padding: 10, borderRadius: 10 }} />
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Escalation</span></div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Live handoff triggers</span>
                <input value={draft.liveTriggers} onChange={(e) => updateDraft({ liveTriggers: e.target.value })} placeholder="human_request, angry, verification_failures" style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Callback triggers</span>
                <input value={draft.callbackTriggers} onChange={(e) => updateDraft({ callbackTriggers: e.target.value })} placeholder="no_agent_available, callback_request" style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={draft.callbackOnUnavailable} onChange={(e) => updateDraft({ callbackOnUnavailable: e.target.checked })} />
                <span style={{ fontWeight: 600, fontSize: 12 }}>Queue callback when no agent is available</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={draft.summaryBeforeHandoff} onChange={(e) => updateDraft({ summaryBeforeHandoff: e.target.checked })} />
                <span style={{ fontWeight: 600, fontSize: 12 }}>Require summary before handoff</span>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          <div className="panel">
            <div className="panel-header"><span className="panel-title">Knowledge + tools</span></div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Allowed document types</span>
                <input value={draft.allowedDocumentTypes} onChange={(e) => updateDraft({ allowedDocumentTypes: e.target.value })} placeholder="faq, policy, procedure" style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Allowed intents for KB answers</span>
                <input value={draft.allowedIntents} onChange={(e) => updateDraft({ allowedIntents: e.target.value })} placeholder="faq_answer, case_status" style={{ padding: 10, borderRadius: 10 }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Enabled tools</span>
                <input value={draft.enabledTools} onChange={(e) => updateDraft({ enabledTools: e.target.value })} placeholder="lookup_case, create_ticket" style={{ padding: 10, borderRadius: 10 }} />
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Response style</span></div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Tone</span>
                <select value={draft.tone} onChange={(e) => updateDraft({ tone: e.target.value })} style={{ padding: 10, borderRadius: 10 }}>
                  <option value="calm">Calm</option>
                  <option value="warm">Warm</option>
                  <option value="formal">Formal</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Length</span>
                <select value={draft.length} onChange={(e) => updateDraft({ length: e.target.value })} style={{ padding: 10, borderRadius: 10 }}>
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Language policy</span>
                <select value={draft.languagePolicy} onChange={(e) => updateDraft({ languagePolicy: e.target.value })} style={{ padding: 10, borderRadius: 10 }}>
                  <option value="match_caller">Match caller language</option>
                  <option value="english_first">English first</option>
                </select>
              </label>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header"><span className="panel-title">Current policy preview</span></div>
            <div style={{ padding: 16 }}>
              <pre style={{ margin: 0, padding: 12, overflowX: "auto", borderRadius: 12, background: "rgba(28,42,43,0.04)", fontSize: 12, lineHeight: 1.5 }}>
                {JSON.stringify(draftToPolicy(current, draft), null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 14 }}>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
          Changes are written to the live policy JSON and mirrored into the legacy verification and handoff fields.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {status && <span style={{ color: status.startsWith("Saved") ? "var(--success)" : "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status}</span>}
          <button
            onClick={savePolicy}
            disabled={saving}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "10px 18px",
              background: saving ? "rgba(15,123,119,0.45)" : "var(--accent)",
              color: "white",
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {saving ? "Saving..." : "Save policy"}
          </button>
        </div>
      </div>
    </div>
  );
}
