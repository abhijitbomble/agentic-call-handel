# Voice Worker Placeholder

This directory reserves the self-hosted voice worker boundary from the original plan.

For the current implementation pass:

- Browser channel orchestration lives in the FastAPI control plane.
- Adapter seams are already in `apps/api/app/services.py`.
- LiveKit, faster-whisper, Piper, and local LLM workers can be attached here later without changing the dashboard or session state machine.

