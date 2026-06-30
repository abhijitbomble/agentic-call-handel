from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt


def browser_identity(username: str, role: str, membership_id: str) -> str:
    raw = f"voiceops-{role}-{username}-{membership_id[:8]}".lower()
    sanitized = re.sub(r"[^a-z0-9_-]", "-", raw).strip("-")
    return (sanitized or f"voiceops-{uuid4().hex[:12]}")[:64]


def create_voice_access_token(
    account_sid: str,
    api_key_sid: str,
    api_key_secret: str,
    twiml_app_sid: str,
    identity: str,
    ttl_seconds: int = 3600,
) -> str:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=ttl_seconds)
    payload = {
        "jti": f"{api_key_sid}-{uuid4().hex}",
        "iss": api_key_sid,
        "sub": account_sid,
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "grants": {
            "identity": identity,
            "voice": {
                "outgoing": {
                    "application_sid": twiml_app_sid,
                }
            },
        },
    }
    headers = {"cty": "twilio-fpa;v=1", "typ": "JWT"}
    return jwt.encode(payload, api_key_secret, algorithm="HS256", headers=headers)
