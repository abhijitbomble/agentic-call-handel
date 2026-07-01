export type ProgramVerificationPolicy = {
  required_for: string[];
  allowed_identifiers: string[];
  [key: string]: unknown;
};

export type ProgramHandoffPolicy = {
  live_on: string[];
  callback_on_unavailable: boolean;
  low_confidence_threshold?: number;
  [key: string]: unknown;
};

export type ProgramPolicy = {
  version?: number;
  mode?: "ai_first_then_human" | "ai_only" | "callback_only" | string;
  intent_policy?: {
    allowed_intents: string[];
    default_intent: string;
    blocked_intents: string[];
  };
  confidence_policy?: {
    answer_threshold: number;
    clarify_threshold: number;
    escalate_threshold: number;
    max_clarify_turns: number;
  };
  fallback_policy?: {
    on_low_confidence: string;
    on_no_kb_match: string;
    on_missing_required_data: string;
    on_silent_user: string;
  };
  verification_policy?: ProgramVerificationPolicy;
  handoff_policy?: ProgramHandoffPolicy;
  escalation_policy?: {
    live_triggers: string[];
    callback_when_unavailable: boolean;
    callback_triggers: string[];
    require_summary_before_handoff: boolean;
  };
  kb_policy?: {
    allowed_document_types: string[];
    allowed_intents: string[];
    must_be_approved: boolean;
    match_same_program_only: boolean;
  };
  tool_policy?: {
    enabled_tools: string[];
  };
  response_style?: {
    tone: string;
    length: string;
    language_policy: string;
    ask_one_question_at_a_time: boolean;
    confirm_critical_details: boolean;
  };
  queue_policy?: {
    live_handoff_enabled: boolean;
    callback_enabled: boolean;
    supported_channels: string[];
  };
  [key: string]: unknown;
};

export type ProgramPolicyRuntime = {
  mode: string;
  intent_policy: {
    allowed_intents: string[];
    blocked_intents: string[];
    default_intent: string;
  };
  verification_policy: {
    required_for: string[];
    allowed_identifiers: string[];
  };
  confidence_policy: {
    answer_threshold: number;
    clarify_threshold: number;
    escalate_threshold: number;
    max_clarify_turns: number;
  };
  fallback_policy: {
    on_low_confidence: string;
    on_no_kb_match: string;
    on_missing_required_data: string;
    on_silent_user: string;
  };
  escalation_policy: {
    live_triggers: string[];
    callback_when_unavailable: boolean;
    callback_triggers: string[];
    require_summary_before_handoff: boolean;
  };
  kb_policy: {
    allowed_document_types: string[];
    allowed_intents: string[];
    must_be_approved: boolean;
    match_same_program_only: boolean;
  };
  tool_policy: {
    enabled_tools: string[];
  };
  response_style: {
    tone: string;
    length: string;
    language_policy: string;
    ask_one_question_at_a_time: boolean;
    confirm_critical_details: boolean;
  };
  queue_policy: {
    supported_channels: string[];
    live_handoff_enabled: boolean;
    callback_enabled: boolean;
  };
  warnings: string[];
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  default_languages: string[];
};

export type Program = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string;
  languages: string[];
  verification_policy: ProgramVerificationPolicy;
  handoff_policy: ProgramHandoffPolicy;
  policy_version?: number;
  policy_status?: string;
  policy_json?: ProgramPolicy;
  policy_updated_at?: string | null;
  policy_updated_by?: string | null;
  disclosure_template_en: string;
  disclosure_template_hi: string;
};

export type Queue = {
  id: string;
  organization_id: string;
  client_program_id: string;
  name: string;
  supported_languages: string[];
  business_hours_start: string;
  business_hours_end: string;
  timezone: string;
  live_handoff_enabled: boolean;
  callback_enabled: boolean;
};

export type Customer = {
  id: string;
  organization_id: string;
  client_program_id: string;
  full_name: string;
  phone_number: string;
  email: string;
  customer_code: string;
  language_preference: string;
  vip: boolean;
};

export type Call = {
  id: string;
  organization_id: string;
  client_program_id: string;
  queue_id: string;
  customer_id: string | null;
  customer_phone: string;
  status: string;
  session_state: string;
  disposition: string;
  resolution_status: string;
  language: string;
  sentiment: string;
  intent: string;
  confidence: number;
  verification_state: string;
  failed_verification_attempts: number;
  summary: string;
  escalation_reason: string;
  recording_consent: boolean;
  ai_disclosure_acknowledged: boolean;
  handoff_mode: string | null;
  started_at: string;
  ended_at: string | null;
  // Display-layer fields (populated in demo data or computed client-side)
  display_call_id?: string;
  customer_name?: string;
  program_name?: string;
  duration_label?: string;
  display_status?: string;
  agent_name?: string | null;
  agent_initials?: string | null;
};

export type CallTurn = {
  id: string;
  speaker: string;
  message: string;
  language: string;
  confidence: number;
  event_type: string;
  created_at: string;
};

export type Ticket = {
  id: string;
  organization_id: string;
  client_program_id: string;
  customer_id: string | null;
  call_id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  created_by: string;
  assigned_to_membership_id: string | null;
  created_at: string;
};

export type CallbackTask = {
  id: string;
  organization_id: string;
  client_program_id: string;
  customer_id: string | null;
  call_id: string | null;
  priority: string;
  reason: string;
  scheduled_for_label: string;
  status: string;
  created_at: string;
  display_id?: string;
  customer_name?: string;
  program_name?: string;
  scheduled_time?: string;
};

export type QAReview = {
  id: string;
  organization_id: string;
  client_program_id: string;
  call_id: string;
  reviewer_membership_id: string | null;
  score: number | null;
  status: string;
  flags: string[];
  notes: string;
  created_at: string;
  display_id?: string;
  agent_name?: string;
  program_name?: string;
  call_display_id?: string;
  date_label?: string;
};

export type KnowledgeDocument = {
  id: string;
  organization_id: string;
  client_program_id: string;
  title: string;
  source_type: string;
  status: string;
  languages: string[];
  tags: string[];
  created_at: string;
};

export type Campaign = {
  id: string;
  organization_id: string;
  client_program_id: string;
  queue_id: string;
  name: string;
  goal: string;
  status: "draft" | "running" | "completed" | "paused";
  customer_ids: string[];
  total: number;
  dialed: number;
  resolved: number;
  failed: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type CampaignCall = {
  id: string;
  campaign_id: string;
  customer_id: string;
  call_id: string | null;
  status: string;
  outcome: string;
  notes: string;
  dialed_at: string | null;
  created_at: string;
};

export type AnalyticsSnapshot = {
  live_calls: number;
  queue_depth: number;
  resolved_today: number;
  resolved_yesterday: number;
  callbacks_pending: number;
  escalations_today: number;
  escalations_yesterday: number;
  tickets_open: number;
  qa_pending: number;
  avg_handle_time: string;
  csat_score: number;
  top_intents: { intent: string; count: number; share: number }[];
  dispositions: { label: string; count: number; color?: string }[];
  sentiment_mix: { label: string; count: number }[];
};

export type UserProfile = {
  id: string;
  username: string;
  full_name: string;
  role: string;
  organization_id: string;
};

export type DashboardBundle = {
  organizations: Organization[];
  programs: Program[];
  queues: Queue[];
  customers: Customer[];
  calls: Call[];
  tickets: Ticket[];
  callbacks: CallbackTask[];
  reviews: QAReview[];
  knowledge: KnowledgeDocument[];
  analytics: AnalyticsSnapshot;
};
