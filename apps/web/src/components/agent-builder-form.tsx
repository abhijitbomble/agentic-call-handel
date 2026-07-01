"use client";

import { useEffect, useMemo, useState } from "react";
import type { Program, ProgramPolicy, ProgramPolicyRuntime } from "@/lib/types";

type Props = {
  orgName: string;
  programs: Program[];
};

type BuilderDraft = {
  template: string;
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

type ValidationFinding = {
  kind: "success" | "warning" | "info";
  title: string;
  detail: string;
};

type OnboardingMilestone = {
  title: string;
  detail: string;
  complete: boolean;
};

type ChangeSummaryItem = {
  label: string;
  value: string;
};

type BuilderStep = "template" | "basics" | "caller" | "kb" | "escalation" | "tools" | "review";
type TemplateId = "general_inbound" | "support" | "claims" | "billing" | "collections" | "custom";

type TemplatePreset = {
  label: string;
  description: string;
  draft: Partial<BuilderDraft>;
};

const DEFAULT_DRAFT: BuilderDraft = {
  template: "custom",
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

const STEP_DEFS: { id: BuilderStep; label: string; description: string }[] = [
  { id: "template", label: "Template", description: "Start with a preset" },
  { id: "basics", label: "Basics", description: "Choose the core behavior" },
  { id: "caller", label: "Caller", description: "Set verification rules" },
  { id: "kb", label: "KB", description: "Control what it can read" },
  { id: "escalation", label: "Escalation", description: "Define human handoff" },
  { id: "tools", label: "Tools", description: "Pick allowed actions" },
  { id: "review", label: "Review", description: "Check before publish" },
];

const TEMPLATE_PRESETS: Record<TemplateId, TemplatePreset> = {
  general_inbound: {
    label: "General inbound",
    description: "Balanced starting point for most support desks.",
    draft: {
      template: "general_inbound",
      mode: "ai_first_then_human",
      requiredFor: "case_status, policy_query",
      allowedIdentifiers: "customer_code, last4_phone",
      liveTriggers: "human_request, angry, verification_failures, low_confidence",
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
    },
  },
  support: {
    label: "Support",
    description: "Good for helpdesk and product support teams.",
    draft: {
      template: "support",
      mode: "ai_first_then_human",
      requiredFor: "case_status, policy_query",
      allowedIdentifiers: "customer_code, last4_phone",
      liveTriggers: "human_request, angry, low_confidence",
      callbackTriggers: "no_agent_available, callback_request, low_confidence",
      callbackOnUnavailable: true,
      lowConfidenceThreshold: 0.45,
      allowedDocumentTypes: "faq, procedure",
      allowedIntents: "faq_answer, case_status, policy_query",
      enabledTools: "lookup_case, create_ticket, create_callback, request_handoff, verify_customer",
      supportedChannels: "phone, browser",
      tone: "warm",
      length: "short",
      languagePolicy: "match_caller",
      askOneQuestionAtATime: true,
      confirmCriticalDetails: true,
      summaryBeforeHandoff: true,
    },
  },
  claims: {
    label: "Claims",
    description: "Stricter verification and escalation for claims flows.",
    draft: {
      template: "claims",
      mode: "ai_first_then_human",
      requiredFor: "case_status, policy_query, payment_issue",
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
      length: "medium",
      languagePolicy: "match_caller",
      askOneQuestionAtATime: true,
      confirmCriticalDetails: true,
      summaryBeforeHandoff: true,
    },
  },
  billing: {
    label: "Billing",
    description: "Use for payment, due date, and billing help.",
    draft: {
      template: "billing",
      mode: "ai_first_then_human",
      requiredFor: "case_status, payment_issue",
      allowedIdentifiers: "customer_code, last4_phone",
      liveTriggers: "human_request, angry, low_confidence",
      callbackTriggers: "no_agent_available, outside_business_hours, callback_request, low_confidence",
      callbackOnUnavailable: true,
      lowConfidenceThreshold: 0.45,
      allowedDocumentTypes: "faq, policy, procedure",
      allowedIntents: "faq_answer, case_status, payment_issue",
      enabledTools: "lookup_case, create_ticket, create_callback, request_handoff, verify_customer",
      supportedChannels: "phone, browser",
      tone: "formal",
      length: "short",
      languagePolicy: "match_caller",
      askOneQuestionAtATime: true,
      confirmCriticalDetails: true,
      summaryBeforeHandoff: true,
    },
  },
  collections: {
    label: "Collections",
    description: "Prefer callback fallback and careful language.",
    draft: {
      template: "collections",
      mode: "ai_first_then_human",
      requiredFor: "payment_issue",
      allowedIdentifiers: "customer_code, last4_phone",
      liveTriggers: "human_request, angry, low_confidence",
      callbackTriggers: "no_agent_available, outside_business_hours, callback_request, low_confidence",
      callbackOnUnavailable: true,
      lowConfidenceThreshold: 0.5,
      allowedDocumentTypes: "faq, policy",
      allowedIntents: "faq_answer, payment_issue, case_status",
      enabledTools: "lookup_case, create_callback, request_handoff, verify_customer",
      supportedChannels: "phone, browser",
      tone: "formal",
      length: "short",
      languagePolicy: "english_first",
      askOneQuestionAtATime: true,
      confirmCriticalDetails: true,
      summaryBeforeHandoff: true,
    },
  },
  custom: {
    label: "Custom",
    description: "Start from the current program settings.",
    draft: {
      template: "custom",
    },
  },
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

function basePolicy(): ProgramPolicy {
  return {
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
}

function normalizePolicy(program: Program): ProgramPolicy {
  const merged = deepMerge(basePolicy() as Record<string, unknown>, (program.policy_json ?? {}) as Record<string, unknown>) as ProgramPolicy;
  merged.verification_policy = deepMerge(
    basePolicy().verification_policy as Record<string, unknown>,
    (program.verification_policy ?? {}) as Record<string, unknown>,
  ) as ProgramPolicy["verification_policy"];
  merged.handoff_policy = {
    live_on: program.handoff_policy?.live_on ?? [],
    callback_on_unavailable: program.handoff_policy?.callback_on_unavailable ?? true,
    low_confidence_threshold: program.handoff_policy?.low_confidence_threshold ?? 0.4,
  } as NonNullable<ProgramPolicy["handoff_policy"]>;
  return merged;
}

function draftFromProgram(program: Program): BuilderDraft {
  const policy = normalizePolicy(program);
  return {
    template: "custom",
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

function applyTemplateToDraft(draft: BuilderDraft, templateId: TemplateId): BuilderDraft {
  return {
    ...draft,
    ...TEMPLATE_PRESETS[templateId].draft,
    template: templateId,
  };
}

function policyFromDraft(program: Program, draft: BuilderDraft): ProgramPolicy {
  const current = normalizePolicy(program);
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

function pill(label: string, value: string) {
  return (
    <span className="badge badge-default" style={{ fontSize: "0.74rem" }}>
      {label}: {value}
    </span>
  );
}

function buildValidationFindings(policy: ProgramPolicy): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const mode = String(policy.mode ?? "ai_first_then_human");
  const channels = policy.queue_policy?.supported_channels ?? [];
  const liveTriggers = policy.escalation_policy?.live_triggers ?? [];
  const callbackTriggers = policy.escalation_policy?.callback_triggers ?? [];
  const kbIntents = policy.kb_policy?.allowed_intents ?? [];
  const kbDocs = policy.kb_policy?.allowed_document_types ?? [];
  const verifiedFor = policy.verification_policy?.required_for ?? [];
  const threshold = policy.confidence_policy?.escalate_threshold ?? 0.4;

  findings.push({
    kind: "success",
    title: "Operating mode",
    detail:
      mode === "ai_only"
        ? "AI answers every supported request and never hands off to a human."
        : mode === "callback_only"
          ? "The system prefers callback fallback instead of live handoff when escalation is needed."
          : "AI handles the call first and escalates to a human only on approved triggers.",
  });

  findings.push({
    kind: channels.length > 0 ? "success" : "warning",
    title: "Supported channels",
    detail: channels.length > 0 ? channels.join(", ") : "No channels selected, so the program cannot be routed safely.",
  });

  findings.push({
    kind: verifiedFor.length > 0 ? "info" : "warning",
    title: "Verification scope",
    detail:
      verifiedFor.length > 0
        ? `Verification is required for ${verifiedFor.join(", ")} using ${policy.verification_policy?.allowed_identifiers?.join(", ") || "no identifiers yet"}.`
        : "No intents require verification yet, which may be too loose for some programs.",
  });

  findings.push({
    kind: kbIntents.length > 0 && kbDocs.length > 0 ? "success" : "warning",
    title: "KB access",
    detail:
      kbIntents.length > 0 && kbDocs.length > 0
        ? `KB answers are limited to ${kbIntents.join(", ")} using ${kbDocs.join(", ")} documents.`
        : "KB scope is incomplete, so the agent may have nothing approved to cite.",
  });

  findings.push({
    kind: liveTriggers.length > 0 ? "success" : "warning",
    title: "Live handoff",
    detail:
      liveTriggers.length > 0
        ? `Human escalation is triggered by ${liveTriggers.join(", ")}.`
        : "No live handoff triggers are set, so the agent cannot escalate cleanly.",
  });

  findings.push({
    kind: callbackTriggers.length > 0 ? "info" : "warning",
    title: "Callback fallback",
    detail:
      callbackTriggers.length > 0
        ? `Callback fallback is enabled for ${callbackTriggers.join(", ")}.`
        : "Callback fallback is not configured yet, so unavailable-agent cases need attention.",
  });

  findings.push({
    kind: threshold < 0.25 || threshold > 0.75 ? "warning" : "info",
    title: "Confidence threshold",
    detail:
      threshold < 0.25
        ? `Escalation starts very late at ${threshold.toFixed(2)} and may keep callers waiting.`
        : threshold > 0.75
          ? `Escalation starts very early at ${threshold.toFixed(2)} and may hand off too quickly.`
          : `Escalation starts at ${threshold.toFixed(2)}, which is a balanced middle ground.`,
  });

  if (policy.escalation_policy?.require_summary_before_handoff) {
    findings.push({
      kind: "success",
      title: "Handoff package",
      detail: "The agent will summarize the conversation before a human joins.",
    });
  }

  return findings;
}

function findingsFromRuntime(runtime: ProgramPolicyRuntime | null): ValidationFinding[] {
  if (!runtime) return [];
  const findings: ValidationFinding[] = [];
  const mode = runtime.mode;
  const channels = runtime.queue_policy?.supported_channels ?? [];
  const liveTriggers = runtime.escalation_policy?.live_triggers ?? [];
  const callbackTriggers = runtime.escalation_policy?.callback_triggers ?? [];
  const kbIntents = runtime.kb_policy?.allowed_intents ?? [];
  const kbDocs = runtime.kb_policy?.allowed_document_types ?? [];
  const verifiedFor = runtime.verification_policy?.required_for ?? [];
  const threshold = runtime.confidence_policy?.escalate_threshold ?? 0.4;

  findings.push({
    kind: "success",
    title: "Runtime mode",
    detail:
      mode === "ai_only"
        ? "Live engine will keep the call AI-only."
        : mode === "callback_only"
          ? "Live engine will fall back to callback routing when escalation is needed."
          : "Live engine will start with AI and escalate only on approved triggers.",
  });
  findings.push({
    kind: channels.length > 0 ? "success" : "warning",
    title: "Runtime channels",
    detail: channels.length > 0 ? channels.join(", ") : "No runtime channels are enabled.",
  });
  findings.push({
    kind: verifiedFor.length > 0 ? "info" : "warning",
    title: "Runtime verification",
    detail: verifiedFor.length > 0 ? `Verification required for ${verifiedFor.join(", ")}.` : "No intents require verification at runtime.",
  });
  findings.push({
    kind: kbIntents.length > 0 && kbDocs.length > 0 ? "success" : "warning",
    title: "Runtime KB",
    detail: kbIntents.length > 0 && kbDocs.length > 0 ? `KB answers are limited to ${kbIntents.join(", ")}.` : "KB answering is effectively disabled at runtime.",
  });
  findings.push({
    kind: liveTriggers.length > 0 ? "success" : "warning",
    title: "Runtime live handoff",
    detail: liveTriggers.length > 0 ? `Live escalation triggers: ${liveTriggers.join(", ")}.` : "No live escalation triggers are enabled.",
  });
  findings.push({
    kind: callbackTriggers.length > 0 ? "info" : "warning",
    title: "Runtime callback fallback",
    detail: callbackTriggers.length > 0 ? `Callback triggers: ${callbackTriggers.join(", ")}.` : "No callback triggers are configured.",
  });
  findings.push({
    kind: threshold < 0.25 || threshold > 0.75 ? "warning" : "info",
    title: "Runtime threshold",
    detail:
      threshold < 0.25
        ? `Escalation threshold is very low (${threshold.toFixed(2)}).`
        : threshold > 0.75
          ? `Escalation threshold is very high (${threshold.toFixed(2)}).`
          : `Escalation threshold is ${threshold.toFixed(2)}.`,
  });
  if (runtime.warnings.length) {
    for (const warning of runtime.warnings) {
      findings.push({ kind: "warning", title: "Backend warning", detail: warning });
    }
  }
  return findings;
}

function summarizePolicyChanges(currentPolicy: ProgramPolicy, draftPolicy: ProgramPolicy): ChangeSummaryItem[] {
  const changes: ChangeSummaryItem[] = [];

  const addChange = (label: string, currentValue: string, nextValue: string) => {
    if (currentValue === nextValue) return;
    changes.push({ label, value: `${currentValue || "none"} -> ${nextValue || "none"}` });
  };

  addChange("Mode", String(currentPolicy.mode ?? "unknown"), String(draftPolicy.mode ?? "unknown"));
  addChange("Channels", joinList(currentPolicy.queue_policy?.supported_channels), joinList(draftPolicy.queue_policy?.supported_channels));
  addChange("Verification", joinList(currentPolicy.verification_policy?.required_for), joinList(draftPolicy.verification_policy?.required_for));

  const currentKbScope = `${joinList(currentPolicy.kb_policy?.allowed_document_types)}|${joinList(currentPolicy.kb_policy?.allowed_intents)}`;
  const draftKbScope = `${joinList(draftPolicy.kb_policy?.allowed_document_types)}|${joinList(draftPolicy.kb_policy?.allowed_intents)}`;
  if (currentKbScope !== draftKbScope) {
    changes.push({
      label: "KB scope",
      value: `${joinList(currentPolicy.kb_policy?.allowed_document_types) || "none"} / ${joinList(currentPolicy.kb_policy?.allowed_intents) || "none"} -> ${joinList(draftPolicy.kb_policy?.allowed_document_types) || "none"} / ${joinList(draftPolicy.kb_policy?.allowed_intents) || "none"}`,
    });
  }

  addChange("Escalation", joinList(currentPolicy.escalation_policy?.live_triggers), joinList(draftPolicy.escalation_policy?.live_triggers));
  addChange("Tools", joinList(currentPolicy.tool_policy?.enabled_tools), joinList(draftPolicy.tool_policy?.enabled_tools));

  return changes;
  return [
    {
      label: "Mode",
      value: currentPolicy.mode === draftPolicy.mode ? String(draftPolicy.mode) : `${currentPolicy.mode ?? "unknown"} → ${draftPolicy.mode ?? "unknown"}`,
    },
    {
      label: "Channels",
      value: joinList(currentPolicy.queue_policy?.supported_channels) === joinList(draftPolicy.queue_policy?.supported_channels)
        ? joinList(draftPolicy.queue_policy?.supported_channels)
        : `${joinList(currentPolicy.queue_policy?.supported_channels) || "none"} → ${joinList(draftPolicy.queue_policy?.supported_channels) || "none"}`,
    },
    {
      label: "Verification",
      value: joinList(currentPolicy.verification_policy?.required_for) === joinList(draftPolicy.verification_policy?.required_for)
        ? (joinList(draftPolicy.verification_policy?.required_for) || "none")
        : `${joinList(currentPolicy.verification_policy?.required_for) || "none"} → ${joinList(draftPolicy.verification_policy?.required_for) || "none"}`,
    },
    {
      label: "KB scope",
      value:
        joinList(currentPolicy.kb_policy?.allowed_document_types) === joinList(draftPolicy.kb_policy?.allowed_document_types)
          ? `${joinList(draftPolicy.kb_policy?.allowed_document_types) || "none"} / ${joinList(draftPolicy.kb_policy?.allowed_intents) || "none"}`
          : `${joinList(currentPolicy.kb_policy?.allowed_document_types) || "none"} → ${joinList(draftPolicy.kb_policy?.allowed_document_types) || "none"}`,
    },
    {
      label: "Escalation",
      value:
        joinList(currentPolicy.escalation_policy?.live_triggers) === joinList(draftPolicy.escalation_policy?.live_triggers)
          ? joinList(draftPolicy.escalation_policy?.live_triggers) || "none"
          : `${joinList(currentPolicy.escalation_policy?.live_triggers) || "none"} → ${joinList(draftPolicy.escalation_policy?.live_triggers) || "none"}`,
    },
    {
      label: "Tools",
      value:
        joinList(currentPolicy.tool_policy?.enabled_tools) === joinList(draftPolicy.tool_policy?.enabled_tools)
          ? joinList(draftPolicy.tool_policy?.enabled_tools) || "none"
          : `${joinList(currentPolicy.tool_policy?.enabled_tools) || "none"} → ${joinList(draftPolicy.tool_policy?.enabled_tools) || "none"}`,
    },
  ];
}

function buildOnboardingMilestones(templateId: TemplateId, draft: BuilderDraft, previewFindings: ValidationFinding[]): OnboardingMilestone[] {
  const channelList = splitList(draft.supportedChannels);
  const kbDocs = splitList(draft.allowedDocumentTypes);
  const kbIntents = splitList(draft.allowedIntents);
  const liveTriggers = splitList(draft.liveTriggers);
  const callbackTriggers = splitList(draft.callbackTriggers);
  const warningCount = previewFindings.filter((finding) => finding.kind === "warning").length;

  return [
    {
      title: "Pick an agent type",
      detail: templateId === "custom" ? "Choose a preset such as support, claims, billing, or collections." : `Using the ${templateId.replaceAll("_", " ")} preset as the starting policy pack.`,
      complete: templateId !== "custom",
    },
    {
      title: "Define call behavior",
      detail:
        draft.mode.length > 0 && channelList.length > 0
          ? `Mode: ${draft.mode}. Channels: ${channelList.join(", ")}.`
          : "Set operating mode and supported channels so the runtime knows how calls should flow.",
      complete: draft.mode.length > 0 && channelList.length > 0,
    },
    {
      title: "Attach knowledge",
      detail:
        kbDocs.length > 0 && kbIntents.length > 0
          ? `KB scope: ${kbDocs.join(", ")} documents for ${kbIntents.join(", ")} intents.`
          : "Upload KB files or add articles, then decide which document types and intents the agent may use.",
      complete: kbDocs.length > 0 && kbIntents.length > 0,
    },
    {
      title: "Set escalation rules",
      detail:
        liveTriggers.length > 0 || callbackTriggers.length > 0
          ? `Live: ${liveTriggers.join(", ") || "none"}. Callback: ${callbackTriggers.join(", ") || "none"}.`
          : "Choose live handoff triggers and callback fallback behavior for unavailable-agent cases.",
      complete: liveTriggers.length > 0 && callbackTriggers.length > 0,
    },
    {
      title: "Publish safely",
      detail:
        warningCount === 0
          ? "Preview is clean and ready to publish into the live policy engine."
          : `${warningCount} warning${warningCount === 1 ? "" : "s"} still need attention before launch.`,
      complete: warningCount === 0,
    },
  ];
}

export function AgentBuilderForm({ orgName, programs }: Props) {
  const [items, setItems] = useState(programs);
  const [selectedProgramId, setSelectedProgramId] = useState(programs[0]?.id ?? "");
  const [selectedStep, setSelectedStep] = useState<BuilderStep>("template");
  const [drafts, setDrafts] = useState<Record<string, BuilderDraft>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);
  const [runtime, setRuntime] = useState<ProgramPolicyRuntime | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<string | null>(null);

  const selectedProgram = useMemo(() => items.find((program) => program.id === selectedProgramId) ?? items[0], [items, selectedProgramId]);
  const draft = selectedProgram ? (drafts[selectedProgram.id] ?? draftFromProgram(selectedProgram)) : DEFAULT_DRAFT;
  const templateId = (draft.template as TemplateId) ?? "custom";
  const selectedStepIndex = useMemo(() => STEP_DEFS.findIndex((step) => step.id === selectedStep), [selectedStep]);
  const canGoBack = selectedStepIndex > 0;
  const canGoNext = selectedStepIndex >= 0 && selectedStepIndex < STEP_DEFS.length - 1;
  const previewPolicy = selectedProgram ? policyFromDraft(selectedProgram, draft) : basePolicy();
  const previewFindings = useMemo(
    () => (selectedProgram ? buildValidationFindings(policyFromDraft(selectedProgram, draft)) : []),
    [draft, selectedProgram],
  );
  const runtimeFindings = useMemo(() => findingsFromRuntime(runtime), [runtime]);
  const onboardingMilestones = useMemo(
    () => buildOnboardingMilestones(templateId, draft, previewFindings),
    [draft, previewFindings, templateId],
  );
  const changeSummary = useMemo(
    () => (selectedProgram ? summarizePolicyChanges(normalizePolicy(selectedProgram), previewPolicy) : []),
    [selectedProgram, previewPolicy],
  );
  const onboardingCompleteCount = onboardingMilestones.filter((item) => item.complete).length;
  const nextMilestone = onboardingMilestones.find((item) => !item.complete);

  useEffect(() => {
    if (!selectedProgram) return;
    let cancelled = false;
    fetch(`/api/programs/${selectedProgram.id}/policy/runtime`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Runtime fetch failed (${response.status})`);
        }
        return (await response.json()) as ProgramPolicyRuntime;
      })
      .then((data) => {
        if (cancelled) return;
        setRuntime(data);
        setRuntimeStatus(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setRuntime(null);
        setRuntimeStatus(error instanceof Error ? error.message : "Runtime fetch failed");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProgram]);

  function selectProgram(programId: string) {
    setSelectedProgramId(programId);
    setStatus(null);
    setRuntime(null);
    setRuntimeStatus(null);
    const program = items.find((item) => item.id === programId);
    if (program) {
      setDrafts((prev) => (prev[programId] ? prev : { ...prev, [programId]: draftFromProgram(program) }));
    }
  }

  function updateDraft(patch: Partial<BuilderDraft>) {
    if (!selectedProgram) return;
    setStatus(null);
    setDrafts((prev) => ({
      ...prev,
      [selectedProgram.id]: {
        ...(prev[selectedProgram.id] ?? draftFromProgram(selectedProgram)),
        ...patch,
      },
    }));
  }

  function applyTemplate(template: TemplateId) {
    if (!selectedProgram) return;
    setStatus(null);
    setDrafts((prev) => {
      const currentDraft = prev[selectedProgram.id] ?? draftFromProgram(selectedProgram);
      return {
        ...prev,
        [selectedProgram.id]: applyTemplateToDraft(currentDraft, template),
      };
    });
    setSelectedStep("basics");
  }

  function goToPreviousStep() {
    if (!canGoBack) return;
    setSelectedStep(STEP_DEFS[selectedStepIndex - 1].id);
  }

  function goToNextStep() {
    if (!canGoNext) return;
    setSelectedStep(STEP_DEFS[selectedStepIndex + 1].id);
  }

  async function savePolicy() {
    if (!selectedProgram) return;
    setSaving(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/programs/${selectedProgram.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_json: policyFromDraft(selectedProgram, draft), policy_status: "active" }),
      });
      if (!response.ok) {
        throw new Error(`Save failed (${response.status})`);
      }
      const updated = (await response.json()) as Program;
      setItems((prev) => prev.map((program) => (program.id === updated.id ? updated : program)));
      setDrafts((prev) => ({ ...prev, [updated.id]: draftFromProgram(updated) }));
      setStatus("Saved and published to the live policy engine.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const current = selectedProgram;
  const preview = previewPolicy;

  if (!current) {
    return (
      <div className="page-content">
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Agent Builder</span>
          </div>
          <div style={{ padding: 16 }}>No client programs are available yet for {orgName}.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "1.45rem", color: "var(--ink)" }}>Agent Builder</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.88rem", lineHeight: 1.5, maxWidth: 900 }}>
          Configure how the AI handles calls for {orgName}. Program owners can decide what the agent can answer, which KB documents it can use, when to verify callers, and when to hand off to a human.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-header">
          <div style={{ display: "grid", gap: 2 }}>
            <span className="panel-title">New tenant setup</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Use this path when a client is onboarding for the first time.</span>
          </div>
          <div className="row-meta" style={{ gap: 10 }}>
            <span>{onboardingCompleteCount}/{onboardingMilestones.length} steps ready</span>
            <span>{nextMilestone ? `Next: ${nextMilestone.title}` : "Ready to publish"}</span>
          </div>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {onboardingMilestones.map((item) => (
              <div
                key={item.title}
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(28,42,43,0.12)",
                  background: item.complete ? "rgba(15,123,119,0.08)" : "white",
                  minHeight: 124,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div className="row-title-line" style={{ alignItems: "center" }}>
                  <strong style={{ fontSize: 13 }}>{item.title}</strong>
                  <span className={`badge badge-${item.complete ? "high" : "default"}`}>{item.complete ? "Ready" : "Need setup"}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{item.detail}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <div style={{ padding: 14, borderRadius: 14, background: "rgba(28,42,43,0.04)" }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>What the tenant provides</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                Use case, policy pack, KB files, queue ownership, and human routing rules.
              </div>
            </div>
            <div style={{ padding: 14, borderRadius: 14, background: "rgba(28,42,43,0.04)" }}>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>What the platform does</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                Converts those choices into a live `SessionEngine` policy for phone and browser calls.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-header">
          <span className="panel-title">Builder flow</span>
        </div>
        <div style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {STEP_DEFS.map((step) => (
            <button
              key={step.id}
              type="button"
              onClick={() => setSelectedStep(step.id)}
              style={{
                border: "1px solid rgba(28,42,43,0.12)",
                background: selectedStep === step.id ? "rgba(15,123,119,0.12)" : "white",
                color: "var(--ink)",
                borderRadius: 999,
                padding: "10px 14px",
                minWidth: 128,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{step.label}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{step.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-header">
          <span className="panel-title">Program scope</span>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(220px, 360px) repeat(auto-fit, minmax(140px, max-content))" }}>
            <select
              value={current.id}
              onChange={(e) => selectProgram(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)", background: "white" }}
            >
              {items.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
            </select>
            {pill("Version", String(current.policy_version ?? 1))}
            {pill("Status", String(current.policy_status ?? "active"))}
            {pill("Languages", current.languages.join(" / "))}
            {pill("Template", templateId)}
          </div>
          <div className="row-meta" style={{ gap: 10 }}>
            <span>Updated by: {current.policy_updated_by ?? "system"}</span>
            <span>Last publish: {current.policy_updated_at ? new Date(current.policy_updated_at).toLocaleString() : "Never"}</span>
          </div>
        </div>
      </div>

      <div className="double-grid" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          {selectedStep === "template" && (
            <div className="panel">
              <div className="panel-header">
                <div style={{ display: "grid", gap: 2 }}>
                  <span className="panel-title">Start with a template</span>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>Pick a safe preset first, then customize it for the program.</span>
                </div>
              </div>
              <div style={{ padding: 16, display: "grid", gap: 12 }}>
                <div className="row-meta" style={{ gap: 10 }}>
                  <span>Choose a preset, then adjust it to fit the client.</span>
                </div>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  {(Object.entries(TEMPLATE_PRESETS) as [TemplateId, TemplatePreset][]).map(([id, preset]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyTemplate(id)}
                      style={{
                        textAlign: "left",
                        padding: 14,
                        borderRadius: 14,
                        border: "1px solid rgba(28,42,43,0.12)",
                        background: id === templateId ? "rgba(15,123,119,0.10)" : "white",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{preset.label}</div>
                      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.4 }}>{preset.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {selectedStep === "basics" && (
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Agent mode</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Choose how the agent should behave on every call.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Operating mode</span>
                <select value={draft.mode} onChange={(e) => updateDraft({ mode: e.target.value })} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }}>
                  <option value="ai_first_then_human">AI first, then human on approved triggers</option>
                  <option value="ai_only">AI only</option>
                  <option value="callback_only">Callback only fallback</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Supported channels</span>
                <input value={draft.supportedChannels} onChange={(e) => updateDraft({ supportedChannels: e.target.value })} placeholder="phone, browser" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
            </div>
          </div>
          )}

          {selectedStep === "caller" && (
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Caller verification</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Define when the caller must prove identity and how strict to be.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Required for intents</span>
                <input value={draft.requiredFor} onChange={(e) => updateDraft({ requiredFor: e.target.value })} placeholder="case_status" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Allowed identifiers</span>
                <input value={draft.allowedIdentifiers} onChange={(e) => updateDraft({ allowedIdentifiers: e.target.value })} placeholder="customer_code, last4_phone" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Low confidence threshold</span>
                <input type="number" min="0" max="1" step="0.05" value={draft.lowConfidenceThreshold} onChange={(e) => updateDraft({ lowConfidenceThreshold: Number(e.target.value) })} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
            </div>
          </div>
          )}

          {selectedStep === "escalation" && (
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Escalation rules</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Choose when the AI should move to a human or callback.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Live handoff triggers</span>
                <input value={draft.liveTriggers} onChange={(e) => updateDraft({ liveTriggers: e.target.value })} placeholder="human_request, angry, verification_failures" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Callback triggers</span>
                <input value={draft.callbackTriggers} onChange={(e) => updateDraft({ callbackTriggers: e.target.value })} placeholder="no_agent_available, callback_request" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
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
          )}
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {selectedStep === "kb" && (
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Knowledge base scope</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Control what documents and intents the AI is allowed to use.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Allowed document types</span>
                <input value={draft.allowedDocumentTypes} onChange={(e) => updateDraft({ allowedDocumentTypes: e.target.value })} placeholder="faq, policy, procedure" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Allowed intents for KB answers</span>
                <input value={draft.allowedIntents} onChange={(e) => updateDraft({ allowedIntents: e.target.value })} placeholder="faq_answer, case_status" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
              <div className="row-meta" style={{ gap: 10 }}>
                <span>Approved only</span>
                <span>Match same program only</span>
              </div>
            </div>
          </div>
          )}

          {selectedStep === "tools" && (
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Tools and response style</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Pick the actions the agent can perform and how it should speak.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Enabled tools</span>
                <input value={draft.enabledTools} onChange={(e) => updateDraft({ enabledTools: e.target.value })} placeholder="lookup_case, create_ticket" style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Tone</span>
                <select value={draft.tone} onChange={(e) => updateDraft({ tone: e.target.value })} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }}>
                  <option value="calm">Calm</option>
                  <option value="warm">Warm</option>
                  <option value="formal">Formal</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Length</span>
                <select value={draft.length} onChange={(e) => updateDraft({ length: e.target.value })} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }}>
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>Language policy</span>
                <select value={draft.languagePolicy} onChange={(e) => updateDraft({ languagePolicy: e.target.value })} style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(28,42,43,0.14)" }}>
                  <option value="match_caller">Match caller language</option>
                  <option value="english_first">English first</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={draft.askOneQuestionAtATime} onChange={(e) => updateDraft({ askOneQuestionAtATime: e.target.checked })} />
                <span style={{ fontWeight: 600, fontSize: 12 }}>Ask one question at a time</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={draft.confirmCriticalDetails} onChange={(e) => updateDraft({ confirmCriticalDetails: e.target.checked })} />
                <span style={{ fontWeight: 600, fontSize: 12 }}>Confirm critical details</span>
              </label>
            </div>
          </div>
          )}

          {selectedStep === "review" && (
          <div className="panel">
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Policy preview</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>Review the exact policy that will be published.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>What changes</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {changeSummary.length ? (
                    changeSummary.map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "120px 1fr",
                          gap: 12,
                          padding: "10px 12px",
                          borderRadius: 12,
                          background: "rgba(28,42,43,0.04)",
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>{item.label}</strong>
                        <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{item.value}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(16,185,129,0.08)", color: "var(--ink)", fontSize: 12, lineHeight: 1.5 }}>
                      No policy changes detected. The draft already matches the live policy.
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>Caller impact</div>
                <div style={{ display: "grid", gap: 8, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
                  <div>AI will answer first in {draft.languagePolicy === "english_first" ? "English-first" : "caller-matching"} mode.</div>
                  <div>Verification is required for {splitList(draft.requiredFor).join(", ") || "no intents"}.</div>
                  <div>Live handoff triggers: {splitList(draft.liveTriggers).join(", ") || "none"}.</div>
                  <div>Callback fallback: {draft.callbackOnUnavailable ? "enabled" : "disabled"}.</div>
                </div>
              </div>
              <pre style={{ margin: 0, padding: 12, overflowX: "auto", borderRadius: 12, background: "rgba(28,42,43,0.04)", fontSize: 12, lineHeight: 1.5 }}>
                {JSON.stringify(preview, null, 2)}
              </pre>
            </div>
          </div>
          )}

          <div className="panel">
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <span className="panel-title">Live validation</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {runtimeStatus ?? (runtime ? "Live policy loaded from backend" : "Loading live policy...")}
              </span>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 10 }}>
              <div className="row-meta" style={{ gap: 10 }}>
                <span>UI draft warnings: {previewFindings.filter((finding) => finding.kind === "warning").length}</span>
                <span>Backend warnings: {runtimeFindings.filter((finding) => finding.kind === "warning").length}</span>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {runtimeFindings.map((finding) => (
                  <div
                    key={`${finding.title}-${finding.detail}`}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid rgba(28,42,43,0.10)",
                      background:
                        finding.kind === "warning"
                          ? "rgba(239,68,68,0.06)"
                          : finding.kind === "success"
                            ? "rgba(16,185,129,0.06)"
                            : "rgba(59,130,246,0.06)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                      <strong style={{ fontSize: 13 }}>{finding.title}</strong>
                      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: finding.kind === "warning" ? "var(--danger)" : finding.kind === "success" ? "var(--success)" : "var(--muted)" }}>
                        {finding.kind}
                      </span>
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.45, color: "var(--muted)" }}>{finding.detail}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                Backend runtime is the source of truth for live calls. Draft preview shows what will be published next.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 10 }}>
        <div className="row-meta" style={{ gap: 10 }}>
          <span>
            Step {selectedStepIndex + 1} of {STEP_DEFS.length}
          </span>
          <span>{STEP_DEFS[selectedStepIndex]?.label ?? "Template"}</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={goToPreviousStep}
            disabled={!canGoBack}
            style={{
              border: "1px solid rgba(28,42,43,0.14)",
              borderRadius: 10,
              padding: "10px 16px",
              background: "white",
              color: "var(--ink)",
              fontWeight: 700,
              cursor: canGoBack ? "pointer" : "not-allowed",
            }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={goToNextStep}
            disabled={!canGoNext}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "10px 16px",
              background: canGoNext ? "var(--accent)" : "rgba(15,123,119,0.45)",
              color: "white",
              fontWeight: 700,
              cursor: canGoNext ? "pointer" : "not-allowed",
            }}
          >
            Next
          </button>
        </div>
      </div>

      {showPublishConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(7, 17, 20, 0.55)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 50,
          }}
        >
          <div style={{ width: "min(680px, 100%)", borderRadius: 18, background: "white", boxShadow: "0 30px 70px rgba(0,0,0,0.22)" }}>
            <div className="panel-header">
              <div style={{ display: "grid", gap: 2 }}>
                <span className="panel-title">Publish policy now?</span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>This will update new calls immediately.</span>
              </div>
            </div>
            <div style={{ padding: 16, display: "grid", gap: 12 }}>
              <div className="row-meta" style={{ gap: 10 }}>
                <span>Program: {current.name}</span>
                <span>Next version: {String((current.policy_version ?? 1) + 1)}</span>
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {changeSummary.length ? (
                  changeSummary.map((item) => (
                    <div
                      key={`confirm-${item.label}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 12,
                        background: "rgba(28,42,43,0.04)",
                      }}
                    >
                      <strong style={{ fontSize: 12 }}>{item.label}</strong>
                      <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{item.value}</span>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(16,185,129,0.08)", color: "var(--ink)", fontSize: 12, lineHeight: 1.5 }}>
                    No policy changes detected. You can still publish to refresh the active version.
                  </div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setShowPublishConfirm(false)}
                  style={{
                    border: "1px solid rgba(28,42,43,0.14)",
                    borderRadius: 10,
                    padding: "10px 16px",
                    background: "white",
                    color: "var(--ink)",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={savePolicy}
                  disabled={saving}
                  style={{
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 16px",
                    background: saving ? "rgba(15,123,119,0.45)" : "var(--accent)",
                    color: "white",
                    fontWeight: 700,
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
                >
                  {saving ? "Publishing..." : "Publish now"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 14 }}>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)" }}>
          Changes publish to new calls immediately and are mirrored into the legacy verification and handoff fields for compatibility.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {status && <span style={{ color: status.startsWith("Saved") ? "var(--success)" : "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status}</span>}
          <button
            onClick={() => setShowPublishConfirm(true)}
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
            {saving ? "Saving..." : "Publish policy"}
          </button>
        </div>
      </div>
    </div>
  );
}
