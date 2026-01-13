# Agent Guidance (Repo Context)

## Purpose
- Classroom-ready multi-issue negotiation experiment UI with logging, consent, and survey.
- Runs on Next.js App Router + TypeScript + Tailwind + Zustand.

## Key User Flows
- / -> /consent -> /instructions -> /negotiate -> /survey -> /done
- /admin for local session log review (Basic Auth).

## Core Data + Logging
- Session schema in `lib/types.ts`.
- Logging happens via `store/useSessionStore.ts` and is persisted to localStorage.
- Sessions are POSTed to `/api/submit` and stored in `data/` on the server.

## Backend Routes
- `app/api/agent/route.ts`: returns agent chat + offer.
- `app/api/chat/route.ts`: chat-only agent response.
- `app/api/gemini/route.ts`: Gemini proxy.
- `app/api/submit/route.ts`: saves logs to `data/`.
- `app/api/admin/sessions`: list saved sessions.
- `app/api/admin/sessions/[filename]`: download a saved session.

## Gemini Model
- Model endpoint currently hard-coded in `lib/agent.ts` and `app/api/gemini/route.ts`.
- Gemini calls are server-side only.

## Env Vars
- `GOOGLE_AI_STUDIO_API_KEY` (required for persona mode).
- `NEXT_PUBLIC_MOCK_MODE=true` to skip Gemini.
- `ADMIN_USER` / `ADMIN_PASSWORD` for /admin basic auth.

## Scripts
- `npm run test:gemini` checks Gemini connectivity.
- `npm run test:personas` samples persona outputs.

## Admin + Storage
- Logs are saved to `data/` on the server filesystem.
- `/admin` is protected by Basic Auth via `middleware.ts`.

## Deployment Notes
- Serverless hosts with ephemeral filesystem will lose logs.
- For classroom use, prefer a host with persistent disk or switch `/api/submit` to a DB.
