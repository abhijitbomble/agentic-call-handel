from __future__ import annotations

import io
import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
import re
import zipfile
from typing import Annotated
import xml.etree.ElementTree as ET

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as XMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import AuthContext, create_access_token, get_current_context, load_user_with_memberships, require_roles, verify_password
from app.config import get_settings
from app.db import Base, SessionLocal, engine, get_db
from app.event_hub import event_hub
from app.models import Call, CallTurn, CallbackTask, Campaign, CampaignCall, ClientProgram, Customer, KnowledgeChunk, KnowledgeDocument, Organization, QAReview, Queue, Ticket, ToolInvocation
from app.schemas import (
    AnalyticsSnapshot,
    CallRead,
    CallTurnRead,
    CallbackTaskRead,
    CampaignCallRead,
    CampaignRead,
    CreateCampaignRequest,
    CreateCustomerRequest,
    CreateKnowledgeDocRequest,
    CreateTicketRequest,
    CustomerRead,
    EscalateCallRequest,
    KnowledgeChunkRead,
    KnowledgeDocumentRead,
    LoginRequest,
    OrganizationRead,
    ProgramPolicyUpdateRequest,
    ProgramPolicyRuntimeRead,
    ProgramRead,
    QAReviewRead,
    QueueRead,
    ResolveCallbackRequest,
    ScoreReviewRequest,
    SessionStartRequest,
    SessionTurnRequest,
    SessionTurnResponse,
    CustomerSessionCreate,
    CustomerSessionInfo,
    SquadAgentRead,
    SquadSessionRequest,
    SquadTurnRequest,
    SquadTurnResponse,
    TicketRead,
    TokenResponse,
    UpdateCustomerRequest,
    UpdateTicketRequest,
)
from app.orchestrator import agent_pool
from app.migrations import ensure_program_policy_schema
from app.seed import seed_database
from app.services import SessionEngine, build_analytics_snapshot, emit_events, policy_runtime_summary, policy_warnings_for, store_audit_log, update_program_policy
from app.twilio_media import run_twilio_media_bridge
from app.twilio_browser import browser_identity, create_voice_access_token
from app import twilio_handler as twiml

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional dependency safety
    PdfReader = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_program_policy_schema()
    with SessionLocal() as session:
        seed_database(session)
    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_engine = SessionEngine()


def public_ws_base_url() -> str:
    base = settings.public_base_url.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):]
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):]
    return base


def preferred_queue_language(queue: Queue, customer: Customer | None = None) -> str:
    if customer and customer.language_preference:
        return customer.language_preference
    if "English" in queue.supported_languages:
        return "English"
    if queue.supported_languages:
        return queue.supported_languages[0]
    return "English"


def twilio_browser_missing_fields() -> list[str]:
    missing: list[str] = []
    if not settings.twilio_account_sid:
        missing.append("VOICEOPS_TWILIO_ACCOUNT_SID")
    if not settings.twilio_api_key_sid:
        missing.append("VOICEOPS_TWILIO_API_KEY_SID")
    if not settings.twilio_api_key_secret:
        missing.append("VOICEOPS_TWILIO_API_KEY_SECRET")
    if not settings.twilio_twiml_app_sid:
        missing.append("VOICEOPS_TWILIO_TWIML_APP_SID")
    if not settings.public_base_url:
        missing.append("VOICEOPS_PUBLIC_BASE_URL")
    if not settings.deepgram_api_key:
        missing.append("VOICEOPS_DEEPGRAM_API_KEY")
    return missing


def csv_to_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def split_knowledge_text(text: str, max_chars: int = 1200) -> list[str]:
    normalized = re.sub(r"\r\n?", "\n", text).strip()
    if not normalized:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n\s*\n+", normalized) if part.strip()]
    if not paragraphs:
        paragraphs = [normalized]

    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            sentences = re.split(r"(?<=[.!?])\s+", paragraph)
            segment = ""
            for sentence in sentences:
                if not sentence:
                    continue
                if len(segment) + len(sentence) + 1 <= max_chars:
                    segment = f"{segment} {sentence}".strip()
                else:
                    if segment:
                        chunks.append(segment.strip())
                    segment = sentence
            if segment:
                chunks.append(segment.strip())
            continue

        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current.strip())
            current = paragraph

    if current:
        chunks.append(current.strip())
    return [chunk for chunk in chunks if chunk]


