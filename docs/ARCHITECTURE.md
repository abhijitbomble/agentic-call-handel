# VoiceOps Control Architecture

## Current System Scope

- Multi-tenant SaaS structure with `Organization -> Client Program -> Queue`.
- FastAPI control plane for auth, calls, tickets, callbacks, QA, analytics, and customer sessions.
- Real phone-call path via `Twilio Media Streams + Deepgram`.
- Browser customer-call path via websocket session links.
- Shared business-logic layer through `SessionEngine`.
- SQLite-backed operational data store for demo/runtime state.
- Next.js dashboard for supervisors, agents, and admins.

## Architecture Diagram

```mermaid
flowchart LR
    subgraph Channels[Customer Channels]
        PSTN[Phone Caller]
        BrowserUser[Browser Caller]
    end

    subgraph External[External Providers]
        Twilio[Twilio Voice]
        DGSTT[Deepgram STT]
        DGTTS[Deepgram TTS]
        HumanPhone[Human Escalation Number]
    end

    subgraph Web[Next.js Control Center]
        Dashboard[Supervisor and Agent Dashboard]
        CallLink[Customer Call Link UI]
    end

    subgraph API[FastAPI Control Plane]
        Auth[Auth and Role Scope]
        TwilioVoice[/twilio/voice]
        TwilioMedia[/ws/twilio-media/{queue_id}]
        BrowserSession[/customer-sessions]
        BrowserWS[/ws/customer-call/{token}]
        SessionEngine[SessionEngine]
        ToolLayer[Tool and Policy Layer]
        EventHub[Live Event Hub]
        Analytics[Analytics and Monitoring APIs]
    end

    subgraph Data[Operational Data]
        DB[(SQLite Database)]
        KB[Knowledge Documents and Chunks]
        Calls[Calls and Call Turns]
        Ops[Callbacks Tickets QA Handoffs]
        Tenant[Tenant Data: Organizations Programs Queues Staff Customers]
    end

    PSTN --> Twilio
    Twilio --> TwilioVoice
    TwilioVoice --> SessionEngine
    TwilioVoice --> TwilioMedia
    TwilioMedia --> DGSTT
    SessionEngine --> DGTTS
    DGTTS --> TwilioMedia
    TwilioMedia --> Twilio
    Twilio --> HumanPhone

    Dashboard --> Auth
    Dashboard --> Analytics
    Dashboard --> BrowserSession
    Dashboard --> EventHub
    BrowserUser --> CallLink
    CallLink --> BrowserWS
    BrowserWS --> SessionEngine

    SessionEngine --> ToolLayer
    ToolLayer --> KB
    ToolLayer --> Calls
    ToolLayer --> Ops
    ToolLayer --> Tenant

    Auth --> DB
    Analytics --> DB
    SessionEngine --> DB
    EventHub --> DB

    DB --> KB
    DB --> Calls
    DB --> Ops
    DB --> Tenant
```

## Live Call Workflow Diagram

```mermaid
flowchart TD
    A[Customer calls Twilio number] --> B[Twilio sends webhook to /twilio/voice with queue_id]
    B --> C[API loads Queue and Client Program]
    C --> D[Create Call record]
    D --> E[SessionEngine.start_session]
    E --> F[Return TwiML with Connect and Stream]
    F --> G[Twilio opens websocket to /ws/twilio-media/{queue_id}]
    G --> H[API bridge connects to Deepgram streaming STT]
    H --> I[Opening disclosure is synthesized through Deepgram TTS]
    I --> J[Audio streams back into the live phone call]
    J --> K[Customer speaks]
    K --> L[Twilio sends mulaw audio frames to websocket]
    L --> M[Bridge forwards audio to Deepgram STT]
    M --> N[Deepgram emits finalized transcript]
    N --> O[SessionEngine.process_turn]
    O --> P{Intent and policy result}

    P -->|FAQ or KB answer| Q[Search approved knowledge and compose reply]
    P -->|Case status| R[Verify customer if needed and lookup case]
    P -->|Complaint| S[Create ticket or escalate]
    P -->|Callback request| T[Create callback task]
    P -->|Human transfer| U[Request live handoff]
    P -->|Low confidence| V[Clarify or escalate by policy]

    Q --> W[Generate AI reply]
    R --> W
    S --> W
    T --> W
    U --> W
    V --> W

    W --> X[Deepgram TTS returns mulaw 8k audio]
    X --> Y[Bridge streams reply back to Twilio]
    Y --> Z{Call terminal state?}

    Z -->|No| K
    Z -->|Resolved| AA[Stream ends and Twilio hangs up]
    Z -->|Callback| AB[Stream ends and callback remains in queue]
    Z -->|Live handoff| AC[/twilio/stream-action decides next step]
    AC --> AD[Twilio dials human escalation number]
    AD --> AE[Human agent speaks with customer]
```

