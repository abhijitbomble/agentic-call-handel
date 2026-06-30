from __future__ import annotations

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, generate_id, utcnow


class TimestampMixin:
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Organization(TimestampMixin, Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    default_languages: Mapped[list[str]] = mapped_column(JSON, default=list)

    programs: Mapped[list["ClientProgram"]] = relationship(back_populates="organization")


class ClientProgram(TimestampMixin, Base):
    __tablename__ = "client_programs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    verification_policy: Mapped[dict] = mapped_column(JSON, default=dict)
    handoff_policy: Mapped[dict] = mapped_column(JSON, default=dict)
    disclosure_template_en: Mapped[str] = mapped_column(Text, default="")
    disclosure_template_hi: Mapped[str] = mapped_column(Text, default="")

    organization: Mapped["Organization"] = relationship(back_populates="programs")
    queues: Mapped[list["Queue"]] = relationship(back_populates="program")


class Queue(TimestampMixin, Base):
    __tablename__ = "queues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    name: Mapped[str] = mapped_column(String(120))
    supported_languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    business_hours_start: Mapped[str] = mapped_column(String(16), default="09:00")
    business_hours_end: Mapped[str] = mapped_column(String(16), default="18:00")
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    live_handoff_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    callback_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    program: Mapped["ClientProgram"] = relationship(back_populates="queues")


class StaffUser(TimestampMixin, Base):
    __tablename__ = "staff_users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    memberships: Mapped[list["StaffMembership"]] = relationship(back_populates="user")


class StaffMembership(TimestampMixin, Base):
    __tablename__ = "staff_memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("staff_users.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str | None] = mapped_column(ForeignKey("client_programs.id"), nullable=True)
    role: Mapped[str] = mapped_column(String(40))
    display_name: Mapped[str] = mapped_column(String(120))
    languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped["StaffUser"] = relationship(back_populates="memberships")


class Customer(TimestampMixin, Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    full_name: Mapped[str] = mapped_column(String(120))
    phone_number: Mapped[str] = mapped_column(String(32))
    email: Mapped[str] = mapped_column(String(160), default="")
    customer_code: Mapped[str] = mapped_column(String(40))
    language_preference: Mapped[str] = mapped_column(String(16), default="English")
    vip: Mapped[bool] = mapped_column(Boolean, default=False)


class CaseRecord(TimestampMixin, Base):
    __tablename__ = "case_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    case_number: Mapped[str] = mapped_column(String(40), unique=True)
    case_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(40))
    summary: Mapped[str] = mapped_column(Text)
    last_updated_note: Mapped[str] = mapped_column(Text, default="")


class Call(TimestampMixin, Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    queue_id: Mapped[str] = mapped_column(ForeignKey("queues.id"))
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    customer_phone: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), default="active")
    session_state: Mapped[str] = mapped_column(String(64), default="new")
    disposition: Mapped[str] = mapped_column(String(32), default="open")
    resolution_status: Mapped[str] = mapped_column(String(32), default="in_progress")
    language: Mapped[str] = mapped_column(String(16), default="English")
    sentiment: Mapped[str] = mapped_column(String(16), default="neutral")
    intent: Mapped[str] = mapped_column(String(64), default="unknown_needs_clarification")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    verification_state: Mapped[str] = mapped_column(String(32), default="pending")
    failed_verification_attempts: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str] = mapped_column(Text, default="")
    escalation_reason: Mapped[str] = mapped_column(Text, default="")
    recording_consent: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_disclosure_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    handoff_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    started_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CallTurn(Base):
    __tablename__ = "call_turns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    speaker: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(16), default="English")
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    event_type: Mapped[str] = mapped_column(String(40), default="message")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)


class Ticket(TimestampMixin, Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    call_id: Mapped[str | None] = mapped_column(ForeignKey("calls.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    status: Mapped[str] = mapped_column(String(20), default="open")
    created_by: Mapped[str] = mapped_column(String(20), default="ai")
    assigned_to_membership_id: Mapped[str | None] = mapped_column(ForeignKey("staff_memberships.id"), nullable=True)


class CallbackTask(TimestampMixin, Base):
    __tablename__ = "callback_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    customer_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), nullable=True)
    call_id: Mapped[str | None] = mapped_column(ForeignKey("calls.id"), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    reason: Mapped[str] = mapped_column(Text)
    scheduled_for_label: Mapped[str] = mapped_column(String(80), default="Next available slot")
    status: Mapped[str] = mapped_column(String(20), default="pending")


class KnowledgeDocument(TimestampMixin, Base):
    __tablename__ = "knowledge_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    title: Mapped[str] = mapped_column(String(160))
    source_type: Mapped[str] = mapped_column(String(40), default="faq")
    status: Mapped[str] = mapped_column(String(20), default="active")
    languages: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("knowledge_documents.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    language: Mapped[str] = mapped_column(String(16), default="English")
    content: Mapped[str] = mapped_column(Text)
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)


class ToolInvocation(Base):
    __tablename__ = "tool_invocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    tool_name: Mapped[str] = mapped_column(String(60))
    input_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="success")
    error_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)


class HandoffEvent(Base):
    __tablename__ = "handoff_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    queue_id: Mapped[str] = mapped_column(ForeignKey("queues.id"))
    mode: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="requested")
    assigned_to_membership_id: Mapped[str | None] = mapped_column(ForeignKey("staff_memberships.id"), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)


class QAReview(TimestampMixin, Base):
    __tablename__ = "qa_reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"))
    reviewer_membership_id: Mapped[str | None] = mapped_column(ForeignKey("staff_memberships.id"), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="new")
    flags: Mapped[list[str]] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")


class ConsentEvent(Base):
    __tablename__ = "consent_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    call_id: Mapped[str] = mapped_column(ForeignKey("calls.id"))
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    recording_opt_in: Mapped[bool] = mapped_column(Boolean, default=True)
    ai_disclosure_ack: Mapped[bool] = mapped_column(Boolean, default=True)
    language: Mapped[str] = mapped_column(String(16), default="English")
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str | None] = mapped_column(ForeignKey("client_programs.id"), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[str] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(36))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), default=utcnow)


class Campaign(TimestampMixin, Base):
    __tablename__ = "campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    client_program_id: Mapped[str] = mapped_column(ForeignKey("client_programs.id"))
    queue_id: Mapped[str] = mapped_column(ForeignKey("queues.id"))
    name: Mapped[str] = mapped_column(String(160))
    goal: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | running | completed | paused
    customer_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    total: Mapped[int] = mapped_column(Integer, default=0)
    dialed: Mapped[int] = mapped_column(Integer, default=0)
    resolved: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)

    campaign_calls: Mapped[list["CampaignCall"]] = relationship(back_populates="campaign")


class CampaignCall(TimestampMixin, Base):
    __tablename__ = "campaign_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_id)
    campaign_id: Mapped[str] = mapped_column(ForeignKey("campaigns.id"))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"))
    call_id: Mapped[str | None] = mapped_column(ForeignKey("calls.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | dialing | active | resolved | failed
    outcome: Mapped[str] = mapped_column(String(40), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    dialed_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)

    campaign: Mapped["Campaign"] = relationship(back_populates="campaign_calls")

