from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.models import (
    AuditLog,
    Call,
    CallTurn,
    CallbackTask,
    CaseRecord,
    ClientProgram,
    ConsentEvent,
    Customer,
    KnowledgeChunk,
    KnowledgeDocument,
    Organization,
    QAReview,
    Queue,
    StaffMembership,
    StaffUser,
    Ticket,
)


def _turns_for(intent: str, language: str, disclosure: str) -> list[tuple[str, str, str]]:
    if intent == "case_status":
        if language == "Hindi":
            return [
                ("ai", disclosure, "system_disclosure"),
                ("customer", "Mujhe apne claim ka status chahiye.", "message"),
                ("ai", "Kripya apna Customer ID batayein.", "assistant_response"),
                ("customer", "Mera code CUS-1001 hai.", "message"),
                ("ai", "Dhanyavad. Aapka claim abhi under review hai.", "assistant_response"),
            ]
        return [
            ("ai", disclosure, "system_disclosure"),
            ("customer", "I need the status of my claim.", "message"),
            ("ai", "Please confirm your customer ID.", "assistant_response"),
            ("customer", "My code is CUS-1001.", "message"),
            ("ai", "Thank you. Your claim is currently under review.", "assistant_response"),
        ]
    if intent == "faq_answer":
        if language == "Hindi":
            return [
                ("ai", disclosure, "system_disclosure"),
                ("customer", "Claim ke liye kaunse documents chahiye?", "message"),
                ("ai", "Aapko photo ID, policy number, claim form aur original bills chahiye.", "assistant_response"),
            ]
        return [
            ("ai", disclosure, "system_disclosure"),
            ("customer", "What documents do I need for a claim?", "message"),
            ("ai", "You need a photo ID, policy number, claim form, and original bills.", "assistant_response"),
        ]
    if intent == "callback_request":
        return [
            ("ai", disclosure, "system_disclosure"),
            ("customer", "Please arrange a callback.", "message"),
            ("ai", "I have queued a callback for the next available specialist.", "assistant_response"),
        ]
    if intent == "human_transfer":
        return [
            ("ai", disclosure, "system_disclosure"),
            ("customer", "I want to speak to a human agent.", "message"),
            ("ai", "I am connecting you to a human specialist now.", "assistant_response"),
        ]
    return [
        ("ai", disclosure, "system_disclosure"),
        ("customer", "I have a complaint about my service.", "message"),
        ("ai", "I have logged the issue and arranged the right follow-up.", "assistant_response"),
    ]


def _add_completed_call(
    db: Session,
    *,
    org_id: str,
    program: ClientProgram,
    queue: Queue,
    customer: Customer,
    language: str,
    intent: str,
    sentiment: str,
    disposition: str,
    started_at: datetime,
    duration_minutes: int,
    summary: str,
    disclosure: str,
    handoff_mode: str | None = None,
) -> Call:
    resolution_status = {
        "resolved": "resolved",
        "callback": "callback_pending",
        "escalated": "handoff_in_progress",
        "ticket": "ticket_open",
        "open": "in_progress",
    }.get(disposition, "in_progress")

    call = Call(
        organization_id=org_id,
        client_program_id=program.id,
        queue_id=queue.id,
        customer_id=customer.id,
        customer_phone=customer.phone_number,
        status="completed",
        session_state="closed",
        disposition=disposition,
        resolution_status=resolution_status,
        language=language,
        sentiment=sentiment,
        intent=intent,
        confidence=0.91 if intent != "human_transfer" else 0.97,
        verification_state="verified" if intent in {"case_status", "human_transfer"} else "not_required",
        recording_consent=True,
        ai_disclosure_acknowledged=True,
        handoff_mode=handoff_mode,
        summary=summary,
        escalation_reason="Customer requested live agent" if disposition == "escalated" else "",
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=duration_minutes),
    )
    db.add(call)
    db.flush()

    for speaker, message, event_type in _turns_for(intent, language, disclosure):
        db.add(
            CallTurn(
                call_id=call.id,
                organization_id=org_id,
                client_program_id=program.id,
                speaker=speaker,
                message=message,
                language=language,
                event_type=event_type,
            )
        )

    db.add(
        ConsentEvent(
            call_id=call.id,
            organization_id=org_id,
            client_program_id=program.id,
            recording_opt_in=True,
            ai_disclosure_ack=True,
            language=language,
        )
    )
    return call