## Browser Call Workflow

```mermaid
flowchart TD
    A[Agent creates customer session link] --> B[/customer-sessions issues signed token]
    B --> C[Customer opens /call/{token}]
    C --> D[Browser websocket connects to /ws/customer-call/{token}]
    D --> E[API validates token and creates Call]
    E --> F[SessionEngine.start_session]
    F --> G[Customer and AI exchange text or browser-audio turns]
    G --> H[SessionEngine.process_turn]
    H --> I{Resolved or escalated?}
    I -->|Continue| G
    I -->|Resolved| J[Call ends]
    I -->|Escalated| K[Callback or live handoff path]
```

## Responsibility Map

- `Twilio`: PSTN entry point and call transport.
- `Deepgram STT/TTS`: real-time speech recognition and speech synthesis.
- `FastAPI`: routing, session state, business rules, tool execution, and persistence.
- `SessionEngine`: the core decision layer for intent, verification, KB usage, callbacks, tickets, and handoffs.
- `Next.js Dashboard`: operator visibility, QA, analytics, callback queue, and program management.
- `Database`: source of truth for tenants, customers, calls, transcripts, tickets, callbacks, QA, and KB chunks.

## Human Agent and Client Connection Model

- Customer always enters through a `Queue`.
- Queue always belongs to one `Client Program`.
- AI always handles first unless future routing rules explicitly bypass it.
- Human agent receives the customer only after policy-driven escalation.
- Human agents should be treated as program-scoped resources, not generic phone endpoints.
- Client businesses are represented by tenant data and program rules, not by direct hardcoded flows.

## What To Freeze Before The Next Build

These definitions should be treated as locked product rules for the next implementation phase.

### 1. Customer Entry Rules

**Freeze decision**

- `Phone call through Twilio` is the primary production entry channel.
- `Browser call link` remains supported as a controlled secondary channel for demos, assisted calls, and internal workflows.
- No new customer-facing channels should be added in the next build.

**Meaning for build**

- All production call handling logic must work first for `phone`.
- `browser` must reuse the same `SessionEngine`, queue rules, KB rules, and escalation rules.
- Website widget, WhatsApp, SIP trunk, and app SDK entry points are out of scope for the next build.

### 2. Human Agent Model

**Freeze decision**

- The next build should use `AI-first with phone-bridge human handoff`.
- Human agents are managed from the dashboard, but the live voice transfer still lands on the configured human phone number.
- A full browser-based human voice console is deferred to a later phase.

**Meaning for build**

- Dashboard responsibility now: availability, callback handling, live call visibility, QA, transcript review.
- Voice responsibility now: Twilio bridges the customer call to the human escalation number after approved handoff.
- Do not build WebRTC or browser agent audio as part of the next build.

### 3. Queue Ownership

**Freeze decision**

- Every `Queue` belongs to exactly one `Client Program`.
- Human agents are assigned by `organization + client program + allowed queue`.
- Supervisors can oversee multiple queues within the same organization.

**Meaning for build**

- A normal agent should only see calls, callbacks, handoffs, and customer data for assigned programs and queues.
- Queue membership must become explicit instead of treating any available agent in the program as globally eligible.
- Language support and specialization should be attached to queue ownership rules.

**Required queue assignment model**

- `Org Owner`: full access across the organization.
- `Program Admin`: full access within one client program.
- `Supervisor`: monitor multiple queues inside allowed program scope.
- `Agent`: handle only assigned queues and callbacks.

### 4. Handoff Contract

**Freeze decision**

- Every human handoff must include a fixed transfer packet.
- The human agent should never receive a blind transfer with no context.

**Minimum handoff packet**

- `call_id`
- `organization`
- `client_program`
- `queue`
- `customer_phone`
- `customer identity status`
- `detected intent`
- `language`
- `sentiment`
- `summary generated by AI`
- `escalation reason`
- `last transcript turns`
- `tools already used`
- `ticket id` if created
- `callback id` if created

