from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ── Personas ──────────────────────────────────────────────────────────────────
# Each persona is a named agent with a distinct communication style.
# The name and style shape how Claude responds — the customer gets a consistent
# "person" throughout their call.

AGENT_PERSONAS: list[dict[str, str]] = [
    {"id": "agent-priya",  "name": "Priya",  "language": "Hindi",   "style": "warm, patient, speaks Hindi and English naturally"},
    {"id": "agent-rahul",  "name": "Rahul",  "language": "English", "style": "professional, efficient, direct"},
    {"id": "agent-neha",   "name": "Neha",   "language": "Hindi",   "style": "empathetic, thorough, calm under pressure"},
    {"id": "agent-vikram", "name": "Vikram", "language": "English", "style": "knowledgeable, reassuring, detail-oriented"},
    {"id": "agent-sunita", "name": "Sunita", "language": "Hindi",   "style": "de-escalating, clear, solution-focused"},
    {"id": "agent-arjun",  "name": "Arjun",  "language": "English", "style": "precise, friendly, gets to the point quickly"},
]

_AGENT_SYSTEM = """\
You are {name}, a customer support specialist handling this call completely and independently.
Your style: {style}
Speak in: {language}

YOUR RESPONSIBILITY:
Handle this call from start to finish by yourself. You have tools to:
- Verify the customer's identity before sharing any account information
- Look up their case or claim status
- Search approved policy answers
- Register complaints as tickets
- Schedule callbacks
- Escalate to a senior agent (only when genuinely necessary)

HOW TO BEHAVE:
- Talk like a real person, not a bot. Use "I", not "the system".
- If speaking Hindi, use natural Hinglish or Devanagari as the customer prefers.
- Be warm and efficient. Do not repeat yourself.
- Once identity is verified in this call, do not ask again.
- If the customer asks multiple questions, handle all of them before ending.
- Use tools to get real data. Never invent case numbers, statuses, or policy rules.
- After a tool returns data, explain it to the customer naturally in 1-2 sentences.

ESCALATE ONLY WHEN:
- Customer has explicitly asked for a human 2+ times AND you have no remaining options, OR
- The issue requires a manager decision you are not authorized to make (exception approvals, legal complaints)

PROGRAM CONTEXT:
{program_context}

CUSTOMER CONTEXT:
{customer_context}

CALL SO FAR:
{call_history}

Respond naturally to the customer's message. Use a tool if you need real information first.
Return only what you would say aloud to the customer."""

# ── Tool definitions (sent to Claude) ────────────────────────────────────────

AGENT_TOOLS: list[dict[str, Any]] = [
    {
        "name": "verify_customer_identity",
        "description": "Verify the customer is who they claim to be using an identifier they provide. Always call this before sharing any account or case details.",
        "input_schema": {
            "type": "object",
            "properties": {
                "identifier_type": {
                    "type": "string",
                    "enum": ["last4_phone", "date_of_birth", "customer_code"],
                    "description": "The type of identifier the customer provided"
                },
                "value": {
                    "type": "string",
                    "description": "The exact value the customer gave, e.g. '7890' for last 4 of phone"
                }
            },
            "required": ["identifier_type", "value"]
        }
    },
    {
        "name": "lookup_case_status",
        "description": "Look up a customer's case or claim. Only call after identity is verified.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Case number like CLM-9001, or 'latest' for most recent case"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "search_knowledge_base",
        "description": "Search the approved knowledge base for answers to policy, product, or procedure questions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The customer's question to search for"
                }
            },
            "required": ["question"]
        }
    },
    {
        "name": "create_complaint_ticket",
        "description": "Register a formal complaint and create a support ticket. Use when customer reports a problem or requests formal escalation in writing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short title summarising the complaint"},
                "description": {"type": "string", "description": "Full description of the issue"},
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "urgent"],
                    "description": "Severity of the complaint"
                }
            },
            "required": ["title", "description", "priority"]
        }
    },
    {
        "name": "schedule_callback",
        "description": "Schedule a callback for the customer at their preferred time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "Why the callback is needed"},
                "preferred_time": {"type": "string", "description": "Customer's preferred time, e.g. 'tomorrow morning', '3 PM today'"}
            },
            "required": ["reason"]
        }
    },
    {
        "name": "escalate_to_senior",
        "description": "Transfer this call to a senior human agent. Use only when you have exhausted all options or the customer repeatedly demands a human.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "Why escalation is needed"}
            },
            "required": ["reason"]
        }
    }
]


# ── AgentWorker ───────────────────────────────────────────────────────────────