def build_default_program_policy() -> dict:
    return {
        "version": 1,
        "mode": "ai_first_then_human",
        "intent_policy": {
            "allowed_intents": [
                "greeting",
                "faq_answer",
                "case_status",
                "policy_query",
                "payment_issue",
                "complaint",
                "callback_request",
                "human_transfer",
                "verification",
            ],
            "default_intent": "unknown_needs_clarification",
            "blocked_intents": [],
        },
        "confidence_policy": {
            "answer_threshold": 0.8,
            "clarify_threshold": 0.55,
            "escalate_threshold": 0.4,
            "max_clarify_turns": 1,
        },
        "fallback_policy": {
            "on_low_confidence": "clarify_then_escalate",
            "on_no_kb_match": "ask_clarify",
            "on_missing_required_data": "ask_one_question",
            "on_silent_user": "repeat_prompt_once",
        },
        "verification_policy": {"required_for": ["case_status"], "allowed_identifiers": ["customer_code", "last4_phone"]},
        "escalation_policy": {
            "live_triggers": ["human_request", "angry", "verification_failures", "low_confidence", "high_risk"],
            "callback_when_unavailable": True,
            "callback_triggers": ["no_agent_available", "outside_business_hours", "callback_request", "low_confidence"],
            "require_summary_before_handoff": True,
        },
        "kb_policy": {
            "allowed_document_types": ["faq", "policy", "procedure"],
            "allowed_intents": ["faq_answer", "case_status", "policy_query", "payment_issue"],
            "must_be_approved": True,
            "match_same_program_only": True,
        },
        "tool_policy": {
            "enabled_tools": ["lookup_case", "create_ticket", "create_callback", "request_handoff", "verify_customer"],
        },
        "response_style": {
            "tone": "calm",
            "length": "short",
            "language_policy": "match_caller",
            "ask_one_question_at_a_time": True,
            "confirm_critical_details": True,
        },
        "queue_policy": {
            "live_handoff_enabled": True,
            "callback_enabled": True,
            "supported_channels": ["phone", "browser"],
        },
    }


