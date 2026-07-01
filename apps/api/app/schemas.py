from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    organization_id: str
    client_program_id: str | None = None


class LoginRequest(BaseModel):
    username: str
    password: str


class OrganizationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    default_languages: list[str]


class ProgramRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    name: str
    slug: str
    description: str
    languages: list[str]
    verification_policy: dict[str, Any]
    handoff_policy: dict[str, Any]
    policy_version: int
    policy_status: str
    policy_json: dict[str, Any]
    policy_updated_at: datetime | None
    policy_updated_by: str | None
    disclosure_template_en: str
    disclosure_template_hi: str


class ProgramPolicyUpdateRequest(BaseModel):
    policy_json: dict[str, Any]
    policy_status: str | None = None


class ProgramPolicyRuntimeRead(BaseModel):
    mode: str
    intent_policy: dict[str, Any]
    verification_policy: dict[str, Any]
    confidence_policy: dict[str, Any]
    fallback_policy: dict[str, Any]
    escalation_policy: dict[str, Any]
    kb_policy: dict[str, Any]
    tool_policy: dict[str, Any]
    response_style: dict[str, Any]
    queue_policy: dict[str, Any]
    warnings: list[str]


class QueueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    name: str
    supported_languages: list[str]
    business_hours_start: str
    business_hours_end: str
    timezone: str
    live_handoff_enabled: bool
    callback_enabled: bool


class CustomerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    full_name: str
    phone_number: str
    email: str
    customer_code: str
    language_preference: str
    vip: bool


class KnowledgeDocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    title: str
    source_type: str
    status: str
    languages: list[str]
    tags: list[str]
    created_at: datetime


class CallTurnRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    speaker: str
    message: str
    language: str
    confidence: float
    event_type: str
    created_at: datetime


class CallRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    queue_id: str
    customer_id: str | None
    customer_phone: str
    status: str
    session_state: str
    disposition: str
    resolution_status: str
    language: str
    sentiment: str
    intent: str
    confidence: float
    verification_state: str
    failed_verification_attempts: int
    summary: str
    escalation_reason: str
    recording_consent: bool
    ai_disclosure_acknowledged: bool
    handoff_mode: str | None
    started_at: datetime
    ended_at: datetime | None


class TicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    customer_id: str | None
    call_id: str | None
    title: str
    description: str
    priority: str
    status: str
    created_by: str
    assigned_to_membership_id: str | None
    created_at: datetime


class CallbackTaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    customer_id: str | None
    call_id: str | None
    priority: str
    reason: str
    scheduled_for_label: str
    status: str
    created_at: datetime


class QAReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    call_id: str
    reviewer_membership_id: str | None
    score: float | None
    status: str
    flags: list[str]
    notes: str
    created_at: datetime


class SessionStartRequest(BaseModel):
    organization_id: str
    client_program_id: str
    queue_id: str
    customer_phone: str
    customer_name: str | None = None
    preferred_language: str | None = None


class SessionTurnRequest(BaseModel):
    message: str


class SessionTurnResponse(BaseModel):
    call: CallRead
    latest_turn: CallTurnRead
    events: list[dict[str, Any]]
    tool_results: list[dict[str, Any]]
    transcript: list[CallTurnRead]


class CreateTicketRequest(BaseModel):
    organization_id: str
    client_program_id: str
    customer_id: str | None = None
    call_id: str | None = None
    title: str
    description: str
    priority: str = "medium"


class EscalateCallRequest(BaseModel):
    reason: str = "Supervisor escalation"
    live: bool = True


class ScoreReviewRequest(BaseModel):
    score: float
    notes: str = ""
    status: str = "reviewed"


class ResolveCallbackRequest(BaseModel):
    status: str = "resolved"
    resolution_note: str = ""


class UpdateTicketRequest(BaseModel):
    status: str | None = None
    priority: str | None = None
    assigned_to_membership_id: str | None = None
    note: str | None = None


class CreateCustomerRequest(BaseModel):
    organization_id: str
    client_program_id: str
    full_name: str
    phone_number: str
    email: str = ""
    customer_code: str
    language_preference: str = "English"
    vip: bool = False


class UpdateCustomerRequest(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    email: str | None = None
    language_preference: str | None = None
    vip: bool | None = None


class CreateKnowledgeDocRequest(BaseModel):
    organization_id: str
    client_program_id: str
    title: str
    source_type: str = "faq"
    languages: list[str] = Field(default_factory=lambda: ["English"])
    tags: list[str] = Field(default_factory=list)
    content: str = ""
    keywords: list[str] = Field(default_factory=list)


class KnowledgeChunkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    language: str
    content: str
    keywords: list[str]
    created_at: str


class AnalyticsSnapshot(BaseModel):
    live_calls: int
    queue_depth: int
    resolved_today: int
    resolved_yesterday: int = 0
    callbacks_pending: int
    escalations_today: int
    escalations_yesterday: int = 0
    tickets_open: int
    qa_pending: int
    avg_handle_time: str = "0:00"
    csat_score: float = 0.0
    top_intents: list[dict[str, Any]] = Field(default_factory=list)
    dispositions: list[dict[str, Any]] = Field(default_factory=list)
    sentiment_mix: list[dict[str, Any]] = Field(default_factory=list)


class CreateCampaignRequest(BaseModel):
    organization_id: str
    client_program_id: str
    queue_id: str
    name: str
    goal: str = ""
    customer_ids: list[str] = Field(default_factory=list)


class CampaignCallRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    campaign_id: str
    customer_id: str
    call_id: str | None
    status: str
    outcome: str
    notes: str
    dialed_at: datetime | None
    created_at: datetime


class CampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    client_program_id: str
    queue_id: str
    name: str
    goal: str
    status: str
    customer_ids: list[str]
    total: int
    dialed: int
    resolved: int
    failed: int
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime


# ── Squad ────────────────────────────────────────────────────────────────────

class CustomerSessionCreate(BaseModel):
    client_program_id: str
    queue_id: str
    customer_phone: str = "unknown"
    preferred_language: str = "English"
    expires_hours: int = 24
    frontend_base_url: str = "http://localhost:4000"


class CustomerSessionInfo(BaseModel):
    token: str
    call_url: str
    expires_in_hours: int
    program: str
    queue: str
    language: str


class SquadAgentRead(BaseModel):
    id: str
    name: str
    language: str
    style: str
    status: str           # idle | busy | escalated
    current_call_id: str | None
    calls_handled_today: int
    escalations_today: int


class SquadSessionRequest(BaseModel):
    organization_id: str
    client_program_id: str
    queue_id: str
    customer_phone: str
    preferred_language: str = "English"


class SquadTurnRequest(BaseModel):
    message: str


class SquadTurnResponse(BaseModel):
    call_id: str
    agent_id: str
    agent_name: str
    ai_message: str
    escalated: bool
    tool_used: str | None
    transcript: list[CallTurnRead]

