from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ClientProgram


def test_verification_gating_requires_customer_confirmation(client: TestClient, auth_headers: dict[str, str]) -> None:
    programs = client.get("/programs", headers=auth_headers).json()
    queues = client.get("/queues", headers=auth_headers).json()
    response = client.post(
        "/voice/sessions",
        headers=auth_headers,
        json={
            "organization_id": programs[0]["organization_id"],
            "client_program_id": programs[0]["id"],
            "queue_id": queues[0]["id"],
            "customer_phone": "+919876543210",
            "preferred_language": "English",
        },
    )
    call_id = response.json()["call"]["id"]

    turn = client.post(
        f"/voice/sessions/{call_id}/turns",
        headers=auth_headers,
        json={"message": "I want the status of claim CLM-9001"},
    )
    body = turn.json()
    assert body["call"]["verification_state"] == "pending"
    assert "please confirm" in body["latest_turn"]["message"].lower()


def test_three_failed_verifications_fall_back_to_human_or_callback(client: TestClient, auth_headers: dict[str, str]) -> None:
    programs = client.get("/programs", headers=auth_headers).json()
    queues = client.get("/queues", headers=auth_headers).json()
    call = client.post(
        "/voice/sessions",
        headers=auth_headers,
        json={
            "organization_id": programs[0]["organization_id"],
            "client_program_id": programs[0]["id"],
            "queue_id": queues[0]["id"],
            "customer_phone": "+919876543210",
        },
    ).json()["call"]
    for _ in range(3):
        result = client.post(
            f"/voice/sessions/{call['id']}/turns",
            headers=auth_headers,
            json={"message": "claim CLM-9001 and my code is wrong"},
        ).json()
    assert result["call"]["failed_verification_attempts"] >= 3
    assert result["call"]["handoff_mode"] in {"live", "callback"}
    assert "human" in result["latest_turn"]["message"].lower() or "callback" in result["latest_turn"]["message"].lower()


def test_program_verification_policy_can_skip_case_status_verification(
    client: TestClient,
    auth_headers: dict[str, str],
    db_session: Session,
) -> None:
    program = db_session.scalar(select(ClientProgram).where(ClientProgram.slug == "acme-insurance"))
    assert program is not None
    program.verification_policy = {"required_for": [], "allowed_identifiers": ["customer_code"]}
    db_session.commit()

    queues = client.get("/queues", headers=auth_headers).json()
    call_id = client.post(
        "/voice/sessions",
        headers=auth_headers,
        json={
            "organization_id": program.organization_id,
            "client_program_id": program.id,
            "queue_id": queues[0]["id"],
            "customer_phone": "+919876543210",
            "preferred_language": "English",
        },
    ).json()["call"]["id"]

    turn = client.post(
        f"/voice/sessions/{call_id}/turns",
        headers=auth_headers,
        json={"message": "I want the status of claim CLM-9001"},
    ).json()

    assert turn["call"]["verification_state"] == "not_required"
    assert "under review" in turn["latest_turn"]["message"].lower()


def test_low_confidence_path_clarifies_then_escalates(client: TestClient, auth_headers: dict[str, str]) -> None:
    programs = client.get("/programs", headers=auth_headers).json()
    queues = client.get("/queues", headers=auth_headers).json()
    call = client.post(
        "/voice/sessions",
        headers=auth_headers,
        json={
            "organization_id": programs[0]["organization_id"],
            "client_program_id": programs[0]["id"],
            "queue_id": queues[0]["id"],
            "customer_phone": "+919876543210",
        },
    ).json()["call"]

    first_turn = client.post(
        f"/voice/sessions/{call['id']}/turns",
        headers=auth_headers,
        json={"message": "Can you help me?"},
    ).json()
    assert "understood correctly" in first_turn["latest_turn"]["message"].lower()
    assert first_turn["call"]["session_state"] == "intent_captured"

    second_turn = client.post(
        f"/voice/sessions/{call['id']}/turns",
        headers=auth_headers,
        json={"message": "I still need help"},
    ).json()
    assert second_turn["call"]["handoff_mode"] in {"live", "callback"}
    assert "human" in second_turn["latest_turn"]["message"].lower() or "callback" in second_turn["latest_turn"]["message"].lower()