def seed_database(db: Session) -> None:
    if db.scalar(select(Organization.id)):
        return

    org = Organization(
        name="BrightConnect BPO",
        slug="brightconnect-bpo",
        default_languages=["English", "Hindi"],
    )
    db.add(org)
    db.flush()

    programs = [
        ClientProgram(
            organization_id=org.id,
            name="Acme Insurance",
            slug="acme-insurance",
            description="Policy and claim support program with bilingual disclosure scripts.",
            languages=["English", "Hindi"],
            verification_policy={"required_for": ["case_status"], "allowed_identifiers": ["customer_code", "last4_phone"]},
            handoff_policy={"live_on": ["human_request", "angry", "verification_failures", "vip"], "callback_on_unavailable": True},
            policy_version=1,
            policy_status="active",
            policy_json=build_default_program_policy(),
            disclosure_template_en="Hello, you are speaking with VoiceOps Control for Acme Insurance. This conversation may be recorded for quality and support. How can I help you today?",
            disclosure_template_hi="Namaste, aap VoiceOps Control se baat kar rahe hain. Yeh call quality aur support ke liye record ho sakti hai. Main aaj aapki kaise madad kar sakta hoon?",
        ),
        ClientProgram(
            organization_id=org.id,
            name="HealthPlus",
            slug="healthplus",
            description="Claims and benefit support queue for policyholders.",
            languages=["English", "Hindi"],
            verification_policy={"required_for": ["case_status"], "allowed_identifiers": ["customer_code", "last4_phone"]},
            handoff_policy={"live_on": ["human_request", "angry", "verification_failures", "vip"], "callback_on_unavailable": True},
            policy_version=1,
            policy_status="active",
            policy_json=build_default_program_policy(),
            disclosure_template_en="Hello, you are speaking with VoiceOps Control for HealthPlus. This conversation may be recorded. What do you need help with today?",
            disclosure_template_hi="Namaste, aap HealthPlus support line par hain. Yeh call record ho sakti hai. Aaj aapko kis madad ki zarurat hai?",
        ),
    ]
    db.add_all(programs)
    db.flush()
    acme_program, health_program = programs

    queues = [
        Queue(organization_id=org.id, client_program_id=acme_program.id, name="Acme Bilingual Queue", supported_languages=["English", "Hindi"]),
        Queue(organization_id=org.id, client_program_id=health_program.id, name="HealthPlus Claims Queue", supported_languages=["English", "Hindi"]),
    ]
    db.add_all(queues)
    db.flush()
    acme_queue, health_queue = queues

    users = [
        StaffUser(username="owner", full_name="Riya Kapoor", password_hash=hash_password("voiceops123")),
        StaffUser(username="supervisor", full_name="Anita Singh", password_hash=hash_password("voiceops123")),
        StaffUser(username="agent", full_name="Arjun Mehta", password_hash=hash_password("voiceops123")),
        StaffUser(username="qa", full_name="Pooja Sharma", password_hash=hash_password("voiceops123")),
    ]
    db.add_all(users)
    db.flush()

    memberships = [
        StaffMembership(user_id=users[0].id, organization_id=org.id, client_program_id=None, role="org_owner", display_name="Riya Kapoor", languages=["English", "Hindi"]),
        StaffMembership(user_id=users[1].id, organization_id=org.id, client_program_id=acme_program.id, role="supervisor", display_name="Anita Singh", languages=["English", "Hindi"]),
        StaffMembership(user_id=users[2].id, organization_id=org.id, client_program_id=acme_program.id, role="agent", display_name="Arjun Mehta", languages=["English", "Hindi"]),
        StaffMembership(user_id=users[3].id, organization_id=org.id, client_program_id=acme_program.id, role="qa_reviewer", display_name="Pooja Sharma", languages=["English", "Hindi"]),
    ]
    db.add_all(memberships)
    db.flush()
    owner_membership, supervisor_membership, agent_membership, qa_membership = memberships

    customers = [
        Customer(organization_id=org.id, client_program_id=acme_program.id, full_name="Rohit Sharma", phone_number="+919876543210", email="rohit@example.com", customer_code="CUS-1001", language_preference="English"),
        Customer(organization_id=org.id, client_program_id=acme_program.id, full_name="Suman Verma", phone_number="+919876543211", email="suman@example.com", customer_code="CUS-1002", language_preference="Hindi"),
        Customer(organization_id=org.id, client_program_id=health_program.id, full_name="Neha Joshi", phone_number="+919123456789", email="neha@example.com", customer_code="CUS-2001", language_preference="Hindi", vip=True),
        Customer(organization_id=org.id, client_program_id=health_program.id, full_name="Vikram Patel", phone_number="+919090909090", email="vikram@example.com", customer_code="CUS-2002", language_preference="English"),
        Customer(organization_id=org.id, client_program_id=acme_program.id, full_name="Priya Malhotra", phone_number="+919988001122", email="priya@example.com", customer_code="CUS-1003", language_preference="Hindi"),
        Customer(organization_id=org.id, client_program_id=acme_program.id, full_name="Manish Gupta", phone_number="+919911223344", email="manish@example.com", customer_code="CUS-1004", language_preference="English"),
        Customer(organization_id=org.id, client_program_id=health_program.id, full_name="Kavya Nair", phone_number="+919977665544", email="kavya@example.com", customer_code="CUS-2003", language_preference="Hindi"),
        Customer(organization_id=org.id, client_program_id=acme_program.id, full_name="Arjun Kapoor", phone_number="+919833445566", email="arjunk@example.com", customer_code="CUS-1005", language_preference="English"),
    ]
    db.add_all(customers)
    db.flush()
    rohit, suman, neha, vikram, priya, manish, kavya, arjun_customer = customers

    db.add_all(
        [
            CaseRecord(organization_id=org.id, client_program_id=acme_program.id, customer_id=rohit.id, case_number="CLM-9001", case_type="claim_status", status="Under Review", summary="Motor claim pending assessor review.", last_updated_note="Assessor documents received today."),
            CaseRecord(organization_id=org.id, client_program_id=acme_program.id, customer_id=suman.id, case_number="POL-4402", case_type="policy_status", status="Active", summary="Family floater policy active until March 2027.", last_updated_note="Premium paid on time."),
            CaseRecord(organization_id=org.id, client_program_id=health_program.id, customer_id=neha.id, case_number="HLT-3007", case_type="claim_status", status="Rejected", summary="Claim rejected due to missing discharge summary.", last_updated_note="Customer can appeal within 7 days."),
            CaseRecord(organization_id=org.id, client_program_id=health_program.id, customer_id=vikram.id, case_number="HLT-3012", case_type="claim_status", status="Approved", summary="Hospital claim approved. Reimbursement processing.", last_updated_note="Payment expected within 5 days."),
            CaseRecord(organization_id=org.id, client_program_id=acme_program.id, customer_id=manish.id, case_number="CLM-9088", case_type="claim_status", status="Pending", summary="Two-wheeler claim submitted. Awaiting documents.", last_updated_note="Customer to upload photos within 3 days."),
            CaseRecord(organization_id=org.id, client_program_id=acme_program.id, customer_id=arjun_customer.id, case_number="CLM-9102", case_type="claim_status", status="Closed", summary="Home insurance claim settled.", last_updated_note="Cheque dispatched on 2026-06-25."),
        ]
    )

    docs = [
        KnowledgeDocument(organization_id=org.id, client_program_id=acme_program.id, title="Claim FAQ", source_type="faq", status="active", languages=["English", "Hindi"], tags=["claims", "faq"]),
        KnowledgeDocument(organization_id=org.id, client_program_id=acme_program.id, title="Required Documents", source_type="sop", status="active", languages=["English", "Hindi"], tags=["documents", "claim"]),
        KnowledgeDocument(organization_id=org.id, client_program_id=health_program.id, title="Reimbursement SOP", source_type="sop", status="active", languages=["English", "Hindi"], tags=["reimbursement", "health"]),
        KnowledgeDocument(organization_id=org.id, client_program_id=health_program.id, title="Appeal Process FAQ", source_type="faq", status="active", languages=["English"], tags=["appeal", "rejection"]),
    ]
    db.add_all(docs)
    db.flush()

    db.add_all(
        [
            KnowledgeChunk(document_id=docs[0].id, organization_id=org.id, client_program_id=acme_program.id, language="English", content="Claim status updates are available after customer verification. Typical review time is 3 to 5 business days after all documents are received.", keywords=["claim", "status", "review", "business days"]),
            KnowledgeChunk(document_id=docs[0].id, organization_id=org.id, client_program_id=acme_program.id, language="Hindi", content="Claim status customer verification ke baad share kiya ja sakta hai. Documents complete hone ke baad 3 se 5 business days lagte hain.", keywords=["claim", "status", "verification", "hindi"]),
            KnowledgeChunk(document_id=docs[1].id, organization_id=org.id, client_program_id=acme_program.id, language="English", content="Required claim documents: valid photo ID, policy number, filled claim form, original bills, and discharge summary where applicable.", keywords=["required", "documents", "claim", "policy"]),
            KnowledgeChunk(document_id=docs[2].id, organization_id=org.id, client_program_id=health_program.id, language="English", content="Reimbursement claims must include hospital discharge summary, original bills, and prescription copies. Approval takes 7 to 10 working days.", keywords=["reimbursement", "hospital", "approval", "discharge"]),
            KnowledgeChunk(document_id=docs[3].id, organization_id=org.id, client_program_id=health_program.id, language="English", content="If your claim is rejected, you can file an appeal within 7 days by submitting the appeal form with supporting documents at any branch or online.", keywords=["appeal", "rejection", "7 days", "claim"]),
        ]
    )

    now = datetime.now(timezone.utc)
    today_base = now.replace(hour=2, minute=30, second=0, microsecond=0)
    yesterday_base = today_base - timedelta(days=1)

    completed_calls: list[Call] = []
    call_specs = [
        (acme_program, acme_queue, rohit, "English", "case_status", "neutral", "resolved", today_base + timedelta(minutes=0), 5, "Customer called to check claim status. Verification passed and current under-review status was shared.", acme_program.disclosure_template_en, None),
        (acme_program, acme_queue, suman, "Hindi", "faq_answer", "positive", "resolved", today_base + timedelta(minutes=12), 4, "Customer asked for claim document requirements. FAQ answer provided in Hindi and customer confirmed understanding.", acme_program.disclosure_template_hi, None),
        (health_program, health_queue, neha, "Hindi", "human_transfer", "angry", "escalated", today_base + timedelta(minutes=28), 9, "Customer requested a human specialist after a rejected claim discussion. Call was escalated.", health_program.disclosure_template_hi, "live"),
        (acme_program, acme_queue, priya, "Hindi", "callback_request", "neutral", "callback", today_base + timedelta(minutes=45), 3, "Customer preferred a callback for policy renewal discussion. Callback was queued.", acme_program.disclosure_template_hi, "callback"),
        (acme_program, acme_queue, manish, "English", "new_complaint", "neutral", "ticket", today_base + timedelta(minutes=60), 7, "Customer reported an auto-debit issue. Ticket created for billing review.", acme_program.disclosure_template_en, None),
        (health_program, health_queue, vikram, "English", "case_status", "neutral", "resolved", today_base + timedelta(minutes=84), 6, "Customer checked reimbursement claim status. Approved status shared clearly.", health_program.disclosure_template_en, None),
        (acme_program, acme_queue, rohit, "English", "case_status", "neutral", "resolved", yesterday_base + timedelta(minutes=10), 6, "Customer checked claim status. Verification passed and update shared.", acme_program.disclosure_template_en, None),
        (health_program, health_queue, neha, "Hindi", "new_complaint", "angry", "escalated", yesterday_base + timedelta(minutes=45), 8, "Rejected-claim complaint escalated to a live specialist.", health_program.disclosure_template_hi, "live"),
        (acme_program, acme_queue, manish, "English", "callback_request", "neutral", "callback", yesterday_base + timedelta(minutes=70), 4, "Callback requested for policy follow-up.", acme_program.disclosure_template_en, "callback"),
        (health_program, health_queue, kavya, "Hindi", "faq_answer", "positive", "resolved", yesterday_base + timedelta(minutes=95), 4, "Health reimbursement FAQ answered successfully in Hindi.", health_program.disclosure_template_hi, None),
    ]

    for spec in call_specs:
        completed_calls.append(
            _add_completed_call(
                db,
                org_id=org.id,
                program=spec[0],
                queue=spec[1],
                customer=spec[2],
                language=spec[3],
                intent=spec[4],
                sentiment=spec[5],
                disposition=spec[6],
                started_at=spec[7],
                duration_minutes=spec[8],
                summary=spec[9],
                disclosure=spec[10],
                handoff_mode=spec[11],
            )
        )

    db.add_all(
        [
            Ticket(organization_id=org.id, client_program_id=acme_program.id, customer_id=manish.id, call_id=completed_calls[4].id, title="Complaint: auto-debit failure", description="Late fee charged after debit failure. Billing team to review and waive.", priority="high", status="open", created_by="ai", assigned_to_membership_id=supervisor_membership.id),
            Ticket(organization_id=org.id, client_program_id=health_program.id, customer_id=neha.id, call_id=completed_calls[2].id, title="Rejected claim appeal support", description="Customer needs supervisor guidance for appeal submission.", priority="medium", status="in_progress", created_by="ai"),
            Ticket(organization_id=org.id, client_program_id=acme_program.id, customer_id=rohit.id, call_id=None, title="Document clarification", description="Customer asked for a manual clarification on claim requirements.", priority="medium", status="open", created_by="human"),
        ]
    )

    db.add_all(
        [
            CallbackTask(organization_id=org.id, client_program_id=acme_program.id, customer_id=priya.id, call_id=completed_calls[3].id, priority="medium", reason="Policy renewal discussion requested in Hindi.", scheduled_for_label="11:30 AM today", status="pending"),
            CallbackTask(organization_id=org.id, client_program_id=health_program.id, customer_id=neha.id, call_id=completed_calls[2].id, priority="high", reason="Supervisor callback after escalated rejected-claim complaint.", scheduled_for_label="12:00 PM today", status="pending"),
            CallbackTask(organization_id=org.id, client_program_id=acme_program.id, customer_id=manish.id, call_id=completed_calls[8].id, priority="medium", reason="Requested callback for policy follow-up.", scheduled_for_label="01:00 PM today", status="pending"),
        ]
    )

    db.add_all(
        [
            QAReview(organization_id=org.id, client_program_id=completed_calls[0].client_program_id, call_id=completed_calls[0].id, reviewer_membership_id=qa_membership.id, score=88, status="reviewed", flags=["clear_disclosure"], notes="Smooth verification and clear case status delivery."),
            QAReview(organization_id=org.id, client_program_id=completed_calls[1].client_program_id, call_id=completed_calls[1].id, reviewer_membership_id=qa_membership.id, score=92, status="reviewed", flags=["clear_disclosure"], notes="Excellent bilingual FAQ handling."),
            QAReview(organization_id=org.id, client_program_id=completed_calls[2].client_program_id, call_id=completed_calls[2].id, reviewer_membership_id=qa_membership.id, score=None, status="in_review", flags=[], notes="Escalated call under review."),
            QAReview(organization_id=org.id, client_program_id=completed_calls[4].client_program_id, call_id=completed_calls[4].id, reviewer_membership_id=None, score=None, status="pending", flags=["needs_review"], notes="Complaint ticket call awaiting QA review."),
        ]
    )

    db.add_all(
        [
            AuditLog(organization_id=org.id, client_program_id=acme_program.id, actor_type="system", actor_id="seed", action="seed_initialized", entity_type="organization", entity_id=org.id, details={"note": "Initial demo workspace seeded"}),
            AuditLog(organization_id=org.id, client_program_id=acme_program.id, actor_type="system", actor_id="seed", action="knowledge_seeded", entity_type="knowledge_document", entity_id=docs[0].id, details={"count": len(docs)}),
        ]
    )

    db.commit()
