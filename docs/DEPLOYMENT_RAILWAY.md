# Railway Deployment Guide

This repo can run on a single Railway service plus one Railway Postgres database.

## Deployment shape

- One Railway service for the whole app
- One Railway Postgres database attached to that service
- One public Railway domain

The service starts three local processes inside one container:

- Next.js on `127.0.0.1:4000`
- FastAPI on `127.0.0.1:8020`
- a tiny reverse proxy on Railway's public `PORT`

The proxy sends browser page traffic to Next.js and Twilio/websocket traffic to FastAPI.

## Required env vars

- `VOICEOPS_DATABASE_URL` or `DATABASE_URL` - Railway Postgres connection string
- `VOICEOPS_PUBLIC_BASE_URL` - the public Railway service URL
- `VOICEOPS_TWILIO_ACCOUNT_SID`
- `VOICEOPS_TWILIO_AUTH_TOKEN`
- `VOICEOPS_TWILIO_PHONE_NUMBER`
- `VOICEOPS_TWILIO_ESCALATION_NUMBER`
- `VOICEOPS_TWILIO_API_KEY_SID`
- `VOICEOPS_TWILIO_API_KEY_SECRET`
- `VOICEOPS_TWILIO_TWIML_APP_SID`
- `VOICEOPS_DEEPGRAM_API_KEY`
- `VOICEOPS_ANTHROPIC_API_KEY` if you want live AI answers
- `VOICEOPS_CORS_ORIGIN_REGEX=https://.*\.up\.railway\.app$`

## What to set in Twilio

- Voice webhook for the phone number: `https://your-railway-service.up.railway.app/twilio/voice?queue_id=...`
- Browser softphone TwiML App Voice URL: `https://your-railway-service.up.railway.app/twilio/browser/voice`

## Build and run

- Build command: handled by the Dockerfile in the repo root
- Start command: `node scripts/railway-start.mjs`

## Why this works

- Next.js still serves the dashboard and route handlers
- FastAPI still serves the business logic, Twilio webhooks, and websocket media bridge
- the public proxy keeps everything in one Railway service while still giving Twilio a real public HTTPS endpoint
