# Feature Audit - 2026-06-30

## Evidence Used

- `python -m pytest` in `apps/api`: 14 tests passed.
- `npm run lint` in `apps/web`: clean.
- Local API runtime check: `GET /health` returned `200`.
- Local API runtime check: `GET /twilio/config` returned `200` and exposed queue-specific Twilio webhook wiring.
- Local web runtime check: `/login` returned `200` after the frontend stabilization pass.

## Executive Summary

- Audited feature areas: `15`
- Solid end-to-end today: `4`
- Usable but partial: `9`
- Not production-ready: `2`

### Solid End-to-End

- Staff auth and tenant browsing
- Dashboard read surface and analytics snapshot
- Customer create/list flow
- Internal `voice/sessions` state-machine flow used by Voice Lab text mode

### Usable But Partial

- Knowledge base administration
- Live call monitoring and supervisor actions
- Tickets
- Callbacks
- QA reviews
- Campaigns
- Browser customer call links
- Twilio + Deepgram real-call path
- Squad agents

### Not Production-Ready

- Settings persistence
- True outbound campaign dialing

## Highest-Risk Findings

### 1. Cross-program authorization is still broken on multiple mutating routes

The project already has organization and some program scoping, but several important write paths only check organization, not `client_program_id`.

Key routes:

- [main.py](../apps/api/app/main.py#L334) `POST /calls/{call_id}/escalate`
- [main.py](../apps/api/app/main.py#L445) `PATCH /callbacks/{callback_id}`
- [main.py](../apps/api/app/main.py#L472) `PATCH /tickets/{ticket_id}`
- [main.py](../apps/api/app/main.py#L549) `PATCH /customers/{customer_id}`
- [main.py](../apps/api/app/main.py#L584) `POST /knowledge-docs`
- [main.py](../apps/api/app/main.py#L629) `GET /knowledge-docs/{doc_id}/chunks`
- [main.py](../apps/api/app/main.py#L1082) `POST /squad/sessions`
- [main.py](../apps/api/app/main.py#L1153) `POST /squad/sessions/{call_id}/turns`
- [main.py](../apps/api/app/main.py#L1232) `POST /squad/sessions/{call_id}/close`
- [main.py](../apps/api/app/main.py#L1255) `POST /customer-sessions`

Local proof collected during this audit:

- A HealthPlus-scoped supervisor received `200` when patching an Acme ticket.
- The same scoped supervisor received `200` when patching an Acme customer.
- The same scoped supervisor received `200` when creating an Acme browser call link via `POST /customer-sessions`.

This is the biggest production blocker in the current build.

### 2. Queue ownership is not implemented yet

The product direction says agents should operate by `organization + client program + queue`, but the data model and runtime do not enforce that yet.

Evidence:

- [models.py](../apps/api/app/models.py#L72) `StaffMembership` has no queue-assignment field.
- [services.py](../apps/api/app/services.py#L438) `SupervisorHandoffAdapter.choose_mode` selects any available staff membership in the program.
- [models.py](../apps/api/app/models.py#L229) `HandoffEvent` stores only minimal routing data, not a rich transfer packet.

Effect:

- No queue-level claiming or availability model.
- No accept/reject handoff workflow.
- No hard queue boundary for human work assignment.

### 3. Campaign start is not true outbound telephony

[main.py](../apps/api/app/main.py#L735) `POST /campaigns/{campaign_id}/start` creates internal `Call` rows and runs `SessionEngine.start_session`, but it does not dial a real provider or a customer phone number.

So today:

- campaign create/list/detail/calls work
- campaign start is simulator-style
- outbound AI calling is not yet real

### 4. Twilio phone-call path is implemented, but not yet proven end to end with the provider

Evidence of implementation:

- [main.py](../apps/api/app/main.py#L850) `POST /twilio/voice`
- [main.py](../apps/api/app/main.py#L914) `WS /ws/twilio-media/{queue_id}`
- [twilio_media.py](../apps/api/app/twilio_media.py) Deepgram STT/TTS bridge

Evidence of local runtime readiness:

- `GET /twilio/config` returned `200`
- queue-specific webhook URLs were present
- Twilio credentials and public base URL are loaded in the running API

What is still missing from the audit:

- one real inbound Twilio call
- proof that Deepgram receives audio
- proof that AI audio returns to the live phone call
- proof of callback or live-handoff completion in a provider round trip

### 5. Settings is a UI-only shell right now

Evidence:

- [settings-form.tsx](../apps/web/src/components/settings-form.tsx#L109)
- [settings-form.tsx](../apps/web/src/components/settings-form.tsx#L140)

`handleSave()` only waits and flips local UI state. There is no backend API, no persistence, and no link to program or queue policy.

## Feature-by-Feature Status

### 1. Auth and Tenant Browsing

Status: `Solid`

Evidence:

- [main.py](../apps/api/app/main.py#L104) `POST /auth/login`
- [main.py](../apps/api/app/main.py#L127) `GET /auth/me`
- [main.py](../apps/api/app/main.py#L140) `GET /organizations`
- [main.py](../apps/api/app/main.py#L146) `GET /programs`
- [main.py](../apps/api/app/main.py#L158) `GET /queues`
- `test_login_and_program_listing` passed

Notes:

- Read path is good.
- Queue-level authorization is still missing from the wider runtime.

### 2. Dashboard Read Surface

Status: `Solid`

Evidence:

- [api.ts](../apps/web/src/lib/api.ts)
- [page.tsx](../apps/web/src/app/page.tsx)
- [analytics_overview](../apps/api/app/main.py#L642)

Notes:

- Dashboard is backed by real API calls now.
- It is still reading seeded/demo-like operational data from SQLite, which is fine for now.

### 3. Customer Management

Status: `Partial`

Working:

- list customers
- create customers from UI
- audit log on create

Evidence:

- [main.py](../apps/api/app/main.py#L178) `GET /customers`
- [main.py](../apps/api/app/main.py#L503) `POST /customers`
- [add-customer-form.tsx](../apps/web/src/components/add-customer-form.tsx#L8)
- `test_customer_creation_records_audit_log` passed
- `test_customer_creation_blocks_other_organization` passed

Gap:

- update customer is cross-program writable today

### 4. Knowledge Base

Status: `Partial`

Working:

- list docs
- create docs from UI
- chunk storage works

Evidence:

- [main.py](../apps/api/app/main.py#L172) `GET /knowledge-docs`
- [main.py](../apps/api/app/main.py#L584) `POST /knowledge-docs`
- [main.py](../apps/api/app/main.py#L629) `GET /knowledge-docs/{doc_id}/chunks`
- [add-article-form.tsx](../apps/web/src/components/add-article-form.tsx#L8)

Gaps:

- no program-intent KB allowlist model yet
- no RAG/vector retrieval layer yet
- chunk read/write path is not fully program-scoped

### 5. Internal Voice Session Engine

Status: `Solid`

Working:

- session start
- turn processing
- verification gating
- low-confidence clarification/escalation
- callback/ticket/handoff policy decisions

Evidence:

- [SessionEngine](../apps/api/app/services.py#L535)
- [services.py](../apps/api/app/services.py#L563) `start_session`
- [services.py](../apps/api/app/services.py#L583) `process_turn`
- [main.py](../apps/api/app/main.py#L185) `POST /voice/sessions`
- [main.py](../apps/api/app/main.py#L244) `POST /voice/sessions/{call_id}/turns`
- all 4 tests in `test_session_engine.py` passed

Notes:

- This is the strongest business-logic layer in the project right now.
- Without Anthropic, it falls back to rule-based classification and templated replies.

### 6. Live Monitoring and Supervisor Actions

Status: `Partial`

Working:

- live call list
- event websocket feed
- active handoff UI panel

Evidence:

- [main.py](../apps/api/app/main.py#L798) `WS /ws/voice-sessions/{call_id}`
- [calls/page.tsx](../apps/web/src/app/calls/page.tsx)
- [supervisor-live-monitor.tsx](../apps/web/src/components/supervisor-live-monitor.tsx)

Gaps:

- "Join Call" is still an escalate-style action, not a true browser voice join
- call escalation route still has program-scope issues

### 7. Tickets

Status: `Partial`

Working:

- list tickets
- create tickets
- update ticket status from UI

Evidence:

- [main.py](../apps/api/app/main.py#L363) `GET /tickets`
- [main.py](../apps/api/app/main.py#L369) `POST /tickets`
- [main.py](../apps/api/app/main.py#L472) `PATCH /tickets/{ticket_id}`
- [ticket-actions.tsx](../apps/web/src/components/ticket-actions.tsx#L20)
- `test_ticket_creation` passed

Gap:

- ticket update is writable across programs inside the same organization

### 8. Callbacks

Status: `Partial`

Working:

- callback creation from SessionEngine
- callback list page
- callback resolve action from UI

Evidence:

- [main.py](../apps/api/app/main.py#L402) `GET /callbacks`
- [main.py](../apps/api/app/main.py#L445) `PATCH /callbacks/{callback_id}`
- [callback-card.tsx](../apps/web/src/components/callback-card.tsx#L10)

Gap:

- callback resolve route is not fully program-scoped

### 9. QA Reviews

Status: `Partial`

Working:

- review list
- score submission from UI

Evidence:

- [main.py](../apps/api/app/main.py#L408) `GET /reviews`
- [main.py](../apps/api/app/main.py#L414) `PATCH /reviews/{review_id}`
- [review-card.tsx](../apps/web/src/components/review-card.tsx#L10)

Gap:

- review scoring route only checks organization scope

### 10. Analytics

Status: `Solid`

Evidence:

- [main.py](../apps/api/app/main.py#L642) `GET /analytics/overview`
- [services.py](../apps/api/app/services.py#L923) `build_analytics_snapshot`
- [analytics/page.tsx](../apps/web/src/app/analytics/page.tsx)

Notes:

- Analytics is based on seeded SQLite operational data, not provider billing or warehouse data.

### 11. Campaigns

Status: `Partial`

Working:

- create campaign
- list campaigns
- load campaign detail
- load campaign call rows

Evidence:

- [main.py](../apps/api/app/main.py#L650) `GET /campaigns`
- [main.py](../apps/api/app/main.py#L656) `POST /campaigns`
- [main.py](../apps/api/app/main.py#L709) `GET /campaigns/{campaign_id}`
- [main.py](../apps/api/app/main.py#L721) `GET /campaigns/{campaign_id}/calls`
- [create-campaign-form.tsx](../apps/web/src/components/create-campaign-form.tsx)
- [campaign-board.tsx](../apps/web/src/components/campaign-board.tsx)
- `test_campaign_endpoints_serialize_after_create` passed
- `test_campaign_creation_blocks_customers_from_another_program` passed

Gap:

- [main.py](../apps/api/app/main.py#L735) `POST /campaigns/{campaign_id}/start` is not real outbound calling

### 12. Browser Customer Call Links

Status: `Partial`

Working:

- link generation
- tokenized `/call/[token]` page
- websocket conversation path

Evidence:

- [main.py](../apps/api/app/main.py#L1255) `POST /customer-sessions`
- [main.py](../apps/api/app/main.py#L1292) `WS /ws/customer-call/{token}`
- [call-link-generator.tsx](../apps/web/src/components/call-link-generator.tsx#L18)
- [customer-call-view.tsx](../apps/web/src/components/customer-call-view.tsx#L61)

Gaps:

- creation route is cross-program writable today
- browser voice depends on browser speech APIs, not a server speech stack

### 13. Twilio + Deepgram Live Calls

Status: `Partial`

Implemented:

- Twilio inbound webhook
- Twilio Media Streams websocket
- Deepgram STT and TTS bridge
- post-stream handoff hook

Evidence:

- [main.py](../apps/api/app/main.py#L850)
- [main.py](../apps/api/app/main.py#L914)
- [twilio_media.py](../apps/api/app/twilio_media.py)
- `test_twilio_config_exposes_media_stream_urls` passed
- `test_twilio_voice_returns_connect_stream` passed

Missing proof:

- one real live call through the provider path

### 14. Squad Agents

Status: `Partial`

Working:

- six-agent pool abstraction
- squad status page
- squad session start/turn/close flow

Evidence:

- [orchestrator.py](../apps/api/app/orchestrator.py)
- [agents.py](../apps/api/app/agents.py)
- [main.py](../apps/api/app/main.py#L1077) to [main.py](../apps/api/app/main.py#L1232)
- [squad-dashboard.tsx](../apps/web/src/components/squad-dashboard.tsx#L41)

Gaps:

- program and queue scope is not enforced tightly enough
- no queue assignment model
- production usefulness depends on Anthropic availability

### 15. Settings

Status: `Not production-ready`

Evidence:

- [settings-form.tsx](../apps/web/src/components/settings-form.tsx#L109)
- [settings-form.tsx](../apps/web/src/components/settings-form.tsx#L140)

Gap:

- no API
- no DB persistence
- no linkage to `ClientProgram` or `Queue` policy

## API Status Summary

## Solid API groups

- Auth: `POST /auth/login`, `GET /auth/me`
- Tenant directory: `GET /organizations`, `GET /programs`, `GET /queues`
- Internal session engine: `POST /voice/sessions`, `POST /voice/sessions/{call_id}/turns`
- Analytics: `GET /analytics/overview`
- Campaign create/read path: `GET /campaigns`, `POST /campaigns`, `GET /campaigns/{id}`, `GET /campaigns/{id}/calls`
- Twilio setup path: `GET /twilio/config`, `POST /twilio/voice`

## Partial API groups

- Customers
- Knowledge docs
- Calls read/escalate/events
- Tickets
- Callbacks
- Reviews
- Customer browser sessions
- Twilio media bridge and post-stream actions
- Squad sessions

## High-risk API areas

- Cross-program writes on several mutating routes
- `POST /campaigns/{campaign_id}/start` because it looks like outbound telephony but is still internal simulation

## Recommended Next Build Order

1. Lock down program and queue authorization across all mutating routes.
2. Add queue assignment data and enforce queue ownership in handoff and agent actions.
3. Decide whether campaign start becomes true outbound telephony or gets relabeled as simulation.
4. Run one real Twilio inbound call and save evidence of transcript, AI reply, and final disposition.
5. Persist settings into real program and queue policy records.