**Meaning for build**

- This packet should be visible in the dashboard before or at handoff time.
- The same packet should be stored for QA and audit review.
- Later CRM sync can enrich it, but this base contract should not change casually.

### 5. Client Isolation

**Freeze decision**

- `Client Program` is the main isolation boundary for operations.
- No agent should access another client program's KB, calls, callbacks, tickets, reviews, or customer records unless their role explicitly allows it.

**Meaning for build**

- KB retrieval must be restricted to the active client program.
- Call history, transcript history, QA, and callback queues must be filtered by role scope.
- Customer lookup should not cross program boundaries by default.
- Shared organization ownership is allowed only for org-level leadership roles.

**Isolation rule**

- `Program data must stay program-local unless org-owner or explicitly authorized supervisor access is defined.`

### 6. Operating Modes

**Freeze decision**

The next build should support these three modes only:

- `AI-only`
- `AI-first then human`
- `Callback-only fallback`

**Mode definitions**

- `AI-only`: AI handles the session end-to-end and never attempts live human transfer.
- `AI-first then human`: default operating mode; AI handles first, escalates only on policy triggers.
- `Callback-only fallback`: if no live human is available, or if the queue or program requires it, create a callback instead of a live transfer.

**Recommended default**

- Set `AI-first then human` as the default mode for most queues.
- Use `AI-only` only for low-risk FAQ or tightly scoped service flows.
- Use `Callback-only fallback` whenever live handoff is unavailable, outside business hours, or disallowed by policy.

**Meaning for build**

- Operating mode should be configurable per queue or per program.
- `SessionEngine` should always know which mode the active queue is running under.
- UI, analytics, and QA should report which mode handled each call.

## Frozen Decisions Summary

For the next build, the project should proceed with this product shape:

- Primary customer entry is `Twilio phone calls`.
- Secondary controlled entry is `browser call links`.
- Default runtime mode is `AI-first then human`.
- Human live transfer is `phone-bridge`, not browser audio.
- Queue access is explicit and program-scoped.
- Handoffs require a fixed context packet.
- Client-program isolation is strict by default.

## Production-Shaped Operating Model

For this project, the operating model should stay simple and production-shaped:

- `Customer -> AI first`
- `AI -> Human only on approved triggers`
- `Human agent works by program and queue membership`
- `Client is represented by organization + client program, not by free-form routing`
- `All decision logic flows through SessionEngine, not through UI hacks`

This is the difference between a real SaaS structure and a demo-only flow.

## Exact Customer -> AI -> Human Live Call Flow

This should be the canonical live production path.

### Step 1. Customer Entry

- Customer calls the Twilio phone number.
- Twilio routes the call into a specific `queue_id`.
- The API resolves:
  - `organization`
  - `client program`
  - `queue`
- A `Call` record is created immediately.

### Step 2. AI Session Starts

- `SessionEngine.start_session(...)` starts the call.
- AI gives disclosure and opening prompt.
- Twilio Media Streams opens the live audio websocket.
- Deepgram handles STT/TTS transport.

### Step 3. AI Handles First

- Customer speech is transcribed.
- Transcript goes to `SessionEngine.process_turn(...)`.
- `SessionEngine` decides:
  - intent
  - language
  - verification requirement
  - KB/tool usage
  - callback need
  - escalation need

### Step 4. Approved AI Actions

AI can only do these approved categories through the backend:

- answer from approved KB
- verify identity
- lookup case or status
- create callback
- create ticket
- request handoff

The UI should never decide these outcomes by itself.

### Step 5. Human Escalation Trigger

AI may move to human only on approved triggers such as:

- explicit customer request for human
- repeated verification failure
- angry or high-risk complaint
- low confidence after clarification
- queue/program handoff policy requires it

### Step 6. Human Handoff Decision

`SessionEngine` checks:

- operating mode
- queue rules
- client-program rules
- live handoff enabled or not
- callback fallback enabled or not
- eligible human availability

If approved and available:

- call disposition becomes `escalated`
- handoff mode becomes `live`
- Twilio bridges the customer to the human agent number

If approved but unavailable:

- callback task is created
- call ends with callback confirmation

If not approved:

- AI continues handling the conversation

### Step 7. Human Agent Receives Context

Human must receive the handoff packet, not a blind transfer:

- call id
- client program
- queue
- customer phone
- language
- intent
- sentiment
- verification state
- summary
- escalation reason
- recent transcript
- tools already used

