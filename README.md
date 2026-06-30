# VoiceOps Control

VoiceOps Control is a browser-first BPO voice support SaaS scaffold focused on the core business logic for multi-program call operations.

## What is implemented

- FastAPI control plane with tenant-aware models, RBAC, seeded demo data, typed tool execution, and a call-session state machine.
- Next.js control center with an operations dashboard, program views, call history, tickets, callbacks, reviews, analytics, and a session lab.
- Free-first adapter boundaries for channel, STT, dialog, TTS, knowledge, tool execution, and handoff.
- Tests for verification gating, handoff fallback, tenant isolation, and API flows.

## Repo layout

- `apps/api` - FastAPI backend and tests
- `apps/web` - Next.js control center
- `apps/voice-worker` - voice worker placeholder and integration notes
- `infra/docker` - local infrastructure bootstrap
- `docs` - architecture and delivery notes

## Run locally

### Backend

```bash
npm run test:api
npm run dev:api
```

The API listens on `http://127.0.0.1:8020`.

Demo credentials:

- `owner` / `voiceops123`
- `supervisor` / `voiceops123`
- `agent` / `voiceops123`
- `qa` / `voiceops123`

### Frontend

```bash
npm run dev:web
```

The web app listens on `http://127.0.0.1:3000`.

Set `NEXT_PUBLIC_API_BASE_URL` and `API_BASE_URL` if the API is running somewhere else.

## Deploying to Vercel

- Deploy `apps/web` to Vercel.
- Keep `apps/api` on a separate always-on backend host because Twilio webhooks and websocket media streams are not a good fit for Vercel serverless functions.
- Set `NEXT_PUBLIC_API_BASE_URL` on Vercel to the public backend URL.
- Set `VOICEOPS_PUBLIC_BASE_URL` on the backend to the same public backend URL so Twilio can reach the webhook endpoints.
- See [`docs/DEPLOYMENT_VERCEL.md`](./docs/DEPLOYMENT_VERCEL.md) for the exact env vars and setup steps.

## Railway deployment

- Use the root `Dockerfile` and the `start:railway` script for a single-service Railway deploy.
- Attach Railway Postgres to the service and set `VOICEOPS_DATABASE_URL` or `DATABASE_URL` from the database connection string.
- Set `VOICEOPS_PUBLIC_BASE_URL` to the Railway public domain so Twilio can reach `/twilio/*` and `/ws/*`.
- See [`docs/DEPLOYMENT_RAILWAY.md`](./docs/DEPLOYMENT_RAILWAY.md) for the full checklist.
