from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

logger = logging.getLogger(__name__)

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.event_hub import event_hub
from app.models import (
    AuditLog,
    Call,
    CallTurn,
    CallbackTask,
    CaseRecord,
    ClientProgram,
    ConsentEvent,
    Customer,
    HandoffEvent,
    KnowledgeDocument,
    KnowledgeChunk,
    QAReview,
    Queue,
    StaffMembership,
    Ticket,
    ToolInvocation,
)


class ChannelAdapter(Protocol):
    def session_metadata(self, queue: Queue) -> dict[str, Any]: ...


class SttAdapter(Protocol):
    def transcribe(self, message: str) -> str: ...


class DialogAdapter(Protocol):
    def classify(self, message: str) -> dict[str, Any]: ...


class TtsAdapter(Protocol):
    def render_text(self, text: str, language: str) -> dict[str, Any]: ...


class KnowledgeAdapter(Protocol):
    def search(self, db: Session, program_id: str, language: str, message: str) -> dict[str, Any] | None: ...


class ToolExecutor(Protocol):
    def execute(self, tool_name: str, payload: dict[str, Any]) -> dict[str, Any]: ...


class HandoffAdapter(Protocol):
    def choose_mode(
        self,
        db: Session,
        call: Call,
        queue: Queue,
        program: ClientProgram,
        reason: str,
        explicit_human_request: bool,
        high_risk: bool,
        low_confidence: bool,
    ) -> dict[str, Any]: ...


class BrowserChannelAdapter:
    def session_metadata(self, queue: Queue) -> dict[str, Any]:
        return {
            "channel": "browser",
            "queue_name": queue.name,
            "business_hours": f"{queue.business_hours_start}-{queue.business_hours_end}",
        }


class NoopSttAdapter:
    def transcribe(self, message: str) -> str:
        return message.strip()


class RuleBasedDialogAdapter:
    anger_markers = {"angry", "upset", "frustrated", "complaint", "escalate", "gussa", "naraz", "disappointed"}
    human_markers = {"human", "agent", "representative", "person", "callback", "specialist", "insaan"}
    complaint_markers = {"complaint", "issue", "problem", "not working", "wrong", "bad service", "reject", "rejected"}
    status_markers = {"status", "claim", "policy", "case", "ticket", "premium", "update", "due date"}
    faq_markers = {"documents", "requirement", "how", "when", "process", "faq"}
    hindi_markers = {"namaste", "meri", "mujhe", "kripya", "madad", "nahi", "hai", "kya", "policy number", "premium due"}

    def classify(self, message: str) -> dict[str, Any]:
        lowered = message.lower()
        language = "Hindi" if re.search(r"[\u0900-\u097F]", message) or any(word in lowered for word in self.hindi_markers) else "English"
        sentiment = "angry" if any(marker in lowered for marker in self.anger_markers) else "neutral"
        if any(marker in lowered for marker in self.human_markers):
            intent = "human_transfer" if "human" in lowered or "agent" in lowered or "representative" in lowered else "callback_request"
            confidence = 0.95
        elif extract_case_number(message) or any(marker in lowered for marker in self.status_markers):
            intent = "case_status"
            confidence = 0.9
        elif any(marker in lowered for marker in self.complaint_markers):
            intent = "new_complaint"
            confidence = 0.9
        elif any(marker in lowered for marker in self.faq_markers):
            intent = "faq_answer"
            confidence = 0.82
        else:
            intent = "unknown_needs_clarification"
            confidence = 0.52
        return {
            "intent": intent,
            "confidence": confidence,
            "language": language,
            "sentiment": sentiment,
        }


class TemplateTtsAdapter:
    def render_text(self, text: str, language: str) -> dict[str, Any]:
        return {"text": text, "language": language, "voice": "piper-placeholder"}


class ClaudeDialogAdapter:
    """Classifies customer intent using Claude Haiku. Falls back to rule-based on any failure."""

    _SYSTEM = (
        "Classify this BPO customer voice message. Return JSON only — no markdown, no explanation:\n"
        '{"intent":"<case_status|complaint_registration|policy_query|billing_dispute'
        "|human_transfer|callback_request|faq_answer|greeting|unknown_needs_clarification>"
        '","confidence":<0.0-1.0>,"language":"<English|Hindi>","sentiment":"<positive|neutral|negative|angry>"}'
    )

    def __init__(self, api_key: str) -> None:
        self._client: Any = None
        self._fallback = RuleBasedDialogAdapter()
        if not api_key:
            return
        try:
            from anthropic import Anthropic  # type: ignore[import-untyped]
            self._client = Anthropic(api_key=api_key)
        except Exception as exc:
            logger.warning("anthropic unavailable for classification: %s", exc)

    def classify(self, message: str) -> dict[str, Any]:
        if self._client is None:
            return self._fallback.classify(message)
        try:
            resp = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=120,
                system=self._SYSTEM,
                messages=[{"role": "user", "content": message}],
            )
            raw = re.sub(r"^```[a-z]*\n?|```$", "", resp.content[0].text.strip(), flags=re.MULTILINE).strip()
            return json.loads(raw)
        except Exception as exc:
            logger.warning("Claude classification failed, using rule-based: %s", exc)
            return self._fallback.classify(message)


class ClaudeResponseGenerator:
    """Generates natural voice responses using Claude Haiku. Returns None on any failure so callers can fall back."""

    _SYSTEM = (
        "You are a professional AI voice assistant at a BPO call centre. "
        "A routing system has already decided what action to take; your only job is to "
        "deliver that outcome to the customer in clear, warm, natural spoken language. "
        "Rules: 1-3 short sentences. Never say you are Claude or an AI model. "
        "Do not invent information beyond what is given. Return only the spoken words."
    )

    def __init__(self, api_key: str) -> None:
        self._client: Any = None
        if not api_key:
            return
        try:
            from anthropic import Anthropic  # type: ignore[import-untyped]
            self._client = Anthropic(api_key=api_key)
        except Exception as exc:
            logger.warning("anthropic unavailable for response generation: %s", exc)

    def generate(self, situation: str, language: str = "English") -> str | None:
        if self._client is None:
            return None
        lang_note = f" Respond in {language}." if language != "English" else ""
        try:
            resp = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=200,
                system=self._SYSTEM + lang_note,
                messages=[{"role": "user", "content": situation}],
            )
            return resp.content[0].text.strip()
        except Exception as exc:
            logger.warning("Claude response generation failed: %s", exc)
            return None


DEFAULT_VERIFICATION_POLICY = {
    "required_for": ["case_status"],
    "allowed_identifiers": ["customer_code", "last4_phone"],
}

DEFAULT_HANDOFF_POLICY = {
    "live_on": ["human_request", "angry", "verification_failures", "vip", "low_confidence"],
    "callback_on_unavailable": True,
    "low_confidence_threshold": 0.7,
}