### Step 8. Call Outcome

The final result must be one of:

- resolved by AI
- transferred live to human
- callback created
- ticket created and closed from AI side

## Exact Agent Workspace Model For Human Agents

Human agents should work through a queue-scoped operating model, not generic global access.

### Agent Roles

- `Org Owner`
  - full organization access
- `Program Admin`
  - full access within one client program
- `Supervisor`
  - monitors queues, reviews calls, handles escalations
- `Agent`
  - handles live handoffs and callbacks only for assigned queues

### Agent Workspace Responsibilities

Human agent workspace should show:

- assigned queues
- active handoff requests
- callback queue
- customer profile summary
- AI summary
- transcript history
- created tickets
- case lookup results
- current status of the call

### Agent Availability Model

Each agent should have:

- membership to organization
- membership to one or more client programs
- queue assignments
- supported languages
- availability state

Availability state should be simple in the next build:

- available
- busy
- offline

### Agent Access Rules

An agent should only:

- receive calls from assigned queues
- see callbacks from assigned queues
- see transcripts for assigned program scope
- act on tickets/callbacks in assigned scope

An agent should not:

- access another client program's data
- manually bypass queue assignment
- directly change business rules from the UI

## Exact Client Program / Queue / Permissions Structure

This should be the main SaaS structure.

### Tenant Structure

- `Organization`
  - the BPO or operating account
- `Client Program`
  - one client contract or service line under that organization
- `Queue`
  - one operational intake lane inside a client program

Example:

- Organization: `BrightConnect BPO`
- Client Program: `Acme Insurance`
- Queue: `Claims Support - English`

### What Belongs To Client Program

Each `Client Program` should own:

- KB documents and chunks
- verification policy
- handoff policy
- callback policy
- customer records
- case records
- tickets
- callbacks
- call transcripts
- QA reviews
- analytics slice

### What Belongs To Queue

Each `Queue` should define:

- supported languages
- business hours
- live handoff enabled or disabled
- callback enabled or disabled
- operating mode
- assigned human agents
- escalation behavior

### Permission Structure

Permissions should follow this logic:

- organization-level roles can see across programs if allowed
- program-level roles can see only their client program
- queue-level handling rights control who can take live work

### Permission Rule Matrix

- `Org Owner`
  - all programs, all queues, all analytics, all staff
- `Program Admin`
  - all queues and data inside one client program
- `Supervisor`
  - monitor/manage assigned queues in allowed program scope
- `Agent`
  - work only assigned queues and related customer operations

### Non-Negotiable Rule

- Routing, permissions, KB access, escalation decisions, and tool actions must be enforced in backend logic.
- The frontend may display state, request actions, and present workflow, but it must not become the source of truth.

## What Is Already Implemented

- Twilio inbound webhook and Media Streams path.
- Deepgram-backed real-time phone-call bridge.
- Browser customer-session entry point.
- Shared `SessionEngine` for both phone and browser flows.
- Ticket creation, callback creation, verification flow, KB lookup, and escalation logic.
- Dashboard surfaces for live calls, callbacks, QA, and analytics.

## Next Architecture Upgrades

- Replace raw escalation phone number with true human-agent workspace routing.
- Add agent availability, queue claiming, and accept/reject handoff workflow.
- Move from SQLite demo storage to production database.
- Add vector retrieval and per-program KB access rules.
- Add CRM/helpdesk integrations behind tool adapters.
- Add production-grade observability for transcript, latency, and provider failures.


## Phase 1 Fix List

This is the immediate stabilization plan based on the current feature audit. The goal of Phase 1 is not to add more surface area. The goal is to make the current SaaS shape trustworthy end to end.

### Critical

These items block production trust and should be fixed before any new feature buildout.

#### 1. Fix customer creation end to end

- `POST /customers` is currently broken because audit logging uses `customer.id` before the row is flushed.
- Result: customer list looks usable, but new-customer onboarding fails.
- Required fix:
  - persist the customer first
  - then write the audit log
  - then return the created record
- Exit criteria:
  - customer can be created from UI
  - customer appears in list immediately
  - audit log entry is stored correctly

#### 2. Fix campaign schemas and create flow

- `POST /campaigns` is broken because response schemas expect `str` while ORM returns `datetime`.
- Result: outbound campaigns cannot be created reliably.
- Required fix:
  - align `CampaignRead` and `CampaignCallRead` with actual model types
  - verify campaign create, fetch, and detail APIs together
