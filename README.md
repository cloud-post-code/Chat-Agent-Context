# Chat-Agent-Context

**Every business gets a page whose homepage is a conversation, and whose agent other
agents can call.**

A visitor lands on `/a/<slug>`, asks a question, and an AI host answers in the
business's voice using **only** what the owner curated, drawing real UI inline when
showing beats telling: photos, services with prices, a booking flow, a menu and cart,
social links. The same brain is published as an A2A agent and as
`llms.txt` for ChatGPT and Claude. Owners onboard by pasting their website; the app
reads it into knowledge, services, a booking form, a theme and starter questions.

## The surfaces

| Surface | Route | For |
|---|---|---|
| Directory | `/` | everyone — every agent page |
| Agent page | `/a/<slug>` | visitors — chat, starter chips, streamed answers, cards |
| Admin | `/admin` → `/admin/chat` and `/admin/dashboard` | the owner — a copilot plus seven groups (Home, Inbox, Knowledge, Agent, Cards, Booking, Settings) that own every word the agent can say |
| Onboarding | `/admin/onboarding` | a new owner — the site is read in, stage by stage |
| Agent interfaces | `/.well-known/agent-card.json`, `/api/a2a`, `/api/a2a/rest` | other agents — discovery and the A2A protocol (JSON-RPC, SSE, REST); bearer-token gated |
| LLM-readable | `/llms.txt`, `/a/<slug>/llms.txt`, `/a/<slug>/llms-full.txt` | crawlers — the knowledge as Markdown |

## How an answer happens

`answer()` in [`lib/brain.ts`](lib/brain.ts) is the one brain; web chat and A2A are
transports over it. A message is served from a canned answer when one matches
exactly, otherwise the model gets the persona plus knowledge retrieved for that
question ([`lib/knowledge.ts`](lib/knowledge.ts) → [`lib/retrieval/search.ts`](lib/retrieval/search.ts):
BM25 + embeddings + one-hop graph expansion) and a set of card tools gated on the
tenant's data. Up to four tool turns, then the answer streams as NDJSON. The
decision rules live in [`agent.md`](agent.md) and change with the prompts.

## Repository map

| Path | What |
|---|---|
| `app/` | Next.js App Router. `a/[slug]` public chat; `admin/` panels, server actions (`actions.ts`), nav registry (`contentTabs.ts`); `api/` endpoints; `cards/` the A2UI renderer and booking cards |
| `lib/` | all server logic — see [`lib/CLAUDE.md`](lib/CLAUDE.md) for the module map |
| `prisma/` | schema (32 models, Postgres) and migrations, applied on start by `scripts/migrate.mjs` |
| `docs/features/` | one folder per feature (`FEATURE.md`, `PROOF.md`, `proof.ts`); `status.json` is the queue — [`docs/features/CLAUDE.md`](docs/features/CLAUDE.md) |
| `tests/` | Vitest unit tests; `scripts/` operational scripts (`crosscheck`, `smoke`, `reindex`, `tagPhotos`) |

[`CLAUDE.md`](CLAUDE.md) is the working contract (commands, conventions, scoped guides).

## Local setup

```bash
npm install
cp .env.example .env      # DATABASE_URL, ANTHROPIC_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, AUTH_SECRET
docker run --name chatagent-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=chatagent_dev -p 5433:5432 -d postgres
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000, sign up at `/signup` (or log in at `/admin` as the founder
from `.env`), paste a website in onboarding, then chat with the result at `/a/<slug>`.
Every variable the code reads is documented in [`.env.example`](.env.example).

## Commands

```bash
npm run dev               # Next dev server
npm run lint              # ESLint + tsc --noEmit
npm test                  # Vitest unit tests (pure; the database is mocked to throw)
npm run crosscheck        # every feature proof against the local Postgres (-- --list, -- --only a,b)
npm run smoke             # key flows over HTTP against a running server (PROOF_BASE_URL)
npm run build             # prisma generate + Playwright chromium + next build
npm run start             # prisma migrate deploy, then next start on $PORT
npx prisma studio         # browse the database
npx tsx scripts/reindex.ts --all       # rebuild the retrieval index (paced by EMBED_PACE_MS)
npx tsx scripts/tagPhotos.ts --dry-run # backfill photo tags for photos uploaded before tagging
```

How testing is layered, and what the gate runs: [`docs/TESTING.md`](docs/TESTING.md).

## Deployment (Railway)

1. New project → deploy from this GitHub repo; add the **Postgres** plugin
   (`DATABASE_URL` is injected).
2. Add a **Volume** mounted at `/data` and set `UPLOAD_DIR=/data/uploads`.
3. Set `ANTHROPIC_API_KEY`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `AUTH_SECRET`,
   `A2A_API_KEY`, and `NEXT_PUBLIC_SITE_URL` (what the Agent Card advertises).
4. Deploy. `npm run start` runs the migrations first; there is no manual step.
   [`railway.json`](railway.json) holds the builder and start command.

The build installs Playwright's Chromium because onboarding renders sites in a real
browser. [`next.config.ts`](next.config.ts) polyfills `File`/`Blob`, keeps `pdf-parse`
and `mammoth` out of the bundle, and raises the server-action body limit for uploads.
The schema provider is Postgres and stays Postgres.

## Design decisions worth knowing

- **The agent only knows what you curate.** No live web at answer time, no model
  general knowledge about the business. Not in the index → "I don't know" and a way to
  reach the owner.
- **Cards are data.** The card catalog and the ingestion-source catalog are rows, not
  code; the brain offers a tool only when the tenant has the data behind it.
- **The booking form is the business's own.** Onboarding transcribes the real booking
  page into fields with roles and screens; the booking is a conversation of cards.
- **Proofs over promises.** Each feature carries an executable proof; the queue says
  which are green, stale or unproven.
