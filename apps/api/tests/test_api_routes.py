from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import main as main_module
from app.models import AuditLog, Queue


def test_login_and_program_listing(client: TestClient) -> None:
    login = client.post("/auth/login", json={"username": "supervisor", "password": "voiceops123"})
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    programs = client.get("/programs", headers=headers)
    assert programs.status_code == 200
    assert len(programs.json()) >= 1


def test_ticket_creation(client: TestClient, auth_headers: dict[str, str]) -> None:
    programs = client.get("/programs", headers=auth_headers).json()
    create = client.post(
        "/tickets",
        headers=auth_headers,
        json={
            "organization_id": programs[0]["organization_id"],
            "client_program_id": programs[0]["id"],
            "title": "Need policy clarification",
            "description": "Customer asked for document clarification.",
            "priority": "medium",
        },
    )
    assert create.status_code == 200
    assert create.json()["title"] == "Need policy clarification"


def test_customer_creation_records_audit_log(
    client: TestClient,
    db_session,
    auth_headers: dict[str, str],
) -> None:
    programs = client.get("/programs", headers=auth_headers).json()
    payload = {
        "organization_id": programs[0]["organization_id"],
        "client_program_id": programs[0]["id"],
        "full_name": "Phase One Customer",
        "phone_number": "+919400000001",
        "email": "phase1@example.com",
        "customer_code": "CUS-9001",
        "language_preference": "English",
        "vip": True,
    }

    create = client.post("/customers", headers=auth_headers, json=payload)

    assert create.status_code == 200
    created = create.json()
    assert created["id"]
    assert created["customer_code"] == payload["customer_code"]
    assert created["vip"] is True

    audit_log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "customer_created",
            AuditLog.entity_type == "customer",
            AuditLog.entity_id == created["id"],
        )
    )
    assert audit_log is not None
    assert audit_log.organization_id == payload["organization_id"]
    assert audit_log.client_program_id == payload["client_program_id"]


def test_customer_creation_blocks_other_organization(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    programs = client.get("/programs", headers=auth_headers).json()

    create = client.post(
        "/customers",
        headers=auth_headers,
        json={
            "organization_id": "org-other",
            "client_program_id": programs[0]["id"],
            "full_name": "Wrong Org Customer",
            "phone_number": "+919400000002",
            "email": "wrong-org@example.com",
            "customer_code": "CUS-9002",
            "language_preference": "English",
            "vip": False,
        },
    )

    assert create.status_code == 403
    assert create.json()["detail"] == "Cannot create a customer for another organization"


def test_campaign_endpoints_serialize_after_create(
    client: TestClient,
    auth_headers: dict[str, str],
) -> None:
    programs = client.get("/programs", headers=auth_headers).json()
    queues = client.get("/queues", headers=auth_headers).json()
    customers = client.get("/customers", headers=auth_headers).json()
    payload = {
        "organization_id": programs[0]["organization_id"],
        "client_program_id": programs[0]["id"],
        "queue_id": queues[0]["id"],
        "name": "Policy Renewal Outreach",
        "goal": "Remind customers to renew policies",
        "customer_ids": [customers[0]["id"], customers[1]["id"]],
    }

    create = client.post("/campaigns", headers=auth_headers, json=payload)
    assert create.status_code == 200
    created = create.json()
    assert created["id"]
    assert created["created_at"]
    assert created["customer_ids"] == payload["customer_ids"]

    campaigns = client.get("/campaigns", headers=auth_headers)
    assert campaigns.status_code == 200
    assert any(campaign["id"] == created["id"] for campaign in campaigns.json())

    detail = client.get(f"/campaigns/{created['id']}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["id"] == created["id"]

    calls = client.get(f"/campaigns/{created['id']}/calls", headers=auth_headers)
    assert calls.status_code == 200
    assert calls.json() == []


def test_campaign_creation_blocks_customers_from_another_program(client: TestClient) -> None:
    login = client.post("/auth/login", json={"username": "owner", "password": "voiceops123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    programs = client.get("/programs", headers=headers).json()
    queues = client.get("/queues", headers=headers).json()
    customers = client.get("/customers", headers=headers).json()

    acme_program = next(program for program in programs if program["slug"] == "acme-insurance")
    acme_queue = next(queue for queue in queues if queue["client_program_id"] == acme_program["id"])
    healthplus_customer = next(customer for customer in customers if customer["client_program_id"] != acme_program["id"])

    create = client.post(
        "/campaigns",
        headers=headers,
        json={
            "organization_id": acme_program["organization_id"],
            "client_program_id": acme_program["id"],
            "queue_id": acme_queue["id"],
            "name": "Invalid Mixed Campaign",
            "goal": "Should fail",
            "customer_ids": [healthplus_customer["id"]],
        },
    )

    assert create.status_code == 400
    assert create.json()["detail"] == "One or more customers do not belong to the selected program"


def test_twilio_config_exposes_media_stream_urls(client: TestClient) -> None:
    response = client.get("/twilio/config")
    assert response.status_code == 200
    payload = response.json()
    assert "media_stream_websocket" in payload
    assert "stream_action_webhook" in payload
    assert payload["queues"]
    assert "stream_websocket" in payload["queues"][0]


def test_twilio_voice_returns_connect_stream(client: TestClient, db_session, monkeypatch) -> None:
    queue = db_session.scalars(select(Queue)).first()
    assert queue is not None

    monkeypatch.setattr(main_module.settings, "deepgram_api_key", "test-deepgram-key")
    monkeypatch.setattr(main_module.settings, "public_base_url", "https://example.ngrok-free.app")

    response = client.post(
        f"/twilio/voice?queue_id={queue.id}",
        data={
            "From": "+14155550101",
            "To": "+14155550199",
            "CallSid": "CA1234567890",
        },
    )

    assert response.status_code == 200
    body = response.text
    assert "<Connect" in body
    assert "<Stream" in body
    assert "wss://example.ngrok-free.app/ws/twilio-media/" in body
    assert 'Parameter name="call_id"' in body
    assert "<Gather" not in body
