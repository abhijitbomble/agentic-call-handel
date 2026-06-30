from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import create_access_token
from app.models import ClientProgram, Organization, StaffMembership, StaffUser


def _create_scoped_headers(
    db_session: Session,
    *,
    username: str,
    display_name: str,
    program_slug: str,
    role: str = "agent",
) -> tuple[dict[str, str], StaffMembership]:
    user = StaffUser(username=username, full_name=display_name, password_hash="skip")
    db_session.add(user)
    db_session.flush()

    organization_id = db_session.scalar(select(Organization.id))
    assert organization_id is not None

    program_id = db_session.scalar(select(ClientProgram.id).where(ClientProgram.slug == program_slug))
    assert program_id is not None

    membership = StaffMembership(
        user_id=user.id,
        organization_id=organization_id,
        client_program_id=program_id,
        role=role,
        display_name=display_name,
        languages=["English", "Hindi"],
    )
    db_session.add(membership)
    db_session.commit()

    token = create_access_token(
        {
            "sub": user.id,
            "membership_id": membership.id,
            "role": membership.role,
            "organization_id": membership.organization_id,
            "client_program_id": membership.client_program_id,
        }
    )
    return {"Authorization": f"Bearer {token}"}, membership


def test_program_scoping_blocks_other_program_calls(client: TestClient, db_session: Session) -> None:
    headers, membership = _create_scoped_headers(
        db_session,
        username="hp-agent",
        display_name="HealthPlus Agent",
        program_slug="healthplus",
        role="agent",
    )

    calls = client.get("/calls", headers=headers).json()
    assert all(call["client_program_id"] == membership.client_program_id for call in calls)


def test_program_scoping_blocks_other_program_customer_creation(client: TestClient, db_session: Session) -> None:
    headers, membership = _create_scoped_headers(
        db_session,
        username="hp-supervisor",
        display_name="HealthPlus Supervisor",
        program_slug="healthplus",
        role="supervisor",
    )
    acme_program_id = db_session.scalar(select(ClientProgram.id).where(ClientProgram.slug == "acme-insurance"))
    assert acme_program_id is not None

    create = client.post(
        "/customers",
        headers=headers,
        json={
            "organization_id": membership.organization_id,
            "client_program_id": acme_program_id,
            "full_name": "Cross Program Customer",
            "phone_number": "+919400000003",
            "email": "cross-program@example.com",
            "customer_code": "CUS-9003",
            "language_preference": "English",
            "vip": False,
        },
    )

    assert create.status_code == 403
    assert create.json()["detail"] == "Cannot create a customer for another program"
