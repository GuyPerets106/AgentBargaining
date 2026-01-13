# Negotiation Lab (Classroom Experiment)

A fast, classroom-ready multi-issue negotiation experiment built with Next.js App Router + TypeScript. It supports consent, negotiation, chat, structured offers, a post-game survey, and full session logging for analysis.

## Features
- Multi-issue bargaining UI with offer builder + history
- Neutral vs persona agent language (Gemini proxy, numeric offers stay server-controlled)
- Consent + demographics + survey flow
- Session logging with export and server-side storage
- Admin page for reviewing saved sessions

## Tech Stack
- Next.js (App Router), React, TypeScript
- TailwindCSS + shadcn/ui
- Zustand for state
- React Hook Form + Zod for validation
- Gemini (server-side proxy only)

## Setup
1) Install dependencies:
```bash
npm install
```

2) Configure env:
```bash
# .env.local
GOOGLE_AI_STUDIO_API_KEY=YOUR_KEY_HERE
ADMIN_USER=admin
ADMIN_PASSWORD=admin
```

3) Run the dev server:
```bash
npm run dev
```

Open http://localhost:3000

## Admin Logs
- Logs are saved to `data/` on the machine running the server.
- Admin UI: http://localhost:3000/admin (Basic Auth).
- Download JSON per session from the admin page.

## Scripts
- `npm run test:gemini` — check Gemini connectivity.
- `npm run test:personas` — compare persona outputs on the same prompt.
- `npm run analyze:sessions` — generate an Excel report from saved sessions.

## Data Analysis (Excel Report)
Generate a multi-sheet Excel report with summary statistics, per-session metrics, offers, chat, survey data, and visual dashboards:
```bash
npm run analyze:sessions
```

Report tabs include Summary, Dashboard (ASCII bar charts), Plots (concession curves), and Legend (metric definitions/directions).

Options:
```bash
node scripts/analyze-sessions.mjs --input data --out reports/negotiation-report.xlsx --weights lib/weights.json
```

## How Negotiation Works
- Issues are configured in `lib/config.ts`.
- Gemini generates the agent’s offer, decision (accept/counter), and chat message.
- The server validates Gemini’s offer to ensure each issue totals correctly and values are integers.
- Neutral condition still uses Gemini, but with persona tag set to `neutral`.

## Gemini Prompt Template
Gemini prompts are built in `lib/agent.ts` and sent in `/app/api/agent/route.ts` (offer/decision) and `/app/api/chat/route.ts` (chat-only). The persona tag comes from `session.condition.persona_tag` or defaults to `neutral`.

### Offer + Decision (used by `/api/agent`)
**System message:**
```
You are a negotiation agent in a multi-issue bargaining game. Output JSON only. Do not include markdown, code fences, or any extra text.
```

**User message template:**
```
Context: You are the agent in a multi-issue bargaining game. Your goal is to maximize your weighted utility.
If no agreement is reached before the deadline or turn limit, both sides receive 0.
Persona tag: <PERSONA_TAG or "neutral"> (neutral = concise, professional).
Issues and totals: <IssueLabel> (<issue_key>) total <N>; ...
Preference weights (points per unit). Human: <IssueLabel>=<H>, ... Agent: <IssueLabel>=<A>, ...
Last human offer (plain): <OFFER_TEXT> OR "No human offer yet."
Last human offer (keys): <issue_key> H# / A# ...
Last human offer utilities (weighted): Human <H>, Agent <A>, Joint <J>.
History summary: <SHORT_HISTORY>.
Recent chat: <ROLE>: <MSG> | <ROLE>: <MSG> | ...
Deadline remaining: <SECONDS> seconds.
Turn: <TURN> of <MAX_TURNS>.
Decision rules:
- If you accept the last human offer, set decision="accept" and omit the offer field.
- Otherwise, set decision="counter" and include a counteroffer.
Offer rules:
- Use issue keys exactly as given.
- Integers only.
- For each issue, human + agent must equal the total.
Output JSON only in this exact shape:
{"decision":"accept"|"counter","message":"1-3 sentences","offer":{"ISSUE_KEY":{"human":int,"agent":int},...}}
The message must reference the offer in natural language.
Write the JSON now.
```

### Chat-only (used by `/api/chat`)
**System message:**
```
You are a negotiation agent in a multi-issue bargaining game. Respond in 1 to 3 sentences. Do not output JSON or tables.
```

**User message template:**
```
Context: You are the agent in a multi-issue bargaining game. Your goal is to maximize your weighted utility.
If no agreement is reached before the deadline or turn limit, both sides receive 0.
Persona tag: <PERSONA_TAG or "neutral"> (neutral = concise, professional).
Issues and totals: <IssueLabel> (<issue_key>) total <N>; ...
Preference weights (points per unit). Human: <IssueLabel>=<H>, ... Agent: <IssueLabel>=<A>, ...
Current agent offer: <OFFER_TEXT> OR "No current agent offer on the table."
Last human offer: <HUMAN_OFFER_SUMMARY>.
History summary: <SHORT_HISTORY>.
Recent chat: <ROLE>: <MSG> | <ROLE>: <MSG> | ...
Deadline remaining: <SECONDS> seconds.
Turn: <TURN> of <MAX_TURNS>.
Respond in 1-3 sentences. Do not output JSON or tables.
```

## Deployment for a Short Classroom Window
### Option A (same Wi‑Fi)
- Run locally with `npm run dev`.
- Share your machine IP: `http://YOUR-IP:3000`.
- All logs are stored locally in `data/`.

### Option B (public link for a few hours)
- Use a tunnel (Cloudflare Tunnel or ngrok) pointed at your local server.
- Keep the server running for the session.
- Logs remain in your local `data/` folder.

### Option C (hosted)
- Use a host with persistent disk (Render, Fly, Railway with volume). 
- If deploying to a serverless host, logs will **not** persist unless you switch `/api/submit` to a database.

## Deployment Guide (Step-by-step)
### 1) Local + tunnel (fastest for a few hours)
1. Start the server:
   ```bash
   npm run dev
   ```
2. Create a public URL with a tunnel tool:
   ```bash
   # ngrok example
   npx ngrok http 3000
   ```
3. Share the generated URL with your class.
4. After class, collect logs from `data/`.

### 2) Persistent host (for multi-day use)
1. Deploy to a provider with persistent disk (Render/Fly/Railway with volume).
2. Set env vars (`GOOGLE_AI_STUDIO_API_KEY`, `ADMIN_USER`, `ADMIN_PASSWORD`).
3. Confirm `/api/submit` writes to the persistent volume.
4. Review logs via `/admin`.

### 3) Serverless host (requires DB)
1. Deploy to Vercel/Netlify.
2. Replace `/api/submit` to save to a database (Supabase/Postgres/S3).
3. Update `/admin` to read from the database.

## Important Notes
- `.env.local` is ignored by git so your API key is never committed.
- Change `ADMIN_USER` / `ADMIN_PASSWORD` before sharing the admin page publicly.

## License
Internal classroom project.