- Exit criteria:
  - campaign create works from UI
  - campaign detail page loads
  - campaign call list loads without serialization errors

#### 3. Remove hidden demo-auth and demo-data fallback from protected flows

- The web layer currently falls back to demo login and fallback data when backend auth is missing or requests fail.
- Result: screens can look healthy while real backend behavior is broken.
- Required fix:
  - keep demo mode only behind an explicit development flag
  - protected pages must fail loudly when auth or backend calls fail
  - dashboard/API proxy should use real session cookie as the source of truth
- Exit criteria:
  - no protected production page silently renders demo data
  - auth failure shows a real error or redirect
  - backend outage is visible instead of masked

#### 4. Clean the live-call frontend runtime issues

- Lint currently fails in the live browser-call and voice-lab components.
- Result: the most important real-time UI path is not production-clean.
- Required fix:
  - resolve hook/state ordering issues
  - remove set-state-in-effect violations
  - make the real-time call components lint-clean
- Exit criteria:
  - frontend lint passes
  - browser call UI still works after cleanup
  - voice-lab UI still works after cleanup

#### 5. Run a real end-to-end Twilio phone-call verification

- Twilio config and webhook response are wired, but a full provider round trip has not been proven in this audit.
- Result: phone architecture exists, but production confidence is incomplete.
- Required fix:
  - place a real inbound test call
  - confirm Twilio stream connect
  - confirm Deepgram STT/TTS loop
  - confirm `SessionEngine` response path
  - confirm human handoff or callback path
- Exit criteria:
  - one real phone call completes through the live path
  - transcript is saved
  - call status/disposition is visible in dashboard

### Important

These items should be addressed right after the critical block, because they affect product integrity and operator trust.

#### 6. Make settings real or disable editing

- Settings currently save only in local UI state.
- Result: the page behaves like a feature but is actually a mock.
- Required fix:
  - either connect settings to backend persistence
  - or mark the page read-only until backend support exists
- Exit criteria:
  - every editable control persists for real
  - or the page clearly states that editing is not available yet

#### 7. Make campaign start behavior honest

- Even after create is fixed, current campaign start flow is simulator-style and not true outbound telephony.
- Result: the feature name suggests more capability than the backend really provides.
- Required fix:
  - either convert campaign start into a true outbound call workflow
  - or relabel and scope it as simulated campaign execution
- Exit criteria:
  - product wording matches real behavior
  - users are not misled about outbound automation

#### 8. Verify role scope and client-program isolation on all operator pages

- The architecture says `Client Program` is the isolation boundary, but this should be validated page by page.
- Required fix:
  - verify customers, tickets, callbacks, reviews, calls, and KB screens all respect org/program scope
  - verify agents cannot act outside assigned queues
- Exit criteria:
  - unauthorized cross-program reads are blocked
  - unauthorized queue actions are blocked

#### 9. Verify supervisor live monitoring end to end

- The live-calls monitoring path exists, but it has not yet been proven as a full UI-to-websocket-to-backend loop in this audit.
- Required fix:
  - confirm active call updates stream into the dashboard
  - confirm transcript and state refresh correctly during a live session
- Exit criteria:
  - supervisor sees active call state changes in near real time
  - transcript visibility matches backend events

#### 10. Add a broader regression test pack for core operator APIs

- Current backend tests cover only a thin slice of the control plane.
- Required fix:
  - add route tests for customers, campaigns, callbacks, reviews, browser sessions, and live-call state transitions
  - add at least one smoke flow covering `customer -> AI -> callback or handoff`
- Exit criteria:
  - critical operator flows have automated coverage
  - the broken paths found in the audit are permanently guarded

### Nice To Have

These are useful once the current feature set is stable.

#### 11. Improve build and environment reliability

- Frontend build was blocked by a locked `.next` artifact during verification.
- Required fix:
  - document safe cleanup/start workflow
  - ensure local build pipeline is repeatable

#### 12. Add clearer operational observability

- Add better visibility for:
  - Twilio stream failures
  - Deepgram connection failures
  - websocket disconnect reasons
  - escalation and callback decision paths
- This will make live-call debugging much easier once real traffic increases.

#### 13. Tighten UX polish only after functional trust is restored

