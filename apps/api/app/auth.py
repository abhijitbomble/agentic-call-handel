from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import StaffMembership, StaffUser

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), b"voiceops-salt", 200_000)
    return digest.hex()


def verify_password(password: str, password_hash: str) -> bool:
    candidate = hash_password(password)
    return hmac.compare_digest(candidate, password_hash)


def create_access_token(payload: dict) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    body = {**payload, "exp": expires}
    return jwt.encode(body, settings.secret_key, algorithm="HS256")


@dataclass(slots=True)
class AuthContext:
    user: StaffUser
    membership: StaffMembership


def get_current_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> AuthContext:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    settings = get_settings()
    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc
    membership = db.get(StaffMembership, payload.get("membership_id"))
    user = db.get(StaffUser, payload.get("sub"))
    if membership is None or user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session is no longer valid")
    return AuthContext(user=user, membership=membership)


def require_roles(*allowed: str):
    def dependency(ctx: AuthContext = Depends(get_current_context)) -> AuthContext:
        if ctx.membership.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return ctx

    return dependency


def load_user_with_memberships(db: Session, username: str) -> StaffUser | None:
    stmt = select(StaffUser).where(StaffUser.username == username)
    return db.scalar(stmt)

