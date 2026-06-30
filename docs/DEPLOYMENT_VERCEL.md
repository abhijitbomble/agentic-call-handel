# Vercel Deployment Guide

VoiceOps Control is best deployed as two pieces:

- `apps/web` on Vercel
- `apps/api` on a separate always-on backend host such as Render, Fly.io, Railway, or a VM

## Why the split exists

The Next.js control center deploys cleanly to Vercel. The FastAPI backend is a long-lived service with Twilio webhooks, websocket streaming, and live media bridge handling, so it should run on infrastructure that keeps a persistent process alive.

## Required environment variables

### Web on Vercel

- `NEXT_PUBLIC_API_BASE_URL` - public backend URL, for example `https://api.yourdomain.com`
- `API_BASE_URL` - same value, used by server-side route handlers

### Backend on your host

- `VOICEOPS_PUBLIC_BASE_URL` - public backend URL, for example `https://api.yourdomain.com`
- `VOICEOPS_TWILIO_ACCOUNT_SID`
- `VOICEOPS_TWILIO_AUTH_TOKEN`
- `VOICEOPS_TWILIO_PHONE_NUMBER`
- `VOICEOPS_TWILIO_ESCALATION_NUMBER`
- `VOICEOPS_TWILIO_API_KEY_SID`
- `VOICEOPS_TWILIO_API_KEY_SECRET`
- `VOICEOPS_TWILIO_TWIML_APP_SID`
- `VOICEOPS_DEEPGRAM_API_KEY`
- `VOICEOPS_CORS_ORIGIN_REGEX=https://.*\.vercel\.app$`

## Vercel setup

1. Create a new Vercel project from this repository.
2. Set the project root directory to `apps/web`.
3. Add the web environment variables above.
4. Deploy.

## Backend setup

1. Deploy `apps/api` to a non-serverless host.
2. Set the backend environment variables above.
3. Put the backend public URL into `NEXT_PUBLIC_API_BASE_URL` on Vercel.
4. Put the same backend public URL into `VOICEOPS_PUBLIC_BASE_URL` for Twilio webhooks.

## Twilio notes

- Twilio voice webhooks need a public `https://` URL.
- The browser softphone also needs the TwiML App voice webhook to be publicly reachable.
- Localhost is fine for development, but not for Twilio callback URLs.
