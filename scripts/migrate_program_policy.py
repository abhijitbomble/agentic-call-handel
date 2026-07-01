from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, text

REPO_ROOT = Path(__file__).resolve().parents[1]
API_DIR = REPO_ROOT / "apps" / "api"
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from app.db import engine, SessionLocal  # noqa: E402
from app.models import ClientProgram  # noqa: E402

DEFAULT_PROGRAM_POLICY: dict[str, Any] = {
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


def build_default_program_policy() -> dict[str, Any]:
    return json.loads(json.dumps(DEFAULT_PROGRAM_POLICY))


def ensure_columns() -> None:
    dialect = engine.dialect.name
    with engine.begin() as conn:
        inspector = inspect(conn)
        columns = {column["name"] for column in inspector.get_columns("client_programs")}

        statements: list[str] = []
        if "policy_version" not in columns:
            statements.append("ALTER TABLE client_programs ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1")
        if "policy_status" not in columns:
            statements.append("ALTER TABLE client_programs ADD COLUMN policy_status VARCHAR(20) NOT NULL DEFAULT 'active'")
        if "policy_json" not in columns:
            if dialect == "postgresql":
                statements.append("ALTER TABLE client_programs ADD COLUMN policy_json JSONB NOT NULL DEFAULT '{}'::jsonb")
            else:
                statements.append("ALTER TABLE client_programs ADD COLUMN policy_json JSON NOT NULL DEFAULT '{}' ")
        if "policy_updated_at" not in columns:
            statements.append("ALTER TABLE client_programs ADD COLUMN policy_updated_at TIMESTAMP WITH TIME ZONE NULL")
        if "policy_updated_by" not in columns:
            statements.append("ALTER TABLE client_programs ADD COLUMN policy_updated_by VARCHAR(36) NULL")

        for statement in statements:
            conn.execute(text(statement))


def backfill_program_policy() -> None:
    with SessionLocal() as db:
        programs = db.query(ClientProgram).all()
        changed = False
        for program in programs:
            policy = program.policy_json if isinstance(program.policy_json, dict) and program.policy_json else None
            if not policy:
                policy = build_default_program_policy()
                if isinstance(program.verification_policy, dict) and program.verification_policy:
                    policy["verification_policy"] = {**policy["verification_policy"], **program.verification_policy}
                if isinstance(program.handoff_policy, dict) and program.handoff_policy:
                    policy["handoff_policy"] = {**program.handoff_policy}
                program.policy_json = policy
                program.policy_version = program.policy_version or 1
                program.policy_status = program.policy_status or "active"
                changed = True

        if changed:
            db.commit()


def main() -> None:
    ensure_columns()
    backfill_program_policy()
    print("Program policy migration complete.")


if __name__ == "__main__":
    main()