DEFAULT_PROGRAM_POLICY = {
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
            "new_complaint",
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
    "verification_policy": DEFAULT_VERIFICATION_POLICY,
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


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = json.loads(json.dumps(base))
    for key, value in override.items():
        if isinstance(result.get(key), dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


INTENT_ALIASES = {
    "complaint_registration": "new_complaint",
    "complaint": "new_complaint",
    "billing_dispute": "payment_issue",
}


def normalize_intent_name(intent: str | None) -> str:
    if not intent:
        return "unknown_needs_clarification"
    return INTENT_ALIASES.get(intent, intent)


def policy_list_or_default(policy: dict[str, Any], key: str, fallback: list[str]) -> list[str]:
    value = policy.get(key)
    if not isinstance(value, list) or not value:
        return list(fallback)
    return [str(item) for item in value if str(item)]


def program_policy(program: ClientProgram) -> dict[str, Any]:
    policy = json.loads(json.dumps(DEFAULT_PROGRAM_POLICY))
    if isinstance(program.policy_json, dict) and program.policy_json:
        policy = _deep_merge(policy, program.policy_json)

    legacy_verification = program.verification_policy if isinstance(program.verification_policy, dict) else {}
    if legacy_verification:
        policy["verification_policy"] = {**policy.get("verification_policy", {}), **legacy_verification}

    legacy_handoff = program.handoff_policy if isinstance(program.handoff_policy, dict) else {}
    if legacy_handoff:
        policy["handoff_policy"] = {**policy.get("handoff_policy", {}), **legacy_handoff}
        escalation_policy = policy.get("escalation_policy", {})
        if isinstance(escalation_policy, dict):
            escalation_policy.setdefault("live_triggers", legacy_handoff.get("live_on", []))
            escalation_policy.setdefault("callback_when_unavailable", legacy_handoff.get("callback_on_unavailable", True))
            if "low_confidence_threshold" in legacy_handoff:
                escalation_policy.setdefault("low_confidence_threshold", legacy_handoff["low_confidence_threshold"])
            policy["escalation_policy"] = escalation_policy

    if "handoff_policy" not in policy or not isinstance(policy.get("handoff_policy"), dict):
        escalation_policy = policy.get("escalation_policy", {}) if isinstance(policy.get("escalation_policy"), dict) else {}
        confidence_policy = policy.get("confidence_policy", {}) if isinstance(policy.get("confidence_policy"), dict) else {}
        policy["handoff_policy"] = {
            "live_on": list(escalation_policy.get("live_triggers", DEFAULT_HANDOFF_POLICY["live_on"])),
            "callback_on_unavailable": bool(escalation_policy.get("callback_when_unavailable", True)),
            "low_confidence_threshold": float(confidence_policy.get("escalate_threshold", DEFAULT_HANDOFF_POLICY["low_confidence_threshold"])),
        }

    return policy


def merged_verification_policy(program: ClientProgram) -> dict[str, Any]:
    policy = program_policy(program)
    return {
        **DEFAULT_VERIFICATION_POLICY,
        **(policy.get("verification_policy") if isinstance(policy.get("verification_policy"), dict) else {}),
    }


def merged_handoff_policy(program: ClientProgram) -> dict[str, Any]:
    policy = program_policy(program)
    return {
        **DEFAULT_HANDOFF_POLICY,
        **(policy.get("handoff_policy") if isinstance(policy.get("handoff_policy"), dict) else {}),
    }


def policy_mode(program: ClientProgram) -> str:
    policy = program_policy(program)
    mode = policy.get("mode")
    return str(mode) if mode else str(DEFAULT_PROGRAM_POLICY["mode"])


def intent_policy_for(program: ClientProgram) -> dict[str, Any]:
    policy = program_policy(program)
    intent_policy = policy.get("intent_policy", {}) if isinstance(policy.get("intent_policy"), dict) else {}
    return {
        "allowed_intents": policy_list_or_default(intent_policy, "allowed_intents", DEFAULT_PROGRAM_POLICY["intent_policy"]["allowed_intents"]),
        "blocked_intents": policy_list_or_default(intent_policy, "blocked_intents", DEFAULT_PROGRAM_POLICY["intent_policy"]["blocked_intents"]),
        "default_intent": str(intent_policy.get("default_intent", DEFAULT_PROGRAM_POLICY["intent_policy"]["default_intent"])),
    }


def kb_policy_for(program: ClientProgram) -> dict[str, Any]:
    policy = program_policy(program)
    kb_policy = policy.get("kb_policy", {}) if isinstance(policy.get("kb_policy"), dict) else {}
    return {
        "allowed_document_types": policy_list_or_default(
            kb_policy,
            "allowed_document_types",
            DEFAULT_PROGRAM_POLICY["kb_policy"]["allowed_document_types"],
        ),
        "allowed_intents": policy_list_or_default(
            kb_policy,
            "allowed_intents",
            DEFAULT_PROGRAM_POLICY["kb_policy"]["allowed_intents"],
        ),
        "must_be_approved": bool(kb_policy.get("must_be_approved", True)),
        "match_same_program_only": bool(kb_policy.get("match_same_program_only", True)),
    }


def response_style_for(program: ClientProgram) -> dict[str, Any]:
    policy = program_policy(program)
    response_style = policy.get("response_style", {}) if isinstance(policy.get("response_style"), dict) else {}
    return {
        "tone": str(response_style.get("tone", DEFAULT_PROGRAM_POLICY["response_style"]["tone"])),
        "length": str(response_style.get("length", DEFAULT_PROGRAM_POLICY["response_style"]["length"])),
        "language_policy": str(response_style.get("language_policy", DEFAULT_PROGRAM_POLICY["response_style"]["language_policy"])),
        "ask_one_question_at_a_time": bool(response_style.get("ask_one_question_at_a_time", True)),
        "confirm_critical_details": bool(response_style.get("confirm_critical_details", True)),
    }


def supported_channels_for(program: ClientProgram) -> list[str]:
    policy = program_policy(program)
    queue_policy = policy.get("queue_policy", {}) if isinstance(policy.get("queue_policy"), dict) else {}
    return policy_list_or_default(
        queue_policy,
        "supported_channels",
        DEFAULT_PROGRAM_POLICY["queue_policy"]["supported_channels"],
    )


def policy_runtime_summary(program: ClientProgram) -> dict[str, Any]:
    program_policy_data = program_policy(program)
    intent_policy = intent_policy_for(program)
    kb_policy = kb_policy_for(program)
    escalation_policy = program_policy_data.get("escalation_policy", {}) if isinstance(program_policy_data.get("escalation_policy"), dict) else {}
    confidence_policy = program_policy_data.get("confidence_policy", {}) if isinstance(program_policy_data.get("confidence_policy"), dict) else {}
    response_style = response_style_for(program)
    return {
        "mode": policy_mode(program),
        "intent_policy": intent_policy,
        "verification_policy": {
            "required_for": sorted(verification_required_for(program)),
            "allowed_identifiers": verification_identifiers_for(program),
        },
        "confidence_policy": {
            "answer_threshold": float(confidence_policy.get("answer_threshold", DEFAULT_PROGRAM_POLICY["confidence_policy"]["answer_threshold"])),
            "clarify_threshold": float(confidence_policy.get("clarify_threshold", DEFAULT_PROGRAM_POLICY["confidence_policy"]["clarify_threshold"])),
            "escalate_threshold": low_confidence_threshold_for(program),
            "max_clarify_turns": int(confidence_policy.get("max_clarify_turns", DEFAULT_PROGRAM_POLICY["confidence_policy"]["max_clarify_turns"])),
        },
        "fallback_policy": program_policy_data.get("fallback_policy", DEFAULT_PROGRAM_POLICY["fallback_policy"]),
        "escalation_policy": {
            "live_triggers": sorted(handoff_live_triggers_for(program)),
            "callback_when_unavailable": bool(escalation_policy.get("callback_when_unavailable", True)),
            "callback_triggers": policy_list_or_default(
                escalation_policy,
                "callback_triggers",
                DEFAULT_PROGRAM_POLICY["escalation_policy"]["callback_triggers"],
            ),
            "require_summary_before_handoff": bool(escalation_policy.get("require_summary_before_handoff", True)),
        },
        "kb_policy": kb_policy,
        "tool_policy": {
            "enabled_tools": policy_list_or_default(
                program_policy_data.get("tool_policy", {}) if isinstance(program_policy_data.get("tool_policy"), dict) else {},
                "enabled_tools",
                DEFAULT_PROGRAM_POLICY["tool_policy"]["enabled_tools"],
            ),
        },
        "response_style": response_style,
        "queue_policy": {
            "supported_channels": supported_channels_for(program),
            "live_handoff_enabled": bool(program_policy_data.get("queue_policy", {}).get("live_handoff_enabled", True)) if isinstance(program_policy_data.get("queue_policy"), dict) else True,
            "callback_enabled": bool(program_policy_data.get("queue_policy", {}).get("callback_enabled", True)) if isinstance(program_policy_data.get("queue_policy"), dict) else True,
        },
    }


def policy_warnings_for(program: ClientProgram) -> list[str]:
    summary = policy_runtime_summary(program)
    warnings: list[str] = []
    if not summary["queue_policy"]["supported_channels"]:
        warnings.append("No supported channels configured.")
    if summary["mode"] == "ai_only" and summary["escalation_policy"]["live_triggers"]:
        warnings.append("AI-only mode is set, so live handoff triggers will not be used.")
    if not summary["kb_policy"]["allowed_document_types"]:
        warnings.append("No KB document types are allowed, so knowledge answering is effectively disabled.")
    if not summary["kb_policy"]["allowed_intents"]:
        warnings.append("No KB intents are allowed, so the agent will never answer from KB.")
    if summary["confidence_policy"]["escalate_threshold"] < 0.2 or summary["confidence_policy"]["escalate_threshold"] > 0.85:
        warnings.append("Confidence threshold is outside the recommended operating range.")
    return warnings


def intent_allowed_for(program: ClientProgram, intent: str) -> bool:
    policy = intent_policy_for(program)
    normalized = normalize_intent_name(intent)
    allowed = {normalize_intent_name(item) for item in policy["allowed_intents"]}
    blocked = {normalize_intent_name(item) for item in policy["blocked_intents"]}
    if normalized in blocked:
        return False
    if not allowed:
        return True
    return normalized in allowed or intent in policy["allowed_intents"]


def kb_intent_allowed_for(program: ClientProgram, intent: str) -> bool:
    policy = kb_policy_for(program)
    allowed = {normalize_intent_name(item) for item in policy["allowed_intents"]}
    normalized = normalize_intent_name(intent)
    if not allowed:
        return False
    return normalized in allowed or intent in policy["allowed_intents"]


def kb_document_types_for(program: ClientProgram) -> list[str]:
    return kb_policy_for(program)["allowed_document_types"]


def should_use_knowledge(program: ClientProgram, intent: str, confidence: float) -> bool:
    if not kb_intent_allowed_for(program, intent):
        return False
    policy = program_policy(program)
    confidence_policy = policy.get("confidence_policy", {}) if isinstance(policy.get("confidence_policy"), dict) else {}
    answer_threshold = float(confidence_policy.get("answer_threshold", DEFAULT_PROGRAM_POLICY["confidence_policy"]["answer_threshold"]))
    return confidence >= min(answer_threshold, 1.0)


def verification_required_for(program: ClientProgram) -> set[str]:
    policy = merged_verification_policy(program)
    return set(policy_list_or_default(policy, "required_for", DEFAULT_VERIFICATION_POLICY["required_for"]))


def verification_identifiers_for(program: ClientProgram) -> list[str]:
    policy = merged_verification_policy(program)
    return policy_list_or_default(policy, "allowed_identifiers", DEFAULT_VERIFICATION_POLICY["allowed_identifiers"])


def handoff_live_triggers_for(program: ClientProgram) -> set[str]:
    policy = program_policy(program)
    escalation = policy.get("escalation_policy", {}) if isinstance(policy.get("escalation_policy"), dict) else {}
    live_triggers = escalation.get("live_triggers")
    if isinstance(live_triggers, list) and live_triggers:
        return set(policy_list_or_default(escalation, "live_triggers", DEFAULT_HANDOFF_POLICY["live_on"]))
    legacy = merged_handoff_policy(program)
    return set(policy_list_or_default(legacy, "live_on", DEFAULT_HANDOFF_POLICY["live_on"]))


def low_confidence_threshold_for(program: ClientProgram) -> float:
    policy = program_policy(program)
    confidence_policy = policy.get("confidence_policy", {}) if isinstance(policy.get("confidence_policy"), dict) else {}
    value = confidence_policy.get("escalate_threshold", None)
    if value is None:
        legacy = merged_handoff_policy(program)
        value = legacy.get("low_confidence_threshold", DEFAULT_HANDOFF_POLICY["low_confidence_threshold"])
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(DEFAULT_HANDOFF_POLICY["low_confidence_threshold"])


def storage_policies_from_program_policy(policy: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    verification = policy.get("verification_policy", {}) if isinstance(policy.get("verification_policy"), dict) else {}
    handoff = policy.get("handoff_policy", {}) if isinstance(policy.get("handoff_policy"), dict) else {}
    if not handoff:
        escalation_policy = policy.get("escalation_policy", {}) if isinstance(policy.get("escalation_policy"), dict) else {}
        confidence_policy = policy.get("confidence_policy", {}) if isinstance(policy.get("confidence_policy"), dict) else {}
        handoff = {
            "live_on": list(escalation_policy.get("live_triggers", DEFAULT_HANDOFF_POLICY["live_on"])),
            "callback_on_unavailable": bool(escalation_policy.get("callback_when_unavailable", True)),
            "low_confidence_threshold": float(confidence_policy.get("escalate_threshold", DEFAULT_HANDOFF_POLICY["low_confidence_threshold"])),
        }
    return verification, handoff


def update_program_policy(
    program: ClientProgram,
    policy_updates: dict[str, Any],
    *,
    updated_by: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    merged = _deep_merge(program_policy(program), policy_updates if isinstance(policy_updates, dict) else {})
    verification_policy, handoff_policy = storage_policies_from_program_policy(merged)
    program.policy_json = merged
    program.verification_policy = verification_policy
    program.handoff_policy = handoff_policy
    program.policy_version = int(program.policy_version or 1) + 1
    program.policy_status = status or program.policy_status or "active"
    program.policy_updated_at = datetime.now(timezone.utc)
    program.policy_updated_by = updated_by
    return merged


def build_verification_prompt(program: ClientProgram) -> str:
    identifiers = verification_identifiers_for(program)
    prompts: list[str] = []
    if "customer_code" in identifiers:
        prompts.append("your customer code")
    if "last4_phone" in identifiers:
        prompts.append("the last 4 digits of your registered number")
    if not prompts:
        prompts.append("your registered account details")
    if len(prompts) == 1:
        joined = prompts[0]
    elif len(prompts) == 2:
        joined = f"{prompts[0]} or {prompts[1]}"
    else:
        joined = ", ".join(prompts[:-1]) + f", or {prompts[-1]}"
    return f"For security, please confirm {joined}."


_KB_STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "your",
    "what",
    "when",
    "where",
    "how",
    "why",
    "can",
    "could",
    "would",
    "should",
    "please",
    "need",
    "about",
    "into",
    "been",
    "able",
    "will",
    "not",
    "you",
    "are",
    "our",
    "they",
    "them",
}


def kb_tokens(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", text.lower())
        if len(token) > 2 and token not in _KB_STOPWORDS
    }


class SqlKnowledgeAdapter:
    def search(
        self,
        db: Session,
        program_id: str,
        language: str,
        message: str,
        allowed_document_types: list[str] | None = None,
    ) -> dict[str, Any] | None:
        lowered = message.lower()
        question_tokens = kb_tokens(message)
        docs_stmt = select(KnowledgeDocument.id).where(
            KnowledgeDocument.client_program_id == program_id,
            KnowledgeDocument.status == "active",
        )
        if allowed_document_types:
            docs_stmt = docs_stmt.where(KnowledgeDocument.source_type.in_(allowed_document_types))
        allowed_doc_ids = db.scalars(docs_stmt).all()
        if not allowed_doc_ids:
            return None
        chunks = db.scalars(
            select(KnowledgeChunk).where(
                KnowledgeChunk.client_program_id == program_id,
                KnowledgeChunk.document_id.in_(allowed_doc_ids),
            )
        ).all()
        scored: list[tuple[int, KnowledgeChunk]] = []
        for chunk in chunks:
            keyword_hits = sum(1 for keyword in chunk.keywords if keyword.lower() in lowered or keyword.lower() in question_tokens)
            content_tokens = kb_tokens(chunk.content)
            content_hits = len(question_tokens & content_tokens)
            score = keyword_hits * 3 + content_hits
            if chunk.language == language:
                score += 1
            if score:
                scored.append((score, chunk))
        if not scored:
            return None
        _, best = max(scored, key=lambda item: item[0])
        return {"chunk_id": best.id, "answer": best.content, "language": best.language}


class SqlToolExecutor:
    def __init__(self, db: Session, call: Call, program: ClientProgram) -> None:
        self.db = db
        self.call = call
        self.program = program

    def record(self, tool_name: str, payload: dict[str, Any], output: dict[str, Any], status: str = "success", error_message: str = "") -> dict[str, Any]:
        invocation = ToolInvocation(
            call_id=self.call.id,
            organization_id=self.call.organization_id,
            client_program_id=self.call.client_program_id,
            tool_name=tool_name,
            input_json=payload,
            output_json=output,
            status=status,
            error_message=error_message,
        )
        self.db.add(invocation)
        return {"tool_name": tool_name, "status": status, "output": output}

    def execute(self, tool_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        handler = getattr(self, tool_name)
        return handler(payload)

    def find_customer(self, payload: dict[str, Any]) -> dict[str, Any]:
        phone = payload.get("phone_number", self.call.customer_phone)
        customer_code = payload.get("customer_code")
        stmt = select(Customer).where(
            Customer.organization_id == self.call.organization_id,
            Customer.client_program_id == self.call.client_program_id,
        )
        customers = self.db.scalars(stmt).all()
        customer = next((item for item in customers if item.phone_number == phone or item.customer_code == customer_code), None)
        output = {"found": customer is not None, "customer_id": customer.id if customer else None, "customer_code": customer.customer_code if customer else None}
        return self.record("find_customer", payload, output)

    def verify_customer(self, payload: dict[str, Any]) -> dict[str, Any]:
        customer = self.db.get(Customer, self.call.customer_id) if self.call.customer_id else None
        provided = payload.get("provided", "")
        allowed_identifiers = verification_identifiers_for(self.program)
        verified = False
        matched_by = None
        if customer:
            lowered = provided.lower()
            digits = re.sub(r"\D+", "", provided)
            if "customer_code" in allowed_identifiers and customer.customer_code.lower() in lowered:
                verified = True
                matched_by = "customer_code"
            elif "last4_phone" in allowed_identifiers and customer.phone_number[-4:] in digits:
                verified = True
                matched_by = "last4_phone"
        output = {
            "verified": verified,
            "matched_by": matched_by,
            "allowed_identifiers": allowed_identifiers,
        }
        self.call.verification_state = "verified" if verified else "pending"
        if not verified:
            self.call.failed_verification_attempts += 1
        return self.record("verify_customer", payload, output, status="success" if verified else "failed")

    def search_knowledge(self, payload: dict[str, Any]) -> dict[str, Any]:
        adapter = SqlKnowledgeAdapter()
        result = adapter.search(
            self.db,
            self.call.client_program_id,
            self.call.language,
            payload["query"],
            allowed_document_types=kb_document_types_for(self.program),
        )
        output = result or {"answer": "I could not find an approved answer in the current knowledge base."}
        return self.record("search_knowledge", payload, output)

    def lookup_case(self, payload: dict[str, Any]) -> dict[str, Any]:
        case_number = payload.get("case_number")
        stmt = select(CaseRecord).where(
            CaseRecord.organization_id == self.call.organization_id,
            CaseRecord.client_program_id == self.call.client_program_id,
        )
        if self.call.customer_id:
            stmt = stmt.where(CaseRecord.customer_id == self.call.customer_id)
        cases = self.db.scalars(stmt).all()
        case = next((item for item in cases if item.case_number == case_number), None) if case_number else (cases[0] if cases else None)
        output = {
            "found": case is not None,
            "case_number": case.case_number if case else None,
            "status": case.status if case else None,
            "summary": case.summary if case else None,
            "last_updated_note": case.last_updated_note if case else None,
        }
        return self.record("lookup_case", payload, output, status="success" if case else "failed")

    def create_ticket(self, payload: dict[str, Any]) -> dict[str, Any]:
        ticket = Ticket(
            organization_id=self.call.organization_id,
            client_program_id=self.call.client_program_id,
            customer_id=self.call.customer_id,
            call_id=self.call.id,
            title=payload["title"],
            description=payload["description"],
            priority=payload.get("priority", "medium"),
            status="open",
            created_by="ai",
        )
        self.db.add(ticket)
        self.db.flush()
        output = {"ticket_id": ticket.id, "priority": ticket.priority, "status": ticket.status}
        return self.record("create_ticket", payload, output)

    def create_callback(self, payload: dict[str, Any]) -> dict[str, Any]:
        task = CallbackTask(
            organization_id=self.call.organization_id,
            client_program_id=self.call.client_program_id,
            customer_id=self.call.customer_id,
            call_id=self.call.id,
            priority=payload.get("priority", "medium"),
            reason=payload["reason"],
            scheduled_for_label=payload.get("scheduled_for_label", "Next available slot"),
            status="pending",
        )
        self.db.add(task)
        self.db.flush()
        output = {"callback_id": task.id, "status": task.status, "priority": task.priority}
        return self.record("create_callback", payload, output)

    def request_handoff(self, payload: dict[str, Any]) -> dict[str, Any]:
        queue = self.db.get(Queue, self.call.queue_id)
        adapter = SupervisorHandoffAdapter()
        output = adapter.choose_mode(
            db=self.db,
            call=self.call,
            queue=queue,
            program=self.program,
            reason=payload["reason"],
            explicit_human_request=payload.get("explicit_human_request", False),
            high_risk=payload.get("high_risk", False),
            low_confidence=payload.get("low_confidence", False),
        )
        return self.record("request_handoff", payload, output, status="success" if output["mode"] else "failed")

    def log_summary(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.call.summary = payload["summary"]
        output = {"summary": self.call.summary}
        return self.record("log_summary", payload, output)


class SupervisorHandoffAdapter:
    def choose_mode(
        self,
        db: Session,
        call: Call,
        queue: Queue,
        program: ClientProgram,
        reason: str,
        explicit_human_request: bool,
        high_risk: bool,
        low_confidence: bool,
    ) -> dict[str, Any]:
        mode = policy_mode(program)
        available_agent = db.scalar(
            select(StaffMembership).where(
                StaffMembership.organization_id == call.organization_id,
                StaffMembership.client_program_id == call.client_program_id,
                StaffMembership.role.in_(["agent", "supervisor"]),
                StaffMembership.is_available.is_(True),
            )
        )
        live_triggers = handoff_live_triggers_for(program)
        live_desired = mode != "callback_only" and any(
            [
                explicit_human_request and "human_request" in live_triggers,
                call.sentiment == "angry" and "angry" in live_triggers,
                high_risk and ("high_risk" in live_triggers or "vip" in live_triggers),
                call.failed_verification_attempts >= 3 and "verification_failures" in live_triggers,
                low_confidence and "low_confidence" in live_triggers,
            ]
        )
        if live_desired and queue.live_handoff_enabled and available_agent:
            event = HandoffEvent(
                call_id=call.id,
                organization_id=call.organization_id,
                client_program_id=call.client_program_id,
                queue_id=queue.id,
                mode="live",
                reason=reason,
                status="accepted",
                assigned_to_membership_id=available_agent.id,
            )
            db.add(event)
            call.handoff_mode = "live"
            call.session_state = "live_handoff"
            call.disposition = "escalated"
            call.escalation_reason = reason
            return {"mode": "live", "assigned_membership_id": available_agent.id, "reason": reason}
        callback_on_unavailable = bool(merged_handoff_policy(program).get("callback_on_unavailable", True))
        if queue.callback_enabled and (callback_on_unavailable or not live_desired or mode == "callback_only"):
            event = HandoffEvent(
                call_id=call.id,
                organization_id=call.organization_id,
                client_program_id=call.client_program_id,
                queue_id=queue.id,
                mode="callback",
                reason=reason,
                status="queued",
            )
            db.add(event)
            call.handoff_mode = "callback"
            call.session_state = "callback"
            call.disposition = "callback"
            call.escalation_reason = reason
            return {"mode": "callback", "assigned_membership_id": None, "reason": reason}
        return {"mode": None, "assigned_membership_id": None, "reason": reason}


def make_summary(call: Call, latest_customer_message: str, latest_ai_message: str) -> str:
    return (
        f"Intent: {call.intent}. "
        f"Language: {call.language}. "
        f"Verification: {call.verification_state}. "
        f"Disposition: {call.disposition}. "
        f"Customer said: {latest_customer_message[:90]}. "
        f"AI replied: {latest_ai_message[:120]}."
    )


def extract_case_number(message: str) -> str | None:
    match = re.search(r"(CLM|POL|HLT)-\d{3,6}", message.upper())
    return match.group(0) if match else None


def requires_verification(intent: str) -> bool:
    return intent == "case_status"


def program_requires_verification(program: ClientProgram, intent: str) -> bool:
    return intent in verification_required_for(program)


@dataclass(slots=True)
class SessionOutcome:
    ai_message: str
    events: list[dict[str, Any]]
    tools: list[dict[str, Any]]


class SessionEngine:
    def __init__(
        self,
        channel_adapter: ChannelAdapter | None = None,
        stt_adapter: SttAdapter | None = None,
        dialog_adapter: DialogAdapter | None = None,
        tts_adapter: TtsAdapter | None = None,
    ) -> None:
        from app.config import get_settings
        api_key = get_settings().anthropic_api_key
        self.channel_adapter = channel_adapter or BrowserChannelAdapter()
        self.stt_adapter = stt_adapter or NoopSttAdapter()
        self.dialog_adapter = dialog_adapter or (ClaudeDialogAdapter(api_key) if api_key else RuleBasedDialogAdapter())
        self.tts_adapter = tts_adapter or TemplateTtsAdapter()
        self._claude = ClaudeResponseGenerator(api_key) if api_key else None
        if api_key:
            logger.info("SessionEngine: Claude AI enabled (classification + response generation)")
        else:
            logger.info("SessionEngine: rule-based mode (set VOICEOPS_ANTHROPIC_API_KEY to enable Claude AI)")

    def _respond(self, situation: str, fallback: str, language: str = "English") -> str:
        """Return a Claude-generated response if available, otherwise the fallback template."""
        if self._claude:
            generated = self._claude.generate(situation, language)
            if generated:
                return generated
        return fallback

    def start_session(self, db: Session, program: ClientProgram, queue: Queue, call: Call) -> SessionOutcome:
        call.session_state = "disclosure_consent"
        language = call.language
        message = program.disclosure_template_hi if language == "Hindi" else program.disclosure_template_en
        ai_turn = CallTurn(
            call_id=call.id,
            organization_id=call.organization_id,
            client_program_id=call.client_program_id,
            speaker="ai",
            message=message,
            language=language,
            event_type="system_disclosure",
        )
        db.add(ai_turn)
        events = [
            {"type": "session.started", "call_id": call.id, "state": call.session_state},
            {"type": "language.detected", "call_id": call.id, "language": call.language},
        ]
        return SessionOutcome(ai_message=message, events=events, tools=[])

    def process_turn(self, db: Session, call: Call, program: ClientProgram, queue: Queue, message: str) -> SessionOutcome:
        text = self.stt_adapter.transcribe(message)
        tool_runner = SqlToolExecutor(db, call, program)
        events: list[dict[str, Any]] = []
        tools: list[dict[str, Any]] = []
        customer_turn = CallTurn(
            call_id=call.id,
            organization_id=call.organization_id,
            client_program_id=call.client_program_id,
            speaker="customer",
            message=text,
            language=call.language,
        )
        db.add(customer_turn)

        classification = self.dialog_adapter.classify(text)
        call.language = classification["language"]
        call.sentiment = classification["sentiment"]
        call.intent = normalize_intent_name(classification["intent"])
        call.confidence = classification["confidence"]
        low_confidence_threshold = low_confidence_threshold_for(program)
        events.append({"type": "intent.updated", "call_id": call.id, "intent": call.intent, "confidence": call.confidence})
        events.append({"type": "language.detected", "call_id": call.id, "language": call.language})
        if not intent_allowed_for(program, call.intent):
            events.append({"type": "intent.restricted", "call_id": call.id, "intent": call.intent})
            call.intent = normalize_intent_name(program_policy(program).get("intent_policy", {}).get("default_intent", "unknown_needs_clarification"))

        if call.session_state == "disclosure_consent":
            opted_out = any(flag in text.lower() for flag in ["don't record", "do not record", "recording off", "without recording"])
            call.recording_consent = not opted_out
            call.ai_disclosure_acknowledged = True
            consent = ConsentEvent(
                call_id=call.id,
                organization_id=call.organization_id,
                client_program_id=call.client_program_id,
                recording_opt_in=call.recording_consent,
                ai_disclosure_ack=True,
                language=call.language,
            )
            db.add(consent)
            call.session_state = "language_detected"

        customer = db.get(Customer, call.customer_id) if call.customer_id else None
        if customer is None:
            found = tool_runner.find_customer({"phone_number": call.customer_phone})
            tools.append(found)
            if found["output"]["found"]:
                call.customer_id = found["output"]["customer_id"]
                customer = db.get(Customer, call.customer_id)

        ai_message = ""
        # If we are already mid-verification, keep routing there regardless of re-classified intent
        was_awaiting_verification = call.session_state == "verification_if_needed" and call.verification_state != "verified"
        if not was_awaiting_verification and not program_requires_verification(program, call.intent) and call.verification_state == "pending":
            call.verification_state = "not_required"

        if was_awaiting_verification or (program_requires_verification(program, call.intent) and call.verification_state != "verified"):
            call.session_state = "verification_if_needed"
            events.append({"type": "verification.required", "call_id": call.id})
            verify = tool_runner.verify_customer({"provided": text})
            tools.append(verify)
            if verify["output"]["verified"]:
                # Look for case number in current message first, then search prior customer turns
                case_number = extract_case_number(text)
                if not case_number:
                    prior_turns = db.scalars(
                        select(CallTurn).where(CallTurn.call_id == call.id, CallTurn.speaker == "customer").order_by(CallTurn.created_at)
                    ).all()
                    for prior_turn in prior_turns:
                        case_number = extract_case_number(prior_turn.message)
                        if case_number:
                            break
                if case_number:
                    case_result = tool_runner.lookup_case({"case_number": case_number})
                    tools.append(case_result)
                    if case_result["output"]["found"]:
                        data = case_result["output"]
                        ai_message = self._respond(
                            f"Customer identity verified. Case {data['case_number']} found. Status: {data['status']}. "
                            f"Summary: {data['summary']}. Note: {data['last_updated_note']}. "
                            "Confirm identity verified and deliver the complete status update warmly.",
                            f"Thank you, your identity is confirmed. Your case {data['case_number']} is currently {data['status']}. {data['summary']} {data['last_updated_note']}",
                            call.language,
                        )
                        call.session_state = "resolved"
                        call.disposition = "resolved"
                        call.resolution_status = "resolved"
                    else:
                        ai_message = self._respond(
                            "Customer identity verified but the requested case number was not found in the system. "
                            "Apologise and offer to connect them to a human specialist or schedule a callback.",
                            "I verified your identity, but I could not find that case number yet. I can connect you to a human specialist or create a callback.",
                            call.language,
                        )
                else:
                    ai_message = self._respond(
                        "Customer identity verified. No case number provided yet. "
                        "Ask them to give their case or claim number (e.g. CLM-1234, POL-4402, HLT-3007).",
                        "Thank you. Your identity is verified. Please provide your case or claim number (e.g., CLM-1234) so I can look it up.",
                        call.language,
                    )
                    call.session_state = "answer_or_tool_action"
            else:
                if call.failed_verification_attempts >= 3:
                    handoff = tool_runner.request_handoff(
                        {
                            "reason": "Verification failed three times",
                            "explicit_human_request": False,
                            "high_risk": True,
                        }
                    )
                    tools.append(handoff)
                    if handoff["output"]["mode"] == "callback":
                        callback = tool_runner.create_callback({"reason": "Verification failed three times", "priority": "high"})
                        tools.append(callback)
                        events.append({"type": "callback.created", "call_id": call.id, "callback_id": callback["output"]["callback_id"]})
                        ai_message = self._respond(
                            "Identity verification failed 3 times. Created a priority callback for a human specialist. "
                            "Apologise to the customer and inform them a specialist will call back.",
                            "I could not verify the account details securely, so I created a priority callback for a human specialist.",
                            call.language,
                        )
                    else:
                        events.append({"type": "handoff.requested", "call_id": call.id, "mode": handoff["output"]["mode"]})
                        ai_message = self._respond(
                            "Identity verification failed 3 times. Connecting customer to a human support specialist now.",
                            "I could not verify the account details securely, so I am connecting you to a human support specialist now.",
                            call.language,
                        )
                else:
                    remaining = 3 - call.failed_verification_attempts
                    identifiers = " or ".join(verification_identifiers_for(program))
                    ai_message = self._respond(
                        f"Identity verification failed. {call.failed_verification_attempts} attempt(s) used. "
                        f"{remaining} attempt(s) remaining. Ask the customer to try again using: {identifiers}. Be polite.",
                        build_verification_prompt(program),
                        call.language,
                    )
        elif call.intent == "human_transfer":
            handoff = tool_runner.request_handoff(
                {"reason": "Customer explicitly requested a human agent", "explicit_human_request": True, "high_risk": customer.vip if customer else False}
            )
            tools.append(handoff)
            if handoff["output"]["mode"] == "callback":
                callback = tool_runner.create_callback({"reason": "Human agent requested during live call", "priority": "high"})
                tools.append(callback)
                events.append({"type": "callback.created", "call_id": call.id, "callback_id": callback["output"]["callback_id"]})
                ai_message = self._respond(
                    "Customer asked for a human agent but no agent is available. Created a high-priority callback. "
                    "Apologise for the wait and confirm the callback has been scheduled.",
                    "No live agent is free right now, so I created a high-priority callback for the next available specialist.",
                    call.language,
                )
            else:
                events.append({"type": "handoff.requested", "call_id": call.id, "mode": handoff["output"]["mode"]})
                events.append({"type": "handoff.accepted", "call_id": call.id, "mode": handoff["output"]["mode"]})
                ai_message = self._respond(
                    "Customer requested a live human agent. Connecting them to a specialist now.",
                    "I am bringing a human support specialist into this conversation now.",
                    call.language,
                )
        elif call.intent == "callback_request":
            callback = tool_runner.create_callback({"reason": text, "priority": "medium"})
            tools.append(callback)
            call.session_state = "callback"
            call.disposition = "callback"
            call.resolution_status = "callback_pending"
            events.append({"type": "callback.created", "call_id": call.id, "callback_id": callback["output"]["callback_id"]})
            ai_message = self._respond(
                "Customer requested a callback. Callback has been created and queued. Confirm warmly.",
                "I have created a callback request for the next available specialist.",
                call.language,
            )
        elif call.intent == "new_complaint":
            if call.sentiment == "angry":
                handoff = tool_runner.request_handoff({"reason": "Angry customer requires live intervention", "explicit_human_request": False, "high_risk": True})
                tools.append(handoff)
                if handoff["output"]["mode"] == "live":
                    events.append({"type": "handoff.requested", "call_id": call.id, "mode": "live"})
                    ai_message = self._respond(
                        "Angry customer has filed a complaint. Escalating immediately to a live supervisor. Acknowledge their frustration empathetically.",
                        "I am escalating this complaint to a live supervisor right away.",
                        call.language,
                    )
                else:
                    callback = tool_runner.create_callback({"reason": "Angry complaint requires supervisor review", "priority": "high"})
                    tools.append(callback)
                    events.append({"type": "callback.created", "call_id": call.id, "callback_id": callback["output"]["callback_id"]})
                    ai_message = self._respond(
                        "Angry customer complaint. No live agent available. Marked high priority. Supervisor callback scheduled. Apologise sincerely.",
                        "I have marked this complaint as high priority and scheduled a supervisor callback.",
                        call.language,
                    )
            else:
                ticket = tool_runner.create_ticket(
                    {
                        "title": "Customer complaint from voice session",
                        "description": text,
                        "priority": "high" if "urgent" in text.lower() else "medium",
                    }
                )
                tools.append(ticket)
                call.session_state = "ticket"
                call.disposition = "ticket_created"
                call.resolution_status = "ticket_open"
                ref = ticket["output"]["ticket_id"][:8].upper()
                ai_message = self._respond(
                    f"Complaint registered. Support ticket created with reference {ref}. Acknowledge the issue and give them the reference number.",
                    f"I have created a support ticket for this issue. Your reference is {ref}.",
                    call.language,
                )
        elif call.intent == "case_status":
            case_result = tool_runner.lookup_case({"case_number": extract_case_number(text)})
            tools.append(case_result)
            if case_result["output"]["found"]:
                data = case_result["output"]
                ai_message = self._respond(
                    f"Case status inquiry. Case {data['case_number']} found. Status: {data['status']}. "
                    f"Summary: {data['summary']}. Note: {data['last_updated_note']}. Deliver a clear, complete status update.",
                    f"Your case {data['case_number']} is currently {data['status']}. {data['summary']} {data['last_updated_note']}",
                    call.language,
                )
                call.session_state = "resolved"
                call.disposition = "resolved"
                call.resolution_status = "resolved"
            else:
                ai_message = self._respond(
                    "Customer asked for case status but the case number was not found in the system. "
                    "Apologise and offer a callback or to connect them to a specialist.",
                    "I could not find that case number in the approved system yet. I can arrange a callback or connect you to a specialist.",
                    call.language,
                )
        elif call.intent == "unknown_needs_clarification" and call.confidence < low_confidence_threshold:
            if call.session_state == "intent_captured":
                handoff = tool_runner.request_handoff(
                    {
                        "reason": "Low confidence after clarification attempt",
                        "explicit_human_request": False,
                        "high_risk": False,
                        "low_confidence": True,
                    }
                )
                tools.append(handoff)
                if handoff["output"]["mode"] == "callback":
                    callback = tool_runner.create_callback({"reason": "Low confidence after clarification attempt", "priority": "medium"})
                    tools.append(callback)
                    events.append({"type": "callback.created", "call_id": call.id, "callback_id": callback["output"]["callback_id"]})
                    ai_message = self._respond(
                        "Could not understand the customer's request after clarification. Created a callback with a human specialist. Explain this will ensure they get accurate help.",
                        "I still want to be accurate, so I created a callback with a human specialist to continue this request.",
                        call.language,
                    )
                elif handoff["output"]["mode"] == "live":
                    events.append({"type": "handoff.requested", "call_id": call.id, "mode": "live"})
                    events.append({"type": "handoff.accepted", "call_id": call.id, "mode": "live"})
                    ai_message = self._respond(
                        "Could not understand the customer's request. Transferring to a human specialist to ensure they get the right help.",
                        "I want to make sure you get the right help, so I am bringing in a human support specialist now.",
                        call.language,
                    )
                else:
                    ai_message = self._respond(
                        "Still cannot understand the request. Ask again very clearly: is it about a case status, a complaint, a callback, or a human agent?",
                        "I want to make sure I understood correctly. Please tell me if this is about a case status, a complaint, or a callback request.",
                        call.language,
                    )
            else:
                call.session_state = "intent_captured"
                ai_message = self._respond(
                    "Could not understand the customer's intent. Ask them to clarify: case status, complaint, callback, or speak to a human agent?",
                    "I want to make sure I understood correctly. Is this about a case status, a complaint, a callback, or speaking to a human agent?",
                    call.language,
                )
        else:
            if should_use_knowledge(program, call.intent, call.confidence):
                knowledge = tool_runner.search_knowledge({"query": text})
                tools.append(knowledge)
                kb_answer = knowledge["output"].get("answer", "")
                if kb_answer and "could not find" not in kb_answer.lower():
                    ai_message = self._respond(
                        f"Answer from knowledge base: {kb_answer}. Deliver this answer naturally and helpfully.",
                        kb_answer,
                        call.language,
                    )
                else:
                    ai_message = self._respond(
                        "No verified answer found in the knowledge base for this query. Offer to connect the customer to a specialist.",
                        "I could not find a verified answer yet, so I can connect you to a specialist.",
                        call.language,
                    )
            else:
                ai_message = self._respond(
                    "This request is not approved for KB answering yet or confidence is too low. Clarify the request and offer a human transfer if needed.",
                    "I want to make sure I help correctly. Could you clarify your request, or I can connect you to a specialist if needed?",
                    call.language,
                )
            call.session_state = "answer_or_tool_action" if call.intent != "unknown_needs_clarification" else "intent_captured"
            call.disposition = "resolved" if call.intent == "faq_answer" and should_use_knowledge(program, call.intent, call.confidence) else call.disposition
            if call.intent == "faq_answer" and should_use_knowledge(program, call.intent, call.confidence):
                call.resolution_status = "resolved"

        ai_turn = CallTurn(
            call_id=call.id,
            organization_id=call.organization_id,
            client_program_id=call.client_program_id,
            speaker="ai",
            message=ai_message,
            language=call.language,
            event_type="assistant_response",
            confidence=call.confidence,
        )
        db.add(ai_turn)

        summary = make_summary(call, text, ai_message)
        tools.append(tool_runner.log_summary({"summary": summary}))
        call.summary = summary

        if call.session_state == "resolved":
            call.session_state = "summary"

        return SessionOutcome(ai_message=ai_message, events=events, tools=tools)


async def emit_events(call_id: str, events: list[dict[str, Any]]) -> None:
    for event in events:
        await event_hub.publish(call_id, event)


def store_audit_log(db: Session, actor_type: str, actor_id: str, action: str, entity_type: str, entity_id: str, organization_id: str, client_program_id: str | None = None, details: dict[str, Any] | None = None) -> None:
    db.add(
        AuditLog(
            organization_id=organization_id,
            client_program_id=client_program_id,
            actor_type=actor_type,
            actor_id=actor_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            details=details or {},
        )
    )


def _ensure_aware(dt: datetime | None) -> datetime | None:
    """Ensure a datetime is timezone-aware (assume UTC if naive)."""
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def build_analytics_snapshot(db: Session, organization_id: str, client_program_id: str | None = None) -> dict[str, Any]:
    # Date boundaries (UTC midnight)
    now = datetime.now(timezone.utc)
    today_start     = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    filters = [Call.organization_id == organization_id]
    ticket_filters = [Ticket.organization_id == organization_id]
    callback_filters = [CallbackTask.organization_id == organization_id]
    qa_filters = [QAReview.organization_id == organization_id]
    if client_program_id:
        filters.append(Call.client_program_id == client_program_id)
        ticket_filters.append(Ticket.client_program_id == client_program_id)
        callback_filters.append(CallbackTask.client_program_id == client_program_id)
        qa_filters.append(QAReview.client_program_id == client_program_id)

    calls     = db.scalars(select(Call).where(*filters)).all()
    tickets   = db.scalars(select(Ticket).where(*ticket_filters)).all()
    callbacks = db.scalars(select(CallbackTask).where(*callback_filters)).all()
    qa_reviews = db.scalars(select(QAReview).where(*qa_filters)).all()

    # Split calls into today / yesterday buckets by started_at
    def _started(c: Call) -> datetime | None:
        return _ensure_aware(c.started_at)  # type: ignore[arg-type]

    today_calls     = [c for c in calls if (s := _started(c)) is not None and s >= today_start]
    yesterday_calls = [c for c in calls if (s := _started(c)) is not None and yesterday_start <= s < today_start]

    live_calls          = sum(1 for c in calls if c.status == "active")
    queue_depth         = sum(1 for c in calls if c.status == "active")
    resolved_today      = sum(1 for c in today_calls     if c.disposition == "resolved")
    resolved_yesterday  = sum(1 for c in yesterday_calls if c.disposition == "resolved")
    escalations_today   = sum(1 for c in today_calls     if c.disposition == "escalated")
    escalations_yesterday = sum(1 for c in yesterday_calls if c.disposition == "escalated")

    # QA pending = reviews not yet completed
    qa_pending = sum(1 for r in qa_reviews if r.status in ("pending", "new"))

    # Average handle time from today's completed calls only
    completed_today = [c for c in today_calls if _ensure_aware(c.ended_at) and _ensure_aware(c.started_at)]
    if completed_today:
        avg_seconds = sum(
            (_ensure_aware(c.ended_at) - _ensure_aware(c.started_at)).total_seconds()  # type: ignore[operator]
            for c in completed_today
        ) / len(completed_today)
        avg_handle_time = f"{int(avg_seconds // 60)}:{int(avg_seconds % 60):02d}"
    else:
        avg_handle_time = "0:00"

    # CSAT derived from reviewed QA scores (scale 0–100 → 0–5)
    scored = [r.score for r in qa_reviews if r.score is not None]
    csat_score = round(sum(scored) / len(scored) / 20, 2) if scored else 0.0

    # Top intents across ALL calls (lifetime view shows full distribution)
    intent_counter = Counter(c.intent for c in calls if c.intent)
    total_calls_count = max(len(calls), 1)
    top_intents = [
        {"intent": intent, "count": count, "share": round((count / total_calls_count) * 100, 1)}
        for intent, count in intent_counter.most_common(5)
    ]

    # Dispositions from today's calls only (matches "Today" label in UI)
    disposition_color_map = {
        "resolved": "#0f7b77",
        "callback": "#6366f1",
        "escalated": "#bb5f33",
        "ticket":   "#f59e0b",
        "open":     "#94a3b8",
    }
    disposition_order = ["resolved", "callback", "escalated", "ticket", "open"]
    disposition_counter = Counter(c.disposition for c in today_calls if c.disposition)
    dispositions = [
        {"label": key.capitalize(), "count": disposition_counter[key], "color": disposition_color_map[key]}
        for key in disposition_order if key in disposition_counter
    ]

    sentiment_counter = Counter(c.sentiment for c in calls if c.sentiment)
    sentiment_mix = [{"label": key, "count": value} for key, value in sentiment_counter.items()]

    return {
        "live_calls":             live_calls,
        "queue_depth":            queue_depth,
        "resolved_today":         resolved_today,
        "resolved_yesterday":     resolved_yesterday,
        "callbacks_pending":      sum(1 for t in callbacks if t.status == "pending"),
        "escalations_today":      escalations_today,
        "escalations_yesterday":  escalations_yesterday,
        "tickets_open":           sum(1 for t in tickets if t.status == "open"),
        "qa_pending":             qa_pending,
        "avg_handle_time":        avg_handle_time,
        "csat_score":             csat_score,
        "top_intents":            top_intents,
        "dispositions":           dispositions,
        "sentiment_mix":          sentiment_mix,
    }
