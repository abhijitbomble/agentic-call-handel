from __future__ import annotations

import threading
from typing import Any

from app.agents import AGENT_PERSONAS, AgentWorker
from app.config import get_settings


class _AgentSlot:
    """A single agent in the pool — wraps an AgentWorker with runtime state."""

    def __init__(self, persona: dict[str, str], api_key: str) -> None:
        self.persona = persona
        self.worker = AgentWorker(persona, api_key)
        self.status: str = "idle"          # idle | busy | escalated
        self.current_call_id: str | None = None
        self.calls_handled_today: int = 0
        self.escalations_today: int = 0

    def to_dict(self) -> dict:
        return {
            "id": self.persona["id"],
            "name": self.persona["name"],
            "language": self.persona["language"],
            "style": self.persona["style"],
            "status": self.status,
            "current_call_id": self.current_call_id,
            "calls_handled_today": self.calls_handled_today,
            "escalations_today": self.escalations_today,
        }


class AgentPool:
    """
    Thread-safe pool of AgentWorkers.

    Incoming calls are matched to an idle agent — language-preferred first,
    then any available. Call assign/release operations are O(n) but n=6 so
    a simple lock + list is fine.
    """

    def __init__(self) -> None:
        settings = get_settings()
        api_key = getattr(settings, "anthropic_api_key", "")
        self._lock = threading.Lock()
        self._slots: list[_AgentSlot] = [
            _AgentSlot(persona, api_key) for persona in AGENT_PERSONAS
        ]
        # call_id → slot index, for fast lookup during turns
        self._call_to_slot: dict[str, int] = {}

    # ── Public API ─────────────────────────────────────────────────────────

    def assign_call(self, call_id: str, preferred_language: str = "English") -> dict | None:
        """
        Mark the best idle agent as busy for this call.
        Returns the agent snapshot dict, or None if all agents are busy.
        """
        with self._lock:
            # Language-preferred first
            for i, slot in enumerate(self._slots):
                if slot.status == "idle" and slot.persona["language"].lower() == preferred_language.lower():
                    return self._assign(i, call_id)
            # Any idle
            for i, slot in enumerate(self._slots):
                if slot.status == "idle":
                    return self._assign(i, call_id)
        return None

    def release_call(self, call_id: str) -> None:
        with self._lock:
            idx = self._call_to_slot.pop(call_id, None)
            if idx is not None:
                slot = self._slots[idx]
                slot.calls_handled_today += 1
                slot.status = "idle"
                slot.current_call_id = None

    def mark_escalation(self, call_id: str) -> None:
        with self._lock:
            idx = self._call_to_slot.get(call_id)
            if idx is not None:
                slot = self._slots[idx]
                slot.escalations_today += 1
                slot.status = "escalated"
                slot.current_call_id = None
                self._call_to_slot.pop(call_id, None)

    def get_worker(self, call_id: str) -> AgentWorker | None:
        with self._lock:
            idx = self._call_to_slot.get(call_id)
            if idx is not None:
                return self._slots[idx].worker
        return None

    def get_agent_info(self, call_id: str) -> dict | None:
        with self._lock:
            idx = self._call_to_slot.get(call_id)
            if idx is not None:
                return self._slots[idx].to_dict()
        return None

    def squad_status(self) -> list[dict]:
        with self._lock:
            return [slot.to_dict() for slot in self._slots]

    def available_count(self) -> int:
        with self._lock:
            return sum(1 for slot in self._slots if slot.status == "idle")

    def reset_daily_stats(self) -> None:
        with self._lock:
            for slot in self._slots:
                slot.calls_handled_today = 0
                slot.escalations_today = 0

    # ── Private ────────────────────────────────────────────────────────────

    def _assign(self, idx: int, call_id: str) -> dict:
        slot = self._slots[idx]
        slot.status = "busy"
        slot.current_call_id = call_id
        self._call_to_slot[call_id] = idx
        return slot.to_dict()


# Singleton — imported by main.py
agent_pool = AgentPool()
