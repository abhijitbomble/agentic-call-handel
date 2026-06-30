from __future__ import annotations

import asyncio
import base64
import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from uuid import uuid4

import httpx
import websockets
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import Call, CallTurn, ClientProgram, Queue
from app.services import SessionEngine, emit_events

logger = logging.getLogger(__name__)


def _terminal_closing(language: str) -> str:
    return " Thank you for calling. Goodbye." if language == "English" else " Dhanyavaad. Namaste."


class TwilioMediaBridge:
    def __init__(self, websocket: WebSocket, queue_id: str, session_engine: SessionEngine) -> None:
        self.websocket = websocket
        self.queue_id = queue_id
        self.session_engine = session_engine
        self.settings = get_settings()
        self.db: Session | None = None
        self.call: Call | None = None
        self.queue: Queue | None = None
        self.program: ClientProgram | None = None
        self.call_id: str | None = None
        self.call_sid: str | None = None
        self.stream_sid: str | None = None
        self.deepgram_ws: Any | None = None
        self.deepgram_task: asyncio.Task[None] | None = None
        self.turn_task: asyncio.Task[None] | None = None
        self.turn_queue: asyncio.Queue[str | None] = asyncio.Queue()
        self.final_fragments: list[str] = []
        self.last_interim_text = ""
        self.pending_marks: set[str] = set()
        self.ai_playing = False
        self.close_after_playback = False
        self.reply_token = 0

    async def run(self) -> None:
        await self.websocket.accept()
        self.db = SessionLocal()
        self.turn_task = asyncio.create_task(self._process_turns())
        try:
            await self._consume_twilio()
        except WebSocketDisconnect:
            logger.info("Twilio media websocket disconnected for queue=%s call_id=%s", self.queue_id, self.call_id)
        finally:
            await self._shutdown()

    async def _consume_twilio(self) -> None:
        while True:
            raw = await self.websocket.receive_text()
            payload = json.loads(raw)
            event = payload.get("event")

            if event == "start":
                await self._handle_start(payload.get("start", {}))
            elif event == "media":
                await self._handle_media(payload.get("media", {}))
            elif event == "mark":
                await self._handle_mark(payload.get("mark", {}))
            elif event == "stop":
                break

    async def _emit_live_event(self, event_type: str, **payload: Any) -> None:
        if not self.call_id:
            return
        await emit_events(self.call_id, [{"type": event_type, "call_id": self.call_id, **payload}])

    async def _handle_start(self, start: dict[str, Any]) -> None:
        custom = start.get("customParameters") or {}
        self.call_id = custom.get("call_id")
        self.call_sid = start.get("callSid")
        self.stream_sid = start.get("streamSid")

        if not self.call_id or self.stream_sid is None:
            logger.warning("Twilio stream started without call_id or stream_sid")
            await self.websocket.close()
            return

        if self.db is None:
            await self.websocket.close()
            return

        call = self.db.get(Call, self.call_id)
        if call is None or call.queue_id != self.queue_id:
            logger.warning("Twilio stream could not load call=%s queue=%s", self.call_id, self.queue_id)
            await self.websocket.close()
            return

        queue = self.db.get(Queue, call.queue_id)
        program = self.db.get(ClientProgram, call.client_program_id)
        if queue is None or program is None:
            logger.warning("Twilio stream missing queue/program for call=%s", self.call_id)
            await self.websocket.close()
            return

        self.call = call
        self.queue = queue
        self.program = program

        await self._connect_deepgram()

        opening_turn = self.db.query(CallTurn).filter(CallTurn.call_id == call.id, CallTurn.speaker == "ai").order_by(CallTurn.created_at.desc()).first()
        opening_text = opening_turn.message if opening_turn else ""
        if opening_text:
            await self._send_ai_message(opening_text, call.language, terminal=False, token=self.reply_token)

    async def _handle_media(self, media: dict[str, Any]) -> None:
        payload = media.get("payload")
        if not payload or self.deepgram_ws is None:
            return
        try:
            audio = base64.b64decode(payload)
            await self.deepgram_ws.send(audio)
        except Exception as exc:
            logger.warning("Failed to forward Twilio audio to Deepgram: %s", exc)

    async def _handle_mark(self, mark: dict[str, Any]) -> None:
        name = mark.get("name")
        if name:
            self.pending_marks.discard(name)
        if not self.pending_marks:
            if self.ai_playing:
                await self._emit_live_event("speech.ended", speaker="ai")
            self.ai_playing = False
            if self.close_after_playback:
                await self.websocket.close()

    async def _connect_deepgram(self) -> None:
        if not self.settings.deepgram_api_key:
            raise RuntimeError("VOICEOPS_DEEPGRAM_API_KEY is not configured")

        params = urlencode(
            {
                "model": self.settings.deepgram_stt_model,
                "language": "multi",
                "encoding": "mulaw",
                "sample_rate": "8000",
                "channels": "1",
                "interim_results": "true",
                "vad_events": "true",
                "utterance_end_ms": "1000",
                "endpointing": "300",
                "smart_format": "true",
            }
        )
        url = f"wss://api.deepgram.com/v1/listen?{params}"
        self.deepgram_ws = await websockets.connect(
            url,
            additional_headers={"Authorization": f"Token {self.settings.deepgram_api_key}"},
            max_size=8 * 1024 * 1024,
            ping_interval=20,
            ping_timeout=20,
        )
        self.deepgram_task = asyncio.create_task(self._consume_deepgram())

    async def _consume_deepgram(self) -> None:
        if self.deepgram_ws is None:
            return
        try:
            async for message in self.deepgram_ws:
                if isinstance(message, bytes):
                    continue
                payload = json.loads(message)
                msg_type = payload.get("type")

                if msg_type == "SpeechStarted":
                    self.last_interim_text = ""
                    await self._interrupt_playback()
                    await self._emit_live_event("speech.started", speaker="customer")
                    continue

                if msg_type == "UtteranceEnd":
                    transcript = " ".join(self.final_fragments).strip()
                    self.final_fragments.clear()
                    if transcript:
                        await self._emit_live_event("speech.ended", speaker="customer")
                        await self.turn_queue.put(transcript)
                    continue

                if msg_type != "Results":
                    if msg_type == "Error":
                        logger.warning("Deepgram error for call=%s: %s", self.call_id, payload)
                    continue

                alt = (((payload.get("channel") or {}).get("alternatives") or [{}])[0].get("transcript") or "").strip()
                is_final = bool(payload.get("is_final"))
                speech_final = bool(payload.get("speech_final"))

                if alt and not is_final and self.ai_playing:
                    await self._interrupt_playback()

                if alt and not is_final and alt != self.last_interim_text:
                    self.last_interim_text = alt
                    await self._emit_live_event("transcript.interim", speaker="customer", message=alt)

                if alt and is_final:
                    self.final_fragments.append(alt)

                if speech_final:
                    transcript = " ".join(self.final_fragments).strip() or alt
                    self.final_fragments.clear()
                    if transcript:
                        await self._emit_live_event("speech.ended", speaker="customer")
                        await self.turn_queue.put(transcript)
        except Exception as exc:
            logger.warning("Deepgram stream ended for call=%s: %s", self.call_id, exc)

    async def _interrupt_playback(self) -> None:
        self.reply_token += 1
        self.close_after_playback = False
        if not self.ai_playing or self.stream_sid is None:
            return
        self.pending_marks.clear()
        self.ai_playing = False
        await self.websocket.send_text(json.dumps({"event": "clear", "streamSid": self.stream_sid}))
        await self._emit_live_event("speech.ended", speaker="ai")

    async def _process_turns(self) -> None:
        while True:
            transcript = await self.turn_queue.get()
            if transcript is None:
                return
            if self.db is None or self.call is None or self.queue is None or self.program is None:
                continue

            token = self.reply_token
            try:
                outcome = self._process_turn_sync(transcript)
            except Exception as exc:
                logger.exception("SessionEngine processing failed for call=%s: %s", self.call_id, exc)
                await self._send_ai_message(
                    "I am sorry, something went wrong on my side. Please try again in a moment.",
                    self.call.language if self.call else "English",
                    terminal=True,
                    token=self.reply_token,
                )
                continue

            if outcome.events:
                await emit_events(self.call.id, outcome.events)

            if self.call is None:
                continue

            text = outcome.ai_message
            terminal = False

            if self.call.disposition == "escalated" and self.call.handoff_mode == "live":
                terminal = True
            elif self.call.session_state == "callback" or self.call.disposition == "callback":
                terminal = True
            elif self.call.session_state in {"resolved", "closed", "summary"} or self.call.disposition == "resolved":
                text = outcome.ai_message + _terminal_closing(self.call.language)
                terminal = True

            try:
                await self._send_ai_message(text, self.call.language, terminal=terminal, token=token)
            except Exception as exc:
                logger.exception("Failed to stream AI audio for call=%s: %s", self.call_id, exc)

    def _process_turn_sync(self, transcript: str):
        assert self.db is not None
        assert self.call is not None
        assert self.queue is not None
        assert self.program is not None

        self.db.expire_all()
        call = self.db.get(Call, self.call.id)
        program = self.db.get(ClientProgram, self.program.id)
        queue = self.db.get(Queue, self.queue.id)
        if call is None or program is None or queue is None:
            raise RuntimeError("Call context disappeared during processing")

        outcome = self.session_engine.process_turn(self.db, call, program, queue, transcript)
        self.db.commit()
        self.db.refresh(call)
        self.call = call
        self.program = program
        self.queue = queue
        return outcome

    async def _send_ai_message(self, text: str, language: str, terminal: bool, token: int) -> None:
        if not text or self.stream_sid is None:
            return

        audio = await self._synthesize_speech(text, language)
        if token != self.reply_token or not audio:
            return

        mark_name = f"ai-{uuid4().hex[:10]}"
        self.pending_marks.add(mark_name)
        self.ai_playing = True
        self.close_after_playback = terminal
        await self._emit_live_event("speech.started", speaker="ai")

        await self.websocket.send_text(
            json.dumps(
                {
                    "event": "media",
                    "streamSid": self.stream_sid,
                    "media": {"payload": base64.b64encode(audio).decode("ascii")},
                }
            )
        )
        await self.websocket.send_text(
            json.dumps(
                {
                    "event": "mark",
                    "streamSid": self.stream_sid,
                    "mark": {"name": mark_name},
                }
            )
        )

    async def _synthesize_speech(self, text: str, language: str) -> bytes:
        model = self.settings.deepgram_tts_model
        if language == "Hindi":
            logger.info("Deepgram TTS does not have a dedicated Hindi voice configured; using %s as fallback", model)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"https://api.deepgram.com/v1/speak?model={model}&encoding=mulaw&sample_rate=8000&container=none",
                headers={
                    "Authorization": f"Token {self.settings.deepgram_api_key}",
                    "Content-Type": "application/json",
                },
                json={"text": text},
            )
            response.raise_for_status()
            return response.content

    async def _shutdown(self) -> None:
        try:
            await self.turn_queue.put(None)
        except Exception:
            pass

        if self.deepgram_ws is not None:
            try:
                await self.deepgram_ws.close()
            except Exception:
                pass

        if self.deepgram_task is not None:
            self.deepgram_task.cancel()
            try:
                await self.deepgram_task
            except BaseException:
                pass

        if self.turn_task is not None:
            self.turn_task.cancel()
            try:
                await self.turn_task
            except BaseException:
                pass

        if self.db is not None and self.call is not None:
            try:
                live_handoff = self.call.disposition == "escalated" and self.call.handoff_mode == "live"
                if self.call.status == "active" and not live_handoff and self.call.session_state not in {"closed"}:
                    self.call.status = "completed"
                    self.call.session_state = "closed"
                    self.call.ended_at = datetime.now(timezone.utc)
                    self.db.commit()
            except Exception:
                self.db.rollback()
            finally:
                self.db.close()
        elif self.db is not None:
            self.db.close()


async def run_twilio_media_bridge(websocket: WebSocket, queue_id: str, session_engine: SessionEngine) -> None:
    bridge = TwilioMediaBridge(websocket, queue_id, session_engine)
    await bridge.run()