- Dashboard visual cleanup is valuable, but it should not outrank broken core flows.
- Focus UI polish after customer create, campaigns, auth trust, and live-call verification are stable.

## Phase 1 Success Definition

Phase 1 should be considered complete only when all of the following are true:

- protected pages do not silently use demo fallbacks
- customer creation works from the UI
- campaign creation no longer crashes
- settings is either real or explicitly disabled
- frontend lint passes
- one real Twilio call is verified end to end
- program-scope access rules are validated on operator pages

## Critical Implementation Checklist

This section turns the `Critical` Phase 1 items into exact execution workstreams. The purpose is to remove ambiguity before implementation starts.

### Recommended Execution Order

1. Fix `POST /customers`
2. Fix campaign serialization and create flow
3. Remove hidden demo fallback from protected flows
4. Clean live-call frontend runtime issues
5. Run one real Twilio end-to-end call verification

### Workstream A. Customer Creation Fix

**Primary endpoints**

- Backend: `POST /customers`
- Frontend proxy: `POST /api/customers`
- Read verification: `GET /customers`

**Files to change**

- `apps/api/app/main.py`
- `apps/web/src/app/api/customers/route.ts`
- `apps/web/src/components/add-customer-form.tsx`
- `apps/web/src/app/customers/page.tsx`
- `apps/api/tests/test_api_routes.py`
- `apps/api/tests/test_isolation.py`

**Implementation steps**

- In `create_customer(...)`, persist the `Customer` row before writing the audit log.
- Use `db.flush()` after `db.add(customer)` so `customer.id` exists before `store_audit_log(...)` runs.
- Keep the duplicate customer-code check and org-scope guard unchanged.
- Confirm the response still returns `CustomerRead` and not a raw ORM object.
- Ensure frontend create flow surfaces backend validation errors instead of generic failure text.
- Add an API test that creates a customer and proves the response is `200` and the customer id is present.
- Add an isolation test that confirms a user cannot create a customer for another organization.

**Verification**

- Create a customer from the UI and confirm it appears immediately in the customer list.
- Confirm `POST /customers` no longer returns `500`.
- Confirm audit logging stores a non-null `entity_id` for the created customer.

### Workstream B. Campaign Create and Read Fix

**Primary endpoints**

- Backend: `POST /campaigns`
- Backend: `GET /campaigns`
- Backend: `GET /campaigns/{campaign_id}`
- Backend: `GET /campaigns/{campaign_id}/calls`
- Frontend proxy: `POST /api/campaigns`
- Frontend proxy: `GET /api/campaigns`
- Frontend proxy: `GET /api/campaigns/{id}`
- Frontend proxy: `GET /api/campaigns/{id}/calls`

**Files to change**

- `apps/api/app/schemas.py`
- `apps/api/app/main.py`
- `apps/web/src/app/api/campaigns/route.ts`
- `apps/web/src/app/api/campaigns/[id]/route.ts`
- `apps/web/src/app/api/campaigns/[id]/calls/route.ts`
- `apps/web/src/components/create-campaign-form.tsx`
- `apps/web/src/components/campaign-board.tsx`
- `apps/web/src/app/campaigns/page.tsx`
- `apps/web/src/app/campaigns/[id]/page.tsx`
- `apps/api/tests/test_api_routes.py`

**Implementation steps**

- Align `CampaignRead` and `CampaignCallRead` datetime fields with the ORM values returned by SQLAlchemy.
- Preferred fix: use `datetime | None` for date/time fields and let FastAPI serialize them to ISO strings.
- Verify campaign list, detail, and calls endpoints all serialize correctly after the schema fix.
- Keep campaign `start` behavior unchanged for this workstream unless it blocks read/create verification.
- Ensure create form shows backend validation or serialization errors clearly.
- Add route tests for campaign create, campaign list, campaign detail, and campaign calls.

**Verification**

- Create a campaign from the UI successfully.
- Open the campaign detail page successfully.
- Confirm campaign calls panel loads without serialization errors.
- Confirm the API returns valid JSON for all four campaign endpoints.

### Workstream C. Remove Demo Fallback From Protected Flows

**Primary endpoints and flows**

- Auth cookie boundary: `/api/auth/login`
- Backend auth: `/auth/login`
- Protected data proxies: `/api/customers`, `/api/calls`, `/api/tickets`, `/api/callbacks`, `/api/reviews`, `/api/knowledge-docs`, `/api/campaigns`
- Protected server-data fetches through `apps/web/src/lib/api.ts`