class AgentWorker:
    """
    A complete, autonomous customer support agent.
    Handles one call from greeting to resolution using Claude with tools.
    Only escalates to human when it truly cannot help.
    """

    def __init__(self, persona: dict[str, str], api_key: str) -> None:
        self.persona = persona
        self._client: Any = None
        if api_key:
            try:
                from anthropic import Anthropic
                self._client = Anthropic(api_key=api_key)
            except Exception as exc:
                logger.warning("Anthropic unavailable for agent %s: %s", persona["name"], exc)

    # ── Public API ────────────────────────────────────────────────────────────

    def opening_message(self, call: Any, program: Any) -> str:
        """Generate the first thing the agent says when picking up the call."""
        disclosure = ""
        if program:
            disclosure = (
                program.disclosure_template_hi
                if call.language == "Hindi"
                else program.disclosure_template_en
            )
        if self._client is None:
            return self._fallback_opening(call.language, disclosure)
        lang_note = " Respond in Hindi." if call.language == "Hindi" else ""
        try:
            resp = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=220,
                system=f"You are {self.persona['name']}, a customer support agent.{lang_note}",
                messages=[{
                    "role": "user",
                    "content": (
                        f"Generate a warm, natural opening greeting for a support call. "
                        f"Your name is {self.persona['name']}. "
                        f"Include this disclosure naturally: '{disclosure[:300]}'. "
                        f"Keep it under 3 sentences."
                    )
                }]
            )
            return resp.content[0].text.strip()
        except Exception as exc:
            logger.warning("Opening message generation failed: %s", exc)
            return self._fallback_opening(call.language, disclosure)

    def process_turn(
        self,
        db: Session,
        call: Any,
        program: Any,
        message: str,
        transcript: list[Any],
    ) -> dict[str, Any]:
        """
        Process one customer turn.
        Returns: {ai_message, escalated, tool_name, tool_result}
        """
        if self._client is None:
            return self._fallback_turn(call.language)

        system = _AGENT_SYSTEM.format(
            name=self.persona["name"],
            style=self.persona["style"],
            language="Hindi" if call.language == "Hindi" else "English",
            program_context=self._program_ctx(program),
            customer_context=self._customer_ctx(db, call),
            call_history=self._history_ctx(transcript),
        )

        messages = [{"role": "user", "content": message}]
        result: dict[str, Any] = {
            "ai_message": "",
            "escalated": False,
            "tool_name": None,
            "tool_result": None,
        }

        try:
            response = self._client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=system,
                tools=AGENT_TOOLS,
                messages=messages,
            )

            if response.stop_reason == "tool_use":
                tool_block = next(b for b in response.content if b.type == "tool_use")
                tool_data = self._run_tool(db, call, tool_block.name, tool_block.input)

                result["tool_name"] = tool_block.name
                result["tool_result"] = tool_data

                if tool_block.name == "escalate_to_senior":
                    result["escalated"] = True
                    result["ai_message"] = tool_data.get(
                        "message",
                        "Let me connect you with a senior agent right away. Please hold."
                    )
                    return result

                # Send tool result back and get the final spoken response
                messages.append({"role": "assistant", "content": response.content})
                messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_block.id,
                        "content": json.dumps(tool_data),
                    }]
                })
                follow_up = self._client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=512,
                    system=system,
                    tools=AGENT_TOOLS,
                    messages=messages,
                )
                text = next((b for b in follow_up.content if hasattr(b, "text")), None)
                result["ai_message"] = text.text.strip() if text else "I've noted that for you."
            else:
                text = next((b for b in response.content if hasattr(b, "text")), None)
                result["ai_message"] = text.text.strip() if text else "I'm here, please go ahead."

        except Exception as exc:
            logger.warning("Agent %s turn error: %s", self.persona["name"], exc)
            result = self._fallback_turn(call.language)

        return result

    # ── Tool execution ────────────────────────────────────────────────────────

    def _run_tool(self, db: Session, call: Any, name: str, inputs: dict) -> dict:
        runners = {
            "verify_customer_identity": self._tool_verify,
            "lookup_case_status": self._tool_lookup_case,
            "search_knowledge_base": self._tool_search_kb,
            "create_complaint_ticket": self._tool_create_ticket,
            "schedule_callback": self._tool_schedule_callback,
            "escalate_to_senior": lambda db, call, i: {
                "escalated": True,
                "message": "I'm connecting you with a senior agent now. Please hold.",
                "reason": i.get("reason", ""),
            },
        }
        runner = runners.get(name)
        if runner:
            return runner(db, call, inputs)
        return {"error": "unknown tool"}

    def _tool_verify(self, db: Session, call: Any, inputs: dict) -> dict:
        from app.models import Customer
        if not call.customer_id:
            customer = db.scalar(
                select(Customer).where(Customer.phone_number == call.customer_phone)
            )
            if customer:
                call.customer_id = customer.id
                db.flush()
            else:
                return {"verified": False, "reason": "No customer record found for this phone number."}

        customer = db.get(Customer, call.customer_id)
        if not customer:
            return {"verified": False, "reason": "Customer record not found."}

        id_type = inputs.get("identifier_type", "")
        value = inputs.get("value", "").strip()

        matched = (
            (id_type == "last4_phone" and customer.phone_number.endswith(value)) or
            (id_type == "customer_code" and customer.customer_code.lower() == value.lower()) or
            (id_type == "date_of_birth" and len(value) >= 4)
        )

        if matched:
            call.verification_state = "verified"
            db.flush()
            return {"verified": True, "customer_name": customer.full_name}
        else:
            call.failed_verification_attempts = (call.failed_verification_attempts or 0) + 1
            db.flush()
            remaining = max(0, 3 - call.failed_verification_attempts)
            return {
                "verified": False,
                "attempts_used": call.failed_verification_attempts,
                "attempts_remaining": remaining,
            }

    def _tool_lookup_case(self, db: Session, call: Any, inputs: dict) -> dict:
        from app.models import CaseRecord
        if call.verification_state != "verified":
            return {"error": "Identity must be verified before accessing case information."}
        if not call.customer_id:
            return {"error": "No customer linked to this call."}

        query = inputs.get("query", "").strip().upper()
        if query in ("LATEST", ""):
            case = db.scalar(
                select(CaseRecord)
                .where(CaseRecord.customer_id == call.customer_id)
                .order_by(CaseRecord.created_at.desc())
            )
        else:
            case = db.scalar(select(CaseRecord).where(CaseRecord.case_number == query))

        if not case:
            return {"found": False, "message": "No case found for that reference."}
        return {
            "found": True,
            "case_number": case.case_number,
            "case_type": case.case_type,
            "status": case.status,
            "summary": case.summary,
            "last_note": case.last_updated_note,
        }

    def _tool_search_kb(self, db: Session, call: Any, inputs: dict) -> dict:
        from app.models import KnowledgeChunk
        question = inputs.get("question", "").lower()
        words = set(question.split())
        chunks = db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.organization_id == call.organization_id)
            .limit(60)
        ).all()
        best, best_score = None, 0
        for chunk in chunks:
            score = len(words & {k.lower() for k in chunk.keywords})
            if score > best_score:
                best_score = score
                best = chunk
        if best and best_score > 0:
            return {"found": True, "answer": best.content}
        return {"found": False, "message": "No matching information found in knowledge base."}

    def _tool_create_ticket(self, db: Session, call: Any, inputs: dict) -> dict:
        from app.models import Ticket
        ticket = Ticket(
            organization_id=call.organization_id,
            client_program_id=call.client_program_id,
            customer_id=call.customer_id,
            call_id=call.id,
            title=inputs.get("title", "Customer complaint"),
            description=inputs.get("description", ""),
            priority=inputs.get("priority", "medium"),
            status="open",
            created_by="ai",
        )
        db.add(ticket)
        db.flush()
        ref = f"TKT-{ticket.id[:6].upper()}"
        return {"created": True, "reference": ref}

    def _tool_schedule_callback(self, db: Session, call: Any, inputs: dict) -> dict:
        from app.models import CallbackTask
        task = CallbackTask(
            organization_id=call.organization_id,
            client_program_id=call.client_program_id,
            customer_id=call.customer_id,
            call_id=call.id,
            priority="medium",
            reason=inputs.get("reason", "Customer requested callback"),
            scheduled_for_label=inputs.get("preferred_time", "Next available slot"),
            status="pending",
        )
        db.add(task)
        db.flush()
        return {"scheduled": True, "slot": task.scheduled_for_label}

    # ── Context builders ──────────────────────────────────────────────────────

    def _program_ctx(self, program: Any) -> str:
        if not program:
            return "General customer support."
        verify_for = ", ".join(program.verification_policy.get("required_for", [])) or "all queries"
        live_on = ", ".join(program.handoff_policy.get("live_on", [])) or "customer explicit request"
        return (
            f"Program: {program.name}\n"
            f"Verify identity for: {verify_for}\n"
            f"Escalate to human for: {live_on}"
        )

    def _customer_ctx(self, db: Session, call: Any) -> str:
        from app.models import Customer
        if call.customer_id:
            customer = db.get(Customer, call.customer_id)
            if customer:
                return (
                    f"Name: {customer.full_name} | Phone: {customer.phone_number} | "
                    f"VIP: {customer.vip} | Language: {customer.language_preference} | "
                    f"Identity verified: {call.verification_state == 'verified'}"
                )
        return f"Phone: {call.customer_phone} | Identity: not yet verified"

    def _history_ctx(self, transcript: list[Any]) -> str:
        if not transcript:
            return "Call just started."
        lines = []
        for turn in transcript[-12:]:
            label = "You" if turn.speaker == "ai" else "Customer"
            lines.append(f"{label}: {turn.message}")
        return "\n".join(lines)

    # ── Fallbacks ─────────────────────────────────────────────────────────────

    def _fallback_opening(self, language: str, disclosure: str) -> str:
        name = self.persona["name"]
        if disclosure:
            # Disclosure already contains the greeting — just prepend agent name
            if language == "Hindi":
                return f"Main {name} bol rahi/raha hoon. {disclosure}"
            return f"This is {name}. {disclosure}"
        if language == "Hindi":
            return f"Namaste! Main {name} hoon. Aaj main aapki kaise madad kar sakti/sakta hoon?"
        return f"Hello! This is {name}. How can I help you today?"

    def _fallback_turn(self, language: str) -> dict[str, Any]:
        msg = (
            "Kripya ek moment rukein, main aapki baat samajh raha/rahi hoon."
            if language == "Hindi"
            else "Please give me a moment, I'm looking into that for you."
        )
        return {"ai_message": msg, "escalated": False, "tool_name": None, "tool_result": None}
