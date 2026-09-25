# Chat-Agent-Context

A multi-tenant Next.js 15 / React 19 app on Postgres (Prisma) and the Claude API.
Each tenant's public page (`/a/<slug>`) is a chat: an agent that answers only from
the content the owner curated in the password-gated admin (`/admin`), drawing A2UI
cards (photos, services, booking, menu, social) inline. The same brain is exposed
to other agents over A2A (`/.well-known/agent-card.json`, `/api/a2a`) and to LLM
crawlers as `llms.txt`. Hosted on Railway. `agent.md` documents how the agent
decides what to say; keep it current when prompts, tools or routing change.

## Commands
| Task | Command |
|---|---|
| dev server | `npm run dev` (or `npx next dev -p 3120`) |
| lint + typecheck | `npm run lint` |
| unit tests | `npm test` (`npm run test:watch`) |
| feature proofs (needs Postgres) | `npm run crosscheck` (`-- --list`, `-- --only a,b`) |
| smoke against a running server | `PROOF_BASE_URL=http://localhost:3120 npm run smoke` |
| typecheck proofs and scripts | `npm run typecheck:proofs` |
| unused exports / files / deps | `npm run knip` |
| full gate (lint, test, build) | `~/.claude/scripts/gate` |
| database | `npx prisma migrate deploy`, `npx prisma studio` |

Details: `docs/TESTING.md`.

## Where things live
- `app/` — routes. `app/a/[slug]` public chat; `app/admin` the owner's control room
  (server actions in `app/admin/actions.ts`, panels composed in `app/admin/panels.tsx`,
  nav registry `app/admin/contentTabs.ts`); `app/api` HTTP/streaming endpoints;
  `app/cards` the A2UI card renderer (`Cards.tsx`) and the booking cards.
- `lib/` — everything server-side. `lib/brain.ts` answers visitors; `lib/adminBrain.ts`
  is the admin copilot; `lib/knowledge.ts` builds the prompt; `lib/retrieval/` indexes
  and searches; `lib/onboarding/` reads a business's site into the account;
  `lib/booking/` is the booking model; `lib/cards.ts` hydrates card data;
  `lib/claude.ts` is the only Anthropic client; `lib/db.ts` the only Prisma client.
- `prisma/` schema and Postgres migrations (applied on start by `scripts/migrate.mjs`).
- `docs/features/<id>/` one folder per feature: `FEATURE.md`, `PROOF.md`, `proof.ts`;
  `docs/features/status.json` is the queue. See `docs/features/CLAUDE.md`.
- `tests/` Vitest unit tests (pure; the database is mocked to throw).

## Conventions
1. `lib/` never imports from `app/`. Client components never import a module that
   imports `@/lib/db`; put shared constants in a prisma-free module instead.
2. Every Anthropic call goes through `lib/claude.ts`. No inline `new Anthropic()`.
3. Every tenant-scoped query takes `userId` explicitly; nothing reads across tenants.
4. A feature ships with `FEATURE.md`, `PROOF.md`, `proof.ts` and a `status.json` entry.
   Pure logic also gets a Vitest test. Never mark a status green over a red proof.
5. Reuse before adding: check `lib/` for an existing helper (price, duration, money,
   text, image) before writing another. No new style-object sets; use
   `app/cards/styles.ts` (cards) or `app/admin/ui.tsx` (admin).
6. Postgres only; migrations get unique timestamps. Read config from env; bind to
   `PORT`; keep the app platform-agnostic (Railway deploys it).

## Scoped guides
| Area | File |
|---|---|
| feature queue and proofs | `docs/features/CLAUDE.md` |
| testing layers | `docs/TESTING.md` |
| agent behaviour | `agent.md` |