def extract_text_from_upload(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in {".txt", ".md", ".csv", ".json", ".log"}:
        return data.decode("utf-8", errors="ignore")
    if suffix == ".pdf":
        if PdfReader is None:
            raise HTTPException(status_code=400, detail="PDF uploads are not available on this server yet.")
        reader = PdfReader(io.BytesIO(data))
        return "\n\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
    if suffix == ".docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml_bytes = archive.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        lines = ["".join(node.itertext()).strip() for node in root.findall(".//w:p", namespace)]
        return "\n\n".join(line for line in lines if line).strip()
    raise HTTPException(status_code=400, detail=f"Unsupported file type '{suffix or 'unknown'}'. Please upload PDF, DOCX, TXT, MD, CSV, or JSON.")


def scope_for_membership(ctx: AuthContext, model) -> list:
    filters = [model.organization_id == ctx.membership.organization_id]
    if ctx.membership.client_program_id:
        filters.append(model.client_program_id == ctx.membership.client_program_id)
    return filters


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = load_user_with_memberships(db, payload.username)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    membership = user.memberships[0]
    token = create_access_token(
        {
            "sub": user.id,
            "membership_id": membership.id,
            "role": membership.role,
            "organization_id": membership.organization_id,
            "client_program_id": membership.client_program_id,
        }
    )
    return TokenResponse(
        access_token=token,
        role=membership.role,
        organization_id=membership.organization_id,
        client_program_id=membership.client_program_id,
    )


@app.get("/auth/me")
def me(ctx: AuthContext = Depends(get_current_context)) -> dict:
    return {
        "user": {"id": ctx.user.id, "username": ctx.user.username, "full_name": ctx.user.full_name},
        "membership": {
            "id": ctx.membership.id,
            "role": ctx.membership.role,
            "organization_id": ctx.membership.organization_id,
            "client_program_id": ctx.membership.client_program_id,
        },
    }


@app.get("/organizations", response_model=list[OrganizationRead])
def list_organizations(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(Organization).where(Organization.id == ctx.membership.organization_id)
    return db.scalars(stmt).all()


@app.get("/programs", response_model=list[ProgramRead])
def list_programs(
    organization_id: Annotated[str | None, Query()] = None,
    ctx: AuthContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    stmt = select(ClientProgram).where(ClientProgram.organization_id == (organization_id or ctx.membership.organization_id))
    if ctx.membership.client_program_id:
        stmt = stmt.where(ClientProgram.id == ctx.membership.client_program_id)
    return db.scalars(stmt).all()


@app.patch("/programs/{program_id}", response_model=ProgramRead)
def update_program(
    program_id: str,
    payload: ProgramPolicyUpdateRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    program = db.get(ClientProgram, program_id)
    if program is None or program.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Program not found")
    if ctx.membership.client_program_id and program.id != ctx.membership.client_program_id:
        raise HTTPException(status_code=403, detail="Cannot update a different program")
    update_program_policy(program, payload.policy_json, updated_by=ctx.user.id, status=payload.policy_status)
    db.commit()
    db.refresh(program)
    return program


@app.get("/programs/{program_id}/policy/runtime", response_model=ProgramPolicyRuntimeRead)
def get_program_policy_runtime(
    program_id: str,
    ctx: AuthContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    program = db.get(ClientProgram, program_id)
    if program is None or program.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Program not found")
    if ctx.membership.client_program_id and program.id != ctx.membership.client_program_id:
        raise HTTPException(status_code=403, detail="Cannot inspect a different program")
    runtime = policy_runtime_summary(program)
    runtime["warnings"] = policy_warnings_for(program)
    return runtime


@app.get("/queues", response_model=list[QueueRead])
def list_queues(
    client_program_id: Annotated[str | None, Query()] = None,
    ctx: AuthContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    stmt = select(Queue).where(Queue.organization_id == ctx.membership.organization_id)
    if ctx.membership.client_program_id:
        stmt = stmt.where(Queue.client_program_id == ctx.membership.client_program_id)
    elif client_program_id:
        stmt = stmt.where(Queue.client_program_id == client_program_id)
    return db.scalars(stmt).all()


@app.get("/knowledge-docs", response_model=list[KnowledgeDocumentRead])
def list_knowledge_docs(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(KnowledgeDocument).where(*scope_for_membership(ctx, KnowledgeDocument))
    return db.scalars(stmt).all()


@app.get("/customers", response_model=list[CustomerRead])
def list_customers(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(Customer).where(*scope_for_membership(ctx, Customer))
    return db.scalars(stmt).all()


@app.post("/voice/sessions", response_model=SessionTurnResponse)
def start_voice_session(
    payload: SessionStartRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    if payload.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot start a session for another organization")
    if ctx.membership.client_program_id and payload.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=403, detail="Cannot start a session for another program")
    program = db.get(ClientProgram, payload.client_program_id)
    queue = db.get(Queue, payload.queue_id)
    if program is None or queue is None:
        raise HTTPException(status_code=404, detail="Program or queue not found")
    customer = db.scalar(
        select(Customer).where(
            Customer.organization_id == payload.organization_id,
            Customer.client_program_id == payload.client_program_id,
            Customer.phone_number == payload.customer_phone,
        )
    )
    call = Call(
        organization_id=payload.organization_id,
        client_program_id=payload.client_program_id,
        queue_id=payload.queue_id,
        customer_id=customer.id if customer else None,
        customer_phone=payload.customer_phone,
        language=payload.preferred_language or (customer.language_preference if customer else "English"),
        status="active",
        session_state="new",
    )
    db.add(call)
    db.flush()

    outcome = session_engine.start_session(db, program, queue, call)
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="session_started",
        entity_type="call",
        entity_id=call.id,
        organization_id=call.organization_id,
        client_program_id=call.client_program_id,
        details={"queue_id": call.queue_id},
    )
    db.commit()
    transcript = db.scalars(select(CallTurn).where(CallTurn.call_id == call.id).order_by(CallTurn.created_at)).all()
    latest_turn = transcript[-1]
    asyncio.run(emit_events(call.id, outcome.events))
    return SessionTurnResponse(
        call=CallRead.model_validate(call),
        latest_turn=CallTurnRead.model_validate(latest_turn),
        events=outcome.events,
        tool_results=outcome.tools,
        transcript=[CallTurnRead.model_validate(turn) for turn in transcript],
    )


@app.post("/voice/sessions/{call_id}/turns", response_model=SessionTurnResponse)
def submit_turn(
    call_id: str,
    payload: SessionTurnRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    if ctx.membership.client_program_id and call.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=404, detail="Call not found")
    program = db.get(ClientProgram, call.client_program_id)
    queue = db.get(Queue, call.queue_id)
    outcome = session_engine.process_turn(db, call, program, queue, payload.message)
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="session_turn_processed",
        entity_type="call",
        entity_id=call.id,
        organization_id=call.organization_id,
        client_program_id=call.client_program_id,
        details={"intent": call.intent, "state": call.session_state},
    )
    db.commit()
    db.refresh(call)
    transcript = db.scalars(select(CallTurn).where(CallTurn.call_id == call.id).order_by(CallTurn.created_at)).all()
    latest_turn = transcript[-1]
    asyncio.run(emit_events(call.id, outcome.events))
    return SessionTurnResponse(
        call=CallRead.model_validate(call),
        latest_turn=CallTurnRead.model_validate(latest_turn),
        events=outcome.events,
        tool_results=outcome.tools,
        transcript=[CallTurnRead.model_validate(turn) for turn in transcript],
    )


@app.post("/voice/sessions/{call_id}/close", response_model=CallRead)
def close_session(call_id: str, ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")), db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    call.status = "completed"
    call.session_state = "closed"
    call.ended_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(call)
    return CallRead.model_validate(call)


@app.get("/calls", response_model=list[CallRead])
def list_calls(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(Call).where(*scope_for_membership(ctx, Call)).order_by(Call.started_at.desc())
    return db.scalars(stmt).all()


@app.get("/calls/{call_id}", response_model=CallRead)
def get_call(call_id: str, ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    if ctx.membership.client_program_id and call.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=404, detail="Call not found")
    return CallRead.model_validate(call)


@app.get("/calls/{call_id}/transcript", response_model=list[CallTurnRead])
def get_call_transcript(call_id: str, ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    if ctx.membership.client_program_id and call.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=404, detail="Call not found")
    turns = db.scalars(select(CallTurn).where(CallTurn.call_id == call_id).order_by(CallTurn.created_at)).all()
    return [CallTurnRead.model_validate(turn) for turn in turns]


@app.get("/calls/{call_id}/summary")
def get_call_summary(call_id: str, ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    if ctx.membership.client_program_id and call.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=404, detail="Call not found")
    return {"call_id": call.id, "summary": call.summary, "intent": call.intent, "disposition": call.disposition}


@app.post("/calls/{call_id}/escalate", response_model=CallRead)
def escalate_call(
    call_id: str,
    payload: EscalateCallRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    call.disposition = "escalated"
    call.session_state = "live_handoff" if payload.live else "callback"
    call.escalation_reason = payload.reason
    call.handoff_mode = "live" if payload.live else "callback"
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="call_escalated",
        entity_type="call",
        entity_id=call.id,
        organization_id=call.organization_id,
        client_program_id=call.client_program_id,
        details={"reason": payload.reason, "live": payload.live},
    )
    db.commit()
    db.refresh(call)
    return CallRead.model_validate(call)


@app.get("/tickets", response_model=list[TicketRead])
def list_tickets(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(Ticket).where(*scope_for_membership(ctx, Ticket)).order_by(Ticket.created_at.desc())
    return db.scalars(stmt).all()


@app.post("/tickets", response_model=TicketRead)
def create_ticket(payload: CreateTicketRequest, ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")), db: Session = Depends(get_db)):
    if payload.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot create a ticket for another organization")
    if ctx.membership.client_program_id and payload.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=403, detail="Cannot create a ticket for another program")
    ticket = Ticket(
        organization_id=payload.organization_id,
        client_program_id=payload.client_program_id,
        customer_id=payload.customer_id,
        call_id=payload.call_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        created_by="human",
    )
    db.add(ticket)
    db.flush()
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="ticket_created",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
        client_program_id=ticket.client_program_id,
    )
    db.commit()
    db.refresh(ticket)
    return TicketRead.model_validate(ticket)


@app.get("/callbacks", response_model=list[CallbackTaskRead])
def list_callbacks(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(CallbackTask).where(*scope_for_membership(ctx, CallbackTask)).order_by(CallbackTask.created_at.desc())
    return db.scalars(stmt).all()


@app.get("/reviews", response_model=list[QAReviewRead])
def list_reviews(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(QAReview).where(*scope_for_membership(ctx, QAReview)).order_by(QAReview.created_at.desc())
    return db.scalars(stmt).all()


@app.patch("/reviews/{review_id}", response_model=QAReviewRead)
def score_review(
    review_id: str,
    payload: ScoreReviewRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    review = db.get(QAReview, review_id)
    if review is None or review.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Review not found")
    review.score = payload.score
    review.notes = payload.notes
    review.status = payload.status
    review.reviewer_membership_id = ctx.membership.id
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="review_scored",
        entity_type="qa_review",
        entity_id=review.id,
        organization_id=review.organization_id,
        client_program_id=review.client_program_id,
        details={"score": payload.score, "status": payload.status},
    )
    db.commit()
    db.refresh(review)
    return QAReviewRead.model_validate(review)


@app.patch("/callbacks/{callback_id}", response_model=CallbackTaskRead)
def resolve_callback(
    callback_id: str,
    payload: ResolveCallbackRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    task = db.get(CallbackTask, callback_id)
    if task is None or task.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Callback not found")
    task.status = payload.status
    action = "callback_removed" if payload.status == "removed" else "callback_resolved"
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action=action,
        entity_type="callback_task",
        entity_id=task.id,
        organization_id=task.organization_id,
        client_program_id=task.client_program_id,
        details={"status": payload.status, "note": payload.resolution_note},
    )
    db.commit()
    db.refresh(task)
    return CallbackTaskRead.model_validate(task)


@app.patch("/tickets/{ticket_id}", response_model=TicketRead)
def update_ticket(
    ticket_id: str,
    payload: UpdateTicketRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    ticket = db.get(Ticket, ticket_id)
    if ticket is None or ticket.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if payload.status is not None:
        ticket.status = payload.status
    if payload.priority is not None:
        ticket.priority = payload.priority
    if payload.assigned_to_membership_id is not None:
        ticket.assigned_to_membership_id = payload.assigned_to_membership_id
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="ticket_updated",
        entity_type="ticket",
        entity_id=ticket.id,
        organization_id=ticket.organization_id,
        client_program_id=ticket.client_program_id,
        details={"status": payload.status, "priority": payload.priority, "note": payload.note},
    )
    db.commit()
    db.refresh(ticket)
    return TicketRead.model_validate(ticket)


@app.post("/customers", response_model=CustomerRead)
def create_customer(
    payload: CreateCustomerRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    if payload.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot create a customer for another organization")
    if ctx.membership.client_program_id and payload.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=403, detail="Cannot create a customer for another program")
    existing = db.scalar(
        select(Customer).where(
            Customer.organization_id == payload.organization_id,
            Customer.customer_code == payload.customer_code,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Customer code already in use")
    customer = Customer(
        organization_id=payload.organization_id,
        client_program_id=payload.client_program_id,
        full_name=payload.full_name,
        phone_number=payload.phone_number,
        email=payload.email,
        customer_code=payload.customer_code,
        language_preference=payload.language_preference,
        vip=payload.vip,
    )
    db.add(customer)
    db.flush()
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="customer_created",
        entity_type="customer",
        entity_id=customer.id,
        organization_id=customer.organization_id,
        client_program_id=customer.client_program_id,
    )
    db.commit()
    db.refresh(customer)
    return CustomerRead.model_validate(customer)


@app.patch("/customers/{customer_id}", response_model=CustomerRead)
def update_customer(
    customer_id: str,
    payload: UpdateCustomerRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    customer = db.get(Customer, customer_id)
    if customer is None or customer.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Customer not found")
    if payload.full_name is not None:
        customer.full_name = payload.full_name
    if payload.phone_number is not None:
        customer.phone_number = payload.phone_number
    if payload.email is not None:
        customer.email = payload.email
    if payload.language_preference is not None:
        customer.language_preference = payload.language_preference
    if payload.vip is not None:
        customer.vip = payload.vip
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="customer_updated",
        entity_type="customer",
        entity_id=customer.id,
        organization_id=customer.organization_id,
        client_program_id=customer.client_program_id,
    )
    db.commit()
    db.refresh(customer)
    return CustomerRead.model_validate(customer)


@app.post("/knowledge-docs", response_model=KnowledgeDocumentRead)
def create_knowledge_doc(
    payload: CreateKnowledgeDocRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    if payload.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot create a document for another organization")
    doc = KnowledgeDocument(
        organization_id=payload.organization_id,
        client_program_id=payload.client_program_id,
        title=payload.title,
        source_type=payload.source_type,
        status="active",
        languages=payload.languages,
        tags=payload.tags,
    )
    db.add(doc)
    db.flush()
    chunks = split_knowledge_text(payload.content)
    if not chunks and payload.content.strip():
        chunks = [payload.content.strip()]
    for chunk_text in chunks:
        chunk = KnowledgeChunk(
            document_id=doc.id,
            organization_id=doc.organization_id,
            client_program_id=doc.client_program_id,
            language=payload.languages[0] if payload.languages else "English",
            content=chunk_text,
            keywords=payload.keywords,
        )
        db.add(chunk)
    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="knowledge_doc_created",
        entity_type="knowledge_document",
        entity_id=doc.id,
        organization_id=doc.organization_id,
        client_program_id=doc.client_program_id,
        details={"title": doc.title},
    )
    db.commit()
    db.refresh(doc)
    return KnowledgeDocumentRead.model_validate(doc)


@app.post("/knowledge-docs/upload", response_model=KnowledgeDocumentRead)
async def upload_knowledge_doc(
    organization_id: Annotated[str, Form(...)],
    client_program_id: Annotated[str, Form(...)],
    title: Annotated[str, Form("")] = "",
    source_type: Annotated[str, Form("faq")] = "faq",
    language: Annotated[str, Form("English")] = "English",
    tags: Annotated[str, Form("")] = "",
    keywords: Annotated[str, Form("")] = "",
    content: Annotated[str, Form("")] = "",
    file: UploadFile | None = File(default=None),
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    if organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot create a document for another organization")
    raw_text = content.strip()
    filename = ""
    if file is not None:
        file_bytes = await file.read()
        filename = file.filename or "knowledge-upload"
        file_text = extract_text_from_upload(filename, file_bytes)
        raw_text = file_text.strip() or raw_text
    if not raw_text:
        raise HTTPException(status_code=400, detail="Upload a file or provide content for the knowledge article.")

    doc_title = title.strip() or Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "Uploaded knowledge article"
    doc = KnowledgeDocument(
        organization_id=organization_id,
        client_program_id=client_program_id,
        title=doc_title,
        source_type=source_type or "faq",
        status="active",
        languages=[language or "English"],
        tags=csv_to_list(tags),
    )
    db.add(doc)
    db.flush()

    chunk_texts = split_knowledge_text(raw_text)
    if not chunk_texts:
        chunk_texts = [raw_text]
    keyword_list = csv_to_list(keywords)
    if filename:
        keyword_list = list(dict.fromkeys(keyword_list + csv_to_list(doc_title)))

    for chunk_text in chunk_texts:
        db.add(
            KnowledgeChunk(
                document_id=doc.id,
                organization_id=doc.organization_id,
                client_program_id=doc.client_program_id,
                language=language or "English",
                content=chunk_text,
                keywords=keyword_list,
            )
        )

    store_audit_log(
        db,
        actor_type="staff",
        actor_id=ctx.user.id,
        action="knowledge_doc_uploaded",
        entity_type="knowledge_document",
        entity_id=doc.id,
        organization_id=doc.organization_id,
        client_program_id=doc.client_program_id,
        details={"title": doc.title, "filename": filename or None},
    )
    db.commit()
    db.refresh(doc)
    return KnowledgeDocumentRead.model_validate(doc)


@app.get("/knowledge-docs/{doc_id}/chunks", response_model=list[KnowledgeChunkRead])
def list_knowledge_chunks(
    doc_id: str,
    ctx: AuthContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    doc = db.get(KnowledgeDocument, doc_id)
    if doc is None or doc.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Document not found")
    chunks = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.document_id == doc_id)).all()
    return [KnowledgeChunkRead.model_validate(c) for c in chunks]


@app.get("/analytics/overview", response_model=AnalyticsSnapshot)
def analytics_overview(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    snapshot = build_analytics_snapshot(db, ctx.membership.organization_id, ctx.membership.client_program_id)
    return AnalyticsSnapshot(**snapshot)


# ── Outbound Campaigns ──────────────────────────────────────────────────────


@app.get("/campaigns", response_model=list[CampaignRead])
def list_campaigns(ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    stmt = select(Campaign).where(*scope_for_membership(ctx, Campaign)).order_by(Campaign.created_at.desc())
    return [CampaignRead.model_validate(c) for c in db.scalars(stmt).all()]


@app.post("/campaigns", response_model=CampaignRead)
def create_campaign(
    payload: CreateCampaignRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    if payload.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot create campaign for another organization")
    if ctx.membership.client_program_id and payload.client_program_id != ctx.membership.client_program_id:
        raise HTTPException(status_code=403, detail="Cannot create campaign for another program")

    program = db.get(ClientProgram, payload.client_program_id)
    queue = db.get(Queue, payload.queue_id)
    if (
        program is None
        or queue is None
        or program.organization_id != ctx.membership.organization_id
        or queue.organization_id != ctx.membership.organization_id
    ):
        raise HTTPException(status_code=404, detail="Program or queue not found")
    if queue.client_program_id != program.id:
        raise HTTPException(status_code=400, detail="Queue does not belong to program")

    customer_ids = list(dict.fromkeys(payload.customer_ids))
    if customer_ids:
        scoped_customer_ids = set(
            db.scalars(
                select(Customer.id).where(
                    Customer.organization_id == payload.organization_id,
                    Customer.client_program_id == payload.client_program_id,
                    Customer.id.in_(customer_ids),
                )
            ).all()
        )
        if len(scoped_customer_ids) != len(customer_ids):
            raise HTTPException(status_code=400, detail="One or more customers do not belong to the selected program")

    campaign = Campaign(
        organization_id=payload.organization_id,
        client_program_id=payload.client_program_id,
        queue_id=payload.queue_id,
        name=payload.name,
        goal=payload.goal,
        customer_ids=customer_ids,
        total=len(customer_ids),
        status="draft",
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return CampaignRead.model_validate(campaign)


@app.get("/campaigns/{campaign_id}", response_model=CampaignRead)
def get_campaign(campaign_id: str, ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if (
        campaign is None
        or campaign.organization_id != ctx.membership.organization_id
        or (ctx.membership.client_program_id and campaign.client_program_id != ctx.membership.client_program_id)
    ):
        raise HTTPException(status_code=404, detail="Campaign not found")
    return CampaignRead.model_validate(campaign)


@app.get("/campaigns/{campaign_id}/calls", response_model=list[CampaignCallRead])
def list_campaign_calls(campaign_id: str, ctx: AuthContext = Depends(get_current_context), db: Session = Depends(get_db)):
    campaign = db.get(Campaign, campaign_id)
    if (
        campaign is None
        or campaign.organization_id != ctx.membership.organization_id
        or (ctx.membership.client_program_id and campaign.client_program_id != ctx.membership.client_program_id)
    ):
        raise HTTPException(status_code=404, detail="Campaign not found")
    rows = db.scalars(select(CampaignCall).where(CampaignCall.campaign_id == campaign_id)).all()
    return [CampaignCallRead.model_validate(r) for r in rows]


@app.post("/campaigns/{campaign_id}/start", response_model=CampaignRead)
def start_campaign(
    campaign_id: str,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor")),
    db: Session = Depends(get_db),
):
    campaign = db.get(Campaign, campaign_id)
    if (
        campaign is None
        or campaign.organization_id != ctx.membership.organization_id
        or (ctx.membership.client_program_id and campaign.client_program_id != ctx.membership.client_program_id)
    ):
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status not in ("draft", "paused"):
        raise HTTPException(status_code=400, detail=f"Campaign is already {campaign.status}")

    program = db.get(ClientProgram, campaign.client_program_id)
    queue = db.get(Queue, campaign.queue_id)
    if program is None or queue is None:
        raise HTTPException(status_code=404, detail="Program or queue not found")

    campaign.status = "running"
    campaign.started_at = datetime.now(timezone.utc)

    for customer_id in campaign.customer_ids:
        customer = db.get(Customer, customer_id)
        if customer is None or customer.client_program_id != campaign.client_program_id:
            campaign.failed += 1
            continue
        call = Call(
            organization_id=campaign.organization_id,
            client_program_id=campaign.client_program_id,
            queue_id=campaign.queue_id,
            customer_id=customer.id,
            customer_phone=customer.phone_number,
            language=customer.language_preference,
            status="active",
            session_state="new",
        )
        db.add(call)
        db.flush()

        outcome = session_engine.start_session(db, program, queue, call)
        asyncio.run(emit_events(call.id, outcome.events))

        campaign_call = CampaignCall(
            campaign_id=campaign.id,
            customer_id=customer.id,
            call_id=call.id,
            status="dialing",
            dialed_at=datetime.now(timezone.utc),
        )
        db.add(campaign_call)
        campaign.dialed += 1

    if campaign.dialed + campaign.failed == campaign.total:
        campaign.status = "completed"
        campaign.completed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(campaign)
    return CampaignRead.model_validate(campaign)


@app.websocket("/ws/voice-sessions/{call_id}")
async def session_events(websocket: WebSocket, call_id: str):
    await websocket.accept()
    queue = event_hub.subscribe(call_id)
    try:
        while True:
            event = await queue.get()
            await websocket.send_json(event)
    except WebSocketDisconnect:
        event_hub.unsubscribe(call_id, queue)


# ── Twilio real-call endpoints ────────────────────────────────────────────────


@app.get("/twilio/config")
def twilio_config_info():
    """Returns the webhook URLs to paste into the Twilio dashboard."""
    base = settings.public_base_url.rstrip("/")
    ws_base = public_ws_base_url()
    browser_missing = twilio_browser_missing_fields()
    queues_info: list[dict] = []
    with SessionLocal() as db:
        all_queues = db.scalars(select(Queue)).all()
        for q in all_queues:
            prog = db.get(ClientProgram, q.client_program_id)
            queues_info.append({
                "queue_id": q.id,
                "queue_name": q.name,
                "program": prog.name if prog else "-",
                "voice_webhook": f"{base}/twilio/voice?queue_id={q.id}",
                "status_callback": f"{base}/twilio/status",
                "stream_websocket": f"{ws_base}/ws/twilio-media/{q.id}",
            })
    return {
        "configured": bool(settings.twilio_account_sid),
        "phone_number": settings.twilio_phone_number or "not set",
        "escalation_number": settings.twilio_escalation_number or "not set",
        "public_base_url": base,
        "media_stream_websocket": f"{ws_base}/ws/twilio-media/<queue_id>",
        "stream_action_webhook": f"{base}/twilio/stream-action",
        "browser_softphone": {
            "ready": len(browser_missing) == 0,
            "voice_webhook": f"{base}/twilio/browser/voice",
            "twiml_app_sid": settings.twilio_twiml_app_sid or "not set",
            "missing": browser_missing,
            "setup_steps": [
                "Create a TwiML App in Twilio and set its Voice Request URL to the browser voice webhook below using HTTP POST",
                "Create a Twilio API Key and Secret for the Voice JavaScript SDK",
                "Set VOICEOPS_TWILIO_API_KEY_SID, VOICEOPS_TWILIO_API_KEY_SECRET, and VOICEOPS_TWILIO_TWIML_APP_SID in apps/api/.env",
                "Restart the API, then open the Browser Softphone Test panel in the dashboard",
                "Select a queue, allow microphone access, and place a browser call that reuses the same Twilio Media Streams and Deepgram path",
            ],
        },
        "queues": queues_info,
        "setup_steps": [
            "1. Set VOICEOPS_TWILIO_ACCOUNT_SID, VOICEOPS_TWILIO_AUTH_TOKEN, VOICEOPS_TWILIO_PHONE_NUMBER, and VOICEOPS_DEEPGRAM_API_KEY in apps/api/.env",
            "2. Install ngrok and run: ngrok http 8020",
            "3. Set VOICEOPS_PUBLIC_BASE_URL=https://<ngrok-id>.ngrok.io in .env and restart the API",
            "4. In Twilio dashboard -> Phone Numbers -> your number -> Voice webhook = the voice_webhook URL above",
            "5. Call your Twilio number or use the browser softphone test panel to place a real Twilio-backed call",
        ],
    }


@app.get("/twilio/browser/token")
def twilio_browser_token(
    queue_id: str = Query(..., description="VoiceOps queue ID selected for the browser softphone call"),
    ctx: AuthContext = Depends(get_current_context),
    db: Session = Depends(get_db),
):
    missing = twilio_browser_missing_fields()
    if missing:
        raise HTTPException(status_code=400, detail=f"Twilio browser softphone is missing: {', '.join(missing)}")

    queue = db.scalar(select(Queue).where(Queue.id == queue_id, *scope_for_membership(ctx, Queue)))
    if queue is None:
        raise HTTPException(status_code=404, detail="Queue not found for this user")

    program = db.get(ClientProgram, queue.client_program_id)
    identity = browser_identity(ctx.user.username, ctx.membership.role, ctx.membership.id)
    token = create_voice_access_token(
        account_sid=settings.twilio_account_sid,
        api_key_sid=settings.twilio_api_key_sid,
        api_key_secret=settings.twilio_api_key_secret,
        twiml_app_sid=settings.twilio_twiml_app_sid,
        identity=identity,
        ttl_seconds=3600,
    )
    return {
        "token": token,
        "identity": identity,
        "queue_id": queue.id,
        "queue_name": queue.name,
        "program": program.name if program else "Unknown program",
        "expires_in_seconds": 3600,
    }


@app.post("/twilio/voice")
def twilio_inbound_call(
    queue_id: str = Query(..., description="VoiceOps queue ID - set this in the Twilio webhook URL"),
    From: str = Form(...),
    To: str = Form(...),
    CallSid: str = Form(...),
    db: Session = Depends(get_db),
):
    """Twilio fires this when a customer actually calls your Twilio number."""
    if not settings.deepgram_api_key:
        return XMLResponse(
            content=twiml.say_hangup("Deepgram is not configured yet. Please contact support.", "English"),
            media_type="application/xml",
        )

    queue = db.get(Queue, queue_id)
    if queue is None:
        return XMLResponse(
            content=twiml.say_hangup("Sorry, this service is temporarily unavailable. Please try again later.", "English"),
            media_type="application/xml",
        )

    program = db.get(ClientProgram, queue.client_program_id)

    customer = db.scalar(
        select(Customer).where(
            Customer.organization_id == queue.organization_id,
            Customer.phone_number == From,
        )
    )
    lang = preferred_queue_language(queue, customer)

    call = Call(
        organization_id=queue.organization_id,
        client_program_id=queue.client_program_id,
        queue_id=queue_id,
        customer_id=customer.id if customer else None,
        customer_phone=From,
        language=lang,
        status="active",
        session_state="new",
    )
    db.add(call)
    db.flush()

    outcome = session_engine.start_session(db, program, queue, call)
    db.commit()
    asyncio.run(emit_events(call.id, outcome.events))

    stream_url = f"{public_ws_base_url()}/ws/twilio-media/{queue_id}"
    action_url = f"{settings.public_base_url.rstrip('/')}/twilio/stream-action?call_id={call.id}"
    return XMLResponse(
        content=twiml.connect_stream(
            stream_url=stream_url,
            action_url=action_url,
            custom_parameters={"call_id": call.id, "queue_id": queue_id, "call_sid": CallSid},
        ),
        media_type="application/xml",
    )


@app.post("/twilio/browser/voice")
def twilio_browser_voice(
    queue_id: Annotated[str | None, Form(alias="queue_id")] = None,
    queue_id_query: str | None = Query(None, alias="queue_id"),
    From: str = Form("client:browser"),
    To: str = Form("browser-softphone"),
    CallSid: str = Form(""),
    db: Session = Depends(get_db),
):
    if not settings.deepgram_api_key:
        return XMLResponse(
            content=twiml.say_hangup("Deepgram is not configured yet. Please contact support.", "English"),
            media_type="application/xml",
        )

    resolved_queue_id = queue_id or queue_id_query
    if not resolved_queue_id:
        return XMLResponse(
            content=twiml.say_hangup("Queue information is missing for this browser call.", "English"),
            media_type="application/xml",
        )

    queue = db.get(Queue, resolved_queue_id)
    if queue is None:
        return XMLResponse(
            content=twiml.say_hangup("Sorry, this service is temporarily unavailable. Please try again later.", "English"),
            media_type="application/xml",
        )

    program = db.get(ClientProgram, queue.client_program_id)
    browser_caller = (From.removeprefix("client:") or "browser-tester").strip() or "browser-tester"
    lang = preferred_queue_language(queue)

    call = Call(
        organization_id=queue.organization_id,
        client_program_id=queue.client_program_id,
        queue_id=resolved_queue_id,
        customer_id=None,
        customer_phone=f"browser:{browser_caller}",
        language=lang,
        status="active",
        session_state="new",
    )
    db.add(call)
    db.flush()

    outcome = session_engine.start_session(db, program, queue, call)
    db.commit()
    asyncio.run(emit_events(call.id, outcome.events))

    stream_url = f"{public_ws_base_url()}/ws/twilio-media/{resolved_queue_id}"
    action_url = f"{settings.public_base_url.rstrip('/')}/twilio/stream-action?call_id={call.id}"
    return XMLResponse(
        content=twiml.connect_stream(
            stream_url=stream_url,
            action_url=action_url,
            custom_parameters={
                "call_id": call.id,
                "queue_id": resolved_queue_id,
                "call_sid": CallSid or f"browser-{call.id}",
                "source": "browser-softphone",
            },
        ),
        media_type="application/xml",
    )


@app.websocket("/ws/twilio-media/{queue_id}")
async def twilio_media_stream(websocket: WebSocket, queue_id: str):
    await run_twilio_media_bridge(websocket, queue_id, session_engine)


@app.post("/twilio/gather")
def twilio_gather_turn(
    call_id: str = Query(...),
    silence: str = Query("0"),
    SpeechResult: str = Form(""),
    Confidence: str = Form("1.0"),
    db: Session = Depends(get_db),
):
    """Twilio fires this after the customer speaks (or after silence timeout)."""
    call = db.get(Call, call_id)
    if call is None:
        return XMLResponse(
            content=twiml.say_hangup("Session not found. Please call again.", "English"),
            media_type="application/xml",
        )

    lang = call.language
    gather_url = f"{settings.public_base_url.rstrip('/')}/twilio/gather?call_id={call_id}"

    # ── Silence / no speech ───────────────────────────────────────────────────
    if silence == "1" or not SpeechResult.strip():
        prompt = (
            "Kya aap abhi bhi line par hain? Mujhe batayein main kaise madad kar sakti/sakta hoon."
            if lang == "Hindi"
            else "Are you still there? Please go ahead, I am listening."
        )
        return XMLResponse(
            content=twiml.say_gather(prompt, lang, gather_url),
            media_type="application/xml",
        )

    # ── Process the customer's spoken message ─────────────────────────────────
    program = db.get(ClientProgram, call.client_program_id)
    queue = db.get(Queue, call.queue_id)
    outcome = session_engine.process_turn(db, call, program, queue, SpeechResult.strip())
    db.commit()
    db.refresh(call)

    lang = call.language  # re-read — may have changed after language detection

    # ── Escalation → transfer to human agent ─────────────────────────────────
    if call.disposition == "escalated" and call.handoff_mode == "live":
        escalation_number = settings.twilio_escalation_number
        if escalation_number:
            return XMLResponse(
                content=twiml.say_dial(outcome.ai_message, lang, escalation_number),
                media_type="application/xml",
            )
        # No escalation number configured — fall through to callback message
        fallback = (
            "Abhi koi agent uplabdh nahi hai. Hum aapko jald callback karenge."
            if lang == "Hindi"
            else "No agent is available right now. We will call you back shortly."
        )
        return XMLResponse(
            content=twiml.say_hangup(fallback, lang),
            media_type="application/xml",
        )

    # ── Callback scheduled → close the call ──────────────────────────────────
    if call.session_state == "callback" or call.disposition == "callback":
        return XMLResponse(
            content=twiml.say_hangup(outcome.ai_message, lang),
            media_type="application/xml",
        )

    # ── Resolved / closed → thank and hang up ────────────────────────────────
    if call.session_state in ("resolved", "closed", "summary") or call.disposition == "resolved":
        closing = " Thank you for calling. Goodbye." if lang == "English" else " Dhanyavaad. Namaste."
        return XMLResponse(
            content=twiml.say_hangup(outcome.ai_message + closing, lang),
            media_type="application/xml",
        )

    # ── Continue conversation ─────────────────────────────────────────────────
    return XMLResponse(
        content=twiml.say_gather(outcome.ai_message, lang, gather_url),
        media_type="application/xml",
    )


@app.post("/twilio/status")
def twilio_call_status(
    call_id: str = Query(None),
    CallSid: str = Form(""),
    CallStatus: str = Form(""),
    db: Session = Depends(get_db),
):
    """Twilio fires this when the call ends (completed, no-answer, busy, failed)."""
    if call_id:
        call = db.get(Call, call_id)
        if call and call.status == "active":
            call.status = "completed"
            call.session_state = "closed"
            call.ended_at = datetime.now(timezone.utc)
            db.commit()
    return XMLResponse(content="", status_code=204, media_type="text/plain")


@app.post("/twilio/stream-action")
def twilio_stream_action(
    call_id: str = Query(...),
    StreamEvent: str = Form(""),
    StreamSid: str = Form(""),
    db: Session = Depends(get_db),
):
    call = db.get(Call, call_id)
    if call is None:
        return XMLResponse(content=twiml.hangup_only(), media_type="application/xml")

    if call.disposition == "escalated" and call.handoff_mode == "live":
        escalation_number = settings.twilio_escalation_number
        if escalation_number:
            dial_action = f"{settings.public_base_url.rstrip('/')}/twilio/dial-complete?call_id={call.id}"
            return XMLResponse(
                content=twiml.dial_only(escalation_number, dial_action),
                media_type="application/xml",
            )

        fallback = (
            "Abhi koi agent uplabdh nahi hai. Hum aapko jald callback karenge."
            if call.language == "Hindi"
            else "No agent is available right now. We will call you back shortly."
        )
        if call.status == "active":
            call.status = "completed"
            call.session_state = "closed"
            call.ended_at = datetime.now(timezone.utc)
            db.commit()
        return XMLResponse(content=twiml.say_hangup(fallback, call.language), media_type="application/xml")

    if call.status == "active":
        call.status = "completed"
        call.session_state = "closed"
        call.ended_at = datetime.now(timezone.utc)
        db.commit()

    return XMLResponse(content=twiml.hangup_only(), media_type="application/xml")


@app.post("/twilio/dial-complete")
def twilio_dial_complete(
    call_id: str = Query(...),
    DialCallStatus: str = Form(""),
    db: Session = Depends(get_db),
):
    call = db.get(Call, call_id)
    if call and call.status == "active":
        call.status = "completed"
        call.session_state = "closed"
        call.ended_at = datetime.now(timezone.utc)
        db.commit()
    return XMLResponse(content=twiml.hangup_only(), media_type="application/xml")


# ── Squad endpoints ───────────────────────────────────────────────────────────


@app.get("/squad/status", response_model=list[SquadAgentRead])
def squad_status(ctx: AuthContext = Depends(get_current_context)):
    return agent_pool.squad_status()


@app.post("/squad/sessions", response_model=SquadTurnResponse)
def squad_start_session(
    payload: SquadSessionRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    if payload.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Cannot start a session for another organization")

    program = db.get(ClientProgram, payload.client_program_id)
    queue = db.get(Queue, payload.queue_id)
    if program is None or queue is None:
        raise HTTPException(status_code=404, detail="Program or queue not found")

    customer = db.scalar(
        select(Customer).where(
            Customer.organization_id == payload.organization_id,
            Customer.phone_number == payload.customer_phone,
        )
    )

    language = payload.preferred_language or (customer.language_preference if customer else "English")

    call = Call(
        organization_id=payload.organization_id,
        client_program_id=payload.client_program_id,
        queue_id=payload.queue_id,
        customer_id=customer.id if customer else None,
        customer_phone=payload.customer_phone,
        language=language,
        status="active",
        session_state="new",
    )
    db.add(call)
    db.flush()

    agent_info = agent_pool.assign_call(call.id, language)
    if agent_info is None:
        db.rollback()
        raise HTTPException(status_code=503, detail="All agents are currently busy. Please try again in a moment.")

    worker = agent_pool.get_worker(call.id)
    opening = worker.opening_message(call, program)

    opening_turn = CallTurn(
        call_id=call.id,
        organization_id=call.organization_id,
        client_program_id=call.client_program_id,
        speaker="ai",
        message=opening,
        language=language,
        event_type="message",
    )
    db.add(opening_turn)
    db.commit()
    db.refresh(call)

    transcript = db.scalars(select(CallTurn).where(CallTurn.call_id == call.id).order_by(CallTurn.created_at)).all()
    asyncio.run(emit_events(call.id, [{"type": "squad_session_started", "agent": agent_info["name"]}]))

    return SquadTurnResponse(
        call_id=call.id,
        agent_id=agent_info["id"],
        agent_name=agent_info["name"],
        ai_message=opening,
        escalated=False,
        tool_used=None,
        transcript=[CallTurnRead.model_validate(t) for t in transcript],
    )


@app.post("/squad/sessions/{call_id}/turns", response_model=SquadTurnResponse)
def squad_turn(
    call_id: str,
    payload: SquadTurnRequest,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")

    worker = agent_pool.get_worker(call_id)
    agent_info = agent_pool.get_agent_info(call_id)
    if worker is None or agent_info is None:
        raise HTTPException(status_code=409, detail="No agent assigned to this call. The session may have ended.")

    # Capture history BEFORE adding the current customer turn so Claude
    # receives it once as the current user message, not twice in history + message.
    history = list(db.scalars(select(CallTurn).where(CallTurn.call_id == call_id).order_by(CallTurn.created_at)).all())

    customer_turn = CallTurn(
        call_id=call.id,
        organization_id=call.organization_id,
        client_program_id=call.client_program_id,
        speaker="customer",
        message=payload.message,
        language=call.language,
        event_type="message",
    )
    db.add(customer_turn)
    db.flush()

    result = worker.process_turn(db, call, db.get(ClientProgram, call.client_program_id), payload.message, history)

    ai_turn = CallTurn(
        call_id=call.id,
        organization_id=call.organization_id,
        client_program_id=call.client_program_id,
        speaker="ai",
        message=result["ai_message"],
        language=call.language,
        event_type="escalation" if result["escalated"] else "message",
    )
    db.add(ai_turn)

    if result["escalated"]:
        call.disposition = "escalated"
        call.session_state = "live_handoff"
        call.escalation_reason = result.get("tool_result", {}).get("reason", "Agent escalation")
        agent_pool.mark_escalation(call_id)
    elif result["tool_name"]:
        tool_inv = ToolInvocation(
            call_id=call.id,
            organization_id=call.organization_id,
            client_program_id=call.client_program_id,
            tool_name=result["tool_name"],
            input_json={},
            output_json=result["tool_result"] or {},
            status="success",
        )
        db.add(tool_inv)

    db.commit()
    db.refresh(call)

    transcript = db.scalars(select(CallTurn).where(CallTurn.call_id == call_id).order_by(CallTurn.created_at)).all()
    asyncio.run(emit_events(call_id, [{"type": "squad_turn", "agent": agent_info["name"], "escalated": result["escalated"]}]))

    return SquadTurnResponse(
        call_id=call.id,
        agent_id=agent_info["id"],
        agent_name=agent_info["name"],
        ai_message=result["ai_message"],
        escalated=result["escalated"],
        tool_used=result["tool_name"],
        transcript=[CallTurnRead.model_validate(t) for t in transcript],
    )


@app.post("/squad/sessions/{call_id}/close")
def squad_close_session(
    call_id: str,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    call = db.get(Call, call_id)
    if call is None or call.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=404, detail="Call not found")
    call.status = "completed"
    call.session_state = "closed"
    call.ended_at = datetime.now(timezone.utc)
    agent_pool.release_call(call_id)
    db.commit()
    return {"ok": True, "call_id": call_id}


# ── Customer Click-to-Call (no third party) ───────────────────────────────────

import jwt as _jwt
from datetime import timedelta


@app.post("/customer-sessions", response_model=CustomerSessionInfo)
def create_customer_session(
    payload: CustomerSessionCreate,
    ctx: AuthContext = Depends(require_roles("org_owner", "program_admin", "supervisor", "agent")),
    db: Session = Depends(get_db),
):
    """Agent creates a shareable call link. Customer opens it and talks directly to the AI."""
    queue = db.get(Queue, payload.queue_id)
    program = db.get(ClientProgram, payload.client_program_id)
    if queue is None or program is None:
        raise HTTPException(status_code=404, detail="Queue or program not found")
    if queue.organization_id != ctx.membership.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")

    expires = datetime.now(timezone.utc) + timedelta(hours=payload.expires_hours)
    token = _jwt.encode(
        {
            "queue_id": payload.queue_id,
            "program_id": payload.client_program_id,
            "phone": payload.customer_phone,
            "language": payload.preferred_language,
            "exp": expires,
        },
        settings.secret_key,
        algorithm="HS256",
    )
    call_url = f"{payload.frontend_base_url.rstrip('/')}/call/{token}"
    return CustomerSessionInfo(
        token=token,
        call_url=call_url,
        expires_in_hours=payload.expires_hours,
        program=program.name,
        queue=queue.name,
        language=payload.preferred_language,
    )


@app.websocket("/ws/customer-call/{token}")
async def customer_call_ws(websocket: WebSocket, token: str):
    """WebSocket for customer click-to-call. Token encodes the session context."""
    await websocket.accept()

    # Validate token
    try:
        payload = _jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except Exception:
        await websocket.send_json({"type": "error", "message": "This call link has expired. Ask the agent for a new one."})
        await websocket.close()
        return

    queue_id = payload.get("queue_id")
    program_id = payload.get("program_id")
    customer_phone = payload.get("phone", "unknown")
    language = payload.get("language", "English")

    db = SessionLocal()
    try:
        queue = db.get(Queue, queue_id)
        program = db.get(ClientProgram, program_id)

        if queue is None or program is None:
            await websocket.send_json({"type": "error", "message": "Service not available. Please contact support."})
            await websocket.close()
            return

        customer = None
        if customer_phone != "unknown":
            customer = db.scalar(
                select(Customer).where(
                    Customer.organization_id == queue.organization_id,
                    Customer.phone_number == customer_phone,
                )
            )

        call = Call(
            organization_id=queue.organization_id,
            client_program_id=program_id,
            queue_id=queue_id,
            customer_id=customer.id if customer else None,
            customer_phone=customer_phone,
            language=language,
            status="active",
            session_state="new",
        )
        db.add(call)
        db.flush()

        outcome = session_engine.start_session(db, program, queue, call)
        db.commit()

        # Send session info + opening message to browser
        await websocket.send_json({
            "type": "ready",
            "call_id": call.id,
            "language": call.language,
            "program": program.name,
            "ai_message": outcome.ai_message,
        })

        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "turn":
                message = data.get("message", "").strip()
                if not message:
                    continue
                db.refresh(call)
                turn_outcome = session_engine.process_turn(db, call, program, queue, message)
                db.commit()
                db.refresh(call)

                await websocket.send_json({
                    "type": "ai_reply",
                    "text": turn_outcome.ai_message,
                    "state": call.session_state,
                    "disposition": call.disposition,
                })

                if call.session_state in ("resolved", "closed", "callback") or call.disposition in ("resolved", "escalated"):
                    await asyncio.sleep(0.5)
                    await websocket.send_json({"type": "call_ended", "reason": call.disposition})
                    break

            elif msg_type == "end":
                call.status = "completed"
                call.session_state = "closed"
                call.ended_at = datetime.now(timezone.utc)
                db.commit()
                await websocket.send_json({"type": "call_ended", "reason": "customer_ended"})
                break

    except WebSocketDisconnect:
        try:
            c = db.get(Call, call.id) if call else None
            if c and c.status == "active":
                c.status = "completed"
                c.session_state = "closed"
                c.ended_at = datetime.now(timezone.utc)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