**Files to change**

- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/backend-proxy.ts`
- `apps/web/src/middleware.ts`
- `apps/web/src/app/api/auth/login/route.ts`
- `apps/web/src/app/login/page.tsx`

**Implementation steps**

- Remove automatic demo login from `getToken()` in `apps/web/src/lib/api.ts` for protected production flows.
- Remove automatic demo token fetch from `backendRequest(...)` in `apps/web/src/lib/backend-proxy.ts`.
- Make protected requests depend on the real `voiceops_token` cookie.
- If a demo mode is still needed for development, gate it behind an explicit environment variable such as `VOICEOPS_ALLOW_DEMO_FALLBACK=true` and default it to `false`.
- Keep `/login` and public customer-call routes accessible, but require a real session for protected dashboard pages.
- Ensure missing or expired auth produces a redirect or visible error, not silent demo data.

**Verification**

- Clear the auth cookie and confirm protected pages redirect to `/login`.
- Stop the backend and confirm protected pages do not render fake demo data.
- Log in again and confirm real data loads through the proxy layer.

### Workstream D. Live-Call Frontend Runtime Cleanup

**Primary flows**

- Browser customer call page: `/call/{token}`
- Voice lab simulator path: `/voice-lab`
- Frontend lint gate: `npm --prefix apps/web run lint`

**Files to change**

- `apps/web/src/components/customer-call-view.tsx`
- `apps/web/src/components/live-call-session.tsx`
- `apps/web/src/components/supervisor-live-monitor.tsx`
- `apps/web/src/components/squad-session.tsx`

**Implementation steps**

- Remove `setState` calls inside mount-only effects where a stable initial state can be derived without an effect.
- In `customer-call-view.tsx`, resolve the `sendTurn` reference ordering issue so the component is valid under the current lint rules.
- In `live-call-session.tsx`, resolve the `setState`-in-effect error and clean up the effect dependency warning.
- Clean remaining warnings in supervisor and squad components so the realtime surface is actually production-clean.
- Re-run lint after each component cleanup instead of batching the entire fix blindly.

**Verification**

- `npm --prefix apps/web run lint` passes.
- Browser call still connects, receives AI greeting, and sends at least one turn successfully.
- Voice lab still starts a session, accepts a turn, and renders the updated transcript.

### Workstream E. Real Twilio End-to-End Verification

**Primary endpoints**

- `GET /twilio/config`
- `POST /twilio/voice`
- `WS /ws/twilio-media/{queue_id}`
- `POST /twilio/stream-action`
- `POST /twilio/dial-complete`
- `GET /calls`
- `GET /calls/{call_id}/transcript`

**Files to verify or adjust**

- `apps/api/app/main.py`
- `apps/api/app/twilio_media.py`
- `apps/api/app/services.py`
- `apps/web/src/components/twilio-setup.tsx`
- `apps/api/.env`

**Implementation and verification steps**

- Confirm `TWILIO_*`, `DEEPGRAM_API_KEY`, and public base URL settings are loaded correctly by the API.
- Confirm the Twilio number webhook points to `POST /twilio/voice?queue_id=<queue_id>`.
- Place one real inbound phone call from a verified number if the account is still on Twilio trial.
- Confirm the call hits `/twilio/voice` and upgrades into the media-stream websocket.
- Confirm Deepgram receives audio, returns transcript, and AI audio is sent back into the call.
- Confirm the call creates or updates a `Call` record and transcript rows.
- Confirm at least one branch is proven end to end: `resolved`, `callback created`, or `human handoff`.
- If handoff is tested, confirm the escalation number receives the bridged call and the dashboard reflects the escalated state.

**Verification evidence to save**

- call id used for the real test
- transcript excerpt proving STT worked
- final call status and disposition
- whether callback or handoff path was reached
- any Twilio or Deepgram provider errors encountered

### Phase 1 Command Checklist

Use this command checklist during implementation verification:

- `npm run test:api`
- `npm --prefix apps/web run lint`
- `npm --prefix apps/web run build`

### Definition Of Done For The Critical Block

The critical block is done only when all of the following are true:

- `POST /customers` works from API and UI
- campaign create/list/detail/calls all serialize correctly
- protected dashboard pages no longer silently use demo fallback
- live-call frontend components are lint-clean
- one real Twilio call is proven end to end with saved evidence
